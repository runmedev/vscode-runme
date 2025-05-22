import path from 'node:path'

import {
  NotebookCell,
  Uri,
  window,
  env,
  NotebookDocument,
  TextDocument,
  ViewColumn,
  workspace,
  NotebookData,
  commands,
  NotebookCellData,
  NotebookCellKind,
  ExtensionContext,
  authentication,
  ProgressLocation,
  WorkspaceEdit,
  NotebookEdit,
} from 'vscode'
import YAML from 'yaml'
import { v4 as uuidv4 } from 'uuid'
import { TelemetryReporter } from 'vscode-telemetry'

import {
  OpenViewInEditorAction,
  getActionsOpenViewInEditor,
  getBinaryPath,
  getCLIUseIntegratedRunme,
  getTLSEnabled,
  isNotebookTerminalEnabledForCell,
} from '../../utils/configuration'
import { Kernel } from '../kernel'
import {
  getAnnotations,
  getNotebookCategories,
  getTerminalByCell,
  openFileAsRunmeNotebook,
  promptUserSession,
  warnBetaRequired,
} from '../utils'
import { NotebookToolbarCommand, NotebookUiEvent, FeatureName, EnvVarMode } from '../../types'
import getLogger from '../logger'
import { RecommendedExtension } from '../recommendation'
import {
  NOTEBOOK_AUTOSAVE_ON,
  NOTEBOOK_OUTPUTS_MASKED,
  NOTEBOOK_RUN_WITH_PROMPTS,
  NOTEBOOK_AUTHOR_MODE_ON,
  ClientMessages,
  TELEMETRY_EVENTS,
  RUNME_FRONTMATTER_PARSED,
  NOTEBOOK_PREVIEW_OUTPUTS,
  NOTEBOOK_ENV_VAR_MODE,
} from '../../constants'
import ContextState from '../contextState'
import { createGist } from '../services/github/gist'
import { InitializeCloudClient } from '../api/client'
import { GetUserEnvironmentsDocument } from '../__generated-platform__/graphql'
import { EnvironmentManager } from '../environment/manager'
import features from '../features'
import { insertCodeNotebookCell } from '../cell'
import { getOutputsUri, ISerializer } from '../serializer'

const log = getLogger('Commands')

function showWarningMessage() {
  return window.showWarningMessage("Couldn't find terminal! Was it already closed?")
}

export function openIntegratedTerminal(cell: NotebookCell) {
  const terminal = getTerminalByCell(cell)
  if (!terminal) {
    return showWarningMessage()
  }

  return terminal.show()
}

export async function openRunmeSettings(id?: string) {
  let query = '@ext:stateful.runme'
  if (id) {
    query = `${query} ${id}`
  }
  return commands.executeCommand('workbench.action.openSettings', query)
}

export async function displayCategoriesSelector({
  context,
  notebookToolbarCommand,
  kernel,
}: NotebookToolbarCommand) {
  const categories = await getNotebookCategories(
    context,
    notebookToolbarCommand.notebookEditor.notebookUri,
  )
  if (!categories) {
    return
  }
  const category = await window.showQuickPick(categories.sort(), {
    title: 'Select a tag to run.',
    ignoreFocusOut: true,
    placeHolder: 'Select a tag',
  })
  if (!category) {
    return
  }
  kernel.setCategory(category)

  await commands.executeCommand('notebook.execute')
}

export async function runCellsByCategory(cell: NotebookCell, kernel: Kernel) {
  const annotations = getAnnotations(cell)
  const category = annotations.category
  if (!category) {
    const answer = await window.showInformationMessage(
      'No tag assigned to this cell. Add one in the configuration.',
      'Configure',
      'Dismiss',
    )
    if (answer !== 'Configure') {
      return
    }
    return await commands.executeCommand('runme.toggleCellAnnotations', cell)
  }
  kernel.setCategory(category)
  await commands.executeCommand('notebook.execute')
}

export function toggleTerminal(kernel: Kernel, notebookTerminal: boolean, forceShow = false) {
  return async function (cell: NotebookCell) {
    if (
      (isNotebookTerminalEnabledForCell(cell) && notebookTerminal) ||
      !getAnnotations(cell).interactive
    ) {
      const outputs = await kernel.getCellOutputs(cell)

      if (!forceShow) {
        await outputs.toggleTerminal()
      } else {
        await outputs.showTerminal()
      }

      return
    }

    const terminal = getTerminalByCell(cell)
    if (!terminal) {
      return showWarningMessage()
    }

    return terminal.show()
  }
}

export function copyCellToClipboard(cell: NotebookCell) {
  env.clipboard.writeText(cell.document.getText())
  return window.showInformationMessage('Copied cell to clipboard!')
}

export function stopBackgroundTask(cell: NotebookCell) {
  const terminal = getTerminalByCell(cell)
  if (!terminal) {
    return showWarningMessage()
  }
  terminal.dispose()
}

async function runStatusCommand(cell: NotebookCell): Promise<boolean> {
  if (cell.notebook.isDirty) {
    const option = await window.showInformationMessage(
      'You have unsaved changes. Save and proceed?',
      'Save',
      'Cancel',
    )

    if (option === 'Cancel' || !option) {
      return false
    }

    await cell.notebook.save()
  }

  return true
}

export function runForkCommand(kernel: Kernel, extensionBaseUri: Uri, _grpcRunner: boolean) {
  return async function (cell: NotebookCell) {
    if (!warnBetaRequired("Please switch to Runme's runner v2 (beta) to fork into terminals.")) {
      return
    }

    if (!(await runStatusCommand(cell))) {
      return
    }

    const cwd = path.dirname(cell.document.uri.fsPath)

    const session = await kernel.createTerminalSession(cwd)
    session.data.then(async (data) => {
      if (!data.trimEnd().endsWith('save') && data.indexOf('save\r\n') < 0) {
        return
      }

      await insertCodeNotebookCell({
        cell,
        input: data,
        languageId: 'sh',
        displayConfirmationDialog: false,
        background: false,
        run: false,
      })
    })

    const annotations = getAnnotations(cell.metadata)
    const term = window.createTerminal({
      name: `Fork: ${annotations.name}`,
      pty: session,
      iconPath: {
        dark: Uri.joinPath(extensionBaseUri, 'assets', 'logo-open-dark.svg'),
        light: Uri.joinPath(extensionBaseUri, 'assets', 'logo-open-light.svg'),
      },
    })

    term.show(false)
  }
}

export function runCLICommand(kernel: Kernel, extensionBaseUri: Uri, grpcRunner: boolean) {
  return async function (cell: NotebookCell) {
    if (!(await runStatusCommand(cell))) {
      return
    }

    const cwd = path.dirname(cell.document.uri.fsPath)

    const index = cell.notebook
      .getCells()
      .filter((x) => x.kind === NotebookCellKind.Code)
      .indexOf(cell)

    if (index < 0) {
      window.showErrorMessage('Internal error identifying cell index')
      log.error(`Failed getting code cell index for cell at index ${cell.index}`)

      return
    }

    const args = [
      `--chdir="${cwd}"`,
      `--filename="${path.basename(cell.document.uri.fsPath)}"`,
      `--index=${index}`,
    ]

    if (grpcRunner) {
      if (!getTLSEnabled()) {
        args.push('--insecure')
      }
    }

    const annotations = getAnnotations(cell.metadata)
    const term = window.createTerminal({
      name: `CLI: ${annotations.name}`,
      cwd,
    })

    const runmeExec = getCLIUseIntegratedRunme() ? getBinaryPath(extensionBaseUri).fsPath : 'runme'

    term.show(false)
    term.sendText(`${runmeExec} run ${args.join(' ')}`)
  }
}

async function openDocumentAs(doc: { text?: TextDocument; notebook?: NotebookDocument }) {
  const openIn = getActionsOpenViewInEditor()
  switch (openIn) {
    case OpenViewInEditorAction.enum.toggle:
      {
        commands.executeCommand('workbench.action.toggleEditorType')
      }
      break
    default:
      {
        if (doc.notebook) {
          await window.showNotebookDocument(doc.notebook, {
            viewColumn: ViewColumn.Active,
          })
        } else if (doc.text) {
          await window.showTextDocument(doc.text, {
            viewColumn: ViewColumn.Beside,
          })
        }
      }
      break
  }
}

export async function openAsRunmeNotebook(uri: Uri) {
  const notebook = await workspace.openNotebookDocument(uri)
  await openDocumentAs({ notebook })
}

export async function openSplitViewAsMarkdownText(uri: Uri) {
  const text = await workspace.openTextDocument(uri)
  await openDocumentAs({ text })
}

export async function askNewRunnerSession(kernel: Kernel): Promise<boolean> {
  const action = await window.showInformationMessage(
    'Resetting your Runme session will remove all notebook state and environment variables. Are you sure?',
    { modal: true },
    'OK',
  )
  if (!action) {
    return false
  }

  await ContextState.addKey(NOTEBOOK_PREVIEW_OUTPUTS, false)
  await commands.executeCommand('workbench.action.files.save')
  await kernel.newRunnerEnvironment({})
  await commands.executeCommand('workbench.action.files.save')

  return true
}

export enum ASK_ALT_OUTPUTS_ACTION {
  ORIGINAL = 'Open original document',
  PREVIEW = 'Preview session outputs',
}

export async function askAlternativeOutputsAction(
  basePath: string,
  metadata: { [key: string]: any },
): Promise<void> {
  const action = await window.showWarningMessage(
    'Running Preview Outputs from a previous notebook session is not supported.',
    { modal: true },
    ASK_ALT_OUTPUTS_ACTION.ORIGINAL,
  )

  const orig =
    metadata[RUNME_FRONTMATTER_PARSED]?.['runme']?.['session']?.['document']?.['relativePath']

  switch (action) {
    case ASK_ALT_OUTPUTS_ACTION.ORIGINAL:
      const origFilePath = Uri.parse(path.join(basePath, orig))
      await commands.executeCommand('vscode.openWith', origFilePath, Kernel.type)
      break
    // case ASK_ALT_OUTPUTS_ACTION.PREVIEW:
    //   await commands.executeCommand('markdown.showPreview', notebookDoc.uri)
    //   break
  }
}

export async function askVarModeMismatch(
  frontmatterMode: string | undefined,
  kernel: Kernel,
): Promise<boolean> {
  const currentMode = ContextState.getKey<EnvVarMode>(NOTEBOOK_ENV_VAR_MODE)
  if (!currentMode || !frontmatterMode) {
    return false
  }

  let requiredMode = EnvVarMode.Docs
  switch (frontmatterMode) {
    case 'shell':
      requiredMode = EnvVarMode.Shell
      break
    default:
      requiredMode = EnvVarMode.Default
      break
  }

  if (currentMode === requiredMode) {
    return false
  }

  const action = await window.showInformationMessage(
    [
      `The notebook is configured to use "${requiredMode}" environment variable mode, but the current session is using "${currentMode}".`,
      'It is recommended to reset the session to match the notebook to avoid unexpected behavior.',
    ].join(' '),
    { modal: true },
    'OK',
  )
  if (!action) {
    return true
  }

  await ContextState.addKey(NOTEBOOK_PREVIEW_OUTPUTS, false)
  await ContextState.addKey(NOTEBOOK_ENV_VAR_MODE, requiredMode)
  await commands.executeCommand('workbench.action.files.save')
  await kernel.newRunnerEnvironment({})
  await commands.executeCommand('workbench.action.files.save')
  return false
}

export async function createNewRunmeNotebook() {
  const newNotebook = await workspace.openNotebookDocument(
    Kernel.type,
    new NotebookData([
      new NotebookCellData(
        NotebookCellKind.Markup,
        '# Runme Notebook\n\nDouble-click and start writing here...',
        'markdown',
      ),
      new NotebookCellData(NotebookCellKind.Code, 'echo "Hello World"', 'sh'),
      new NotebookCellData(
        NotebookCellKind.Markup,
        '*Read the docs on [runme.dev](https://runme.dev/docs/intro)' +
          ' to learn how to get most out of Runme notebooks!*',
        'markdown',
      ),
    ]),
  )
  await commands.executeCommand('vscode.openWith', newNotebook.uri, Kernel.type)
}

export async function welcome() {
  commands.executeCommand('workbench.action.openWalkthrough', 'stateful.runme#runme.welcome', false)
}

export async function tryIt(context: ExtensionContext) {
  try {
    const fileContent = await workspace.fs.readFile(
      Uri.file(path.join(__dirname, '..', 'walkthroughs', 'welcome.md')),
    )

    const projectUri = Uri.joinPath(context.globalStorageUri, uuidv4())
    await workspace.fs.createDirectory(projectUri)
    const enc = new TextEncoder()
    const newNotebookUri = Uri.joinPath(projectUri, 'Welcome to Runme.md')
    await workspace.fs.writeFile(newNotebookUri, enc.encode(fileContent.toString()))
    await commands.executeCommand('vscode.openWith', newNotebookUri, Kernel.type)
  } catch (err) {
    const localMarkdown = Uri.joinPath(
      Uri.file(context.extensionPath),
      'walkthroughs',
      'welcome.md',
    )
    return commands.executeCommand('vscode.openWith', localMarkdown, Kernel.type)
  }
}

export async function openFileInRunme(uri: Uri, selection?: Uri[]) {
  await Promise.all((selection ?? [uri]).map(openFileAsRunmeNotebook))
}

export async function authenticateWithGitHub() {
  try {
    await authentication.getSession('github', ['repo'], { createIfNone: true })
  } catch (error) {
    window.showErrorMessage('Failed to authenticate with GitHub')
  }
}

export async function addToRecommendedExtension(context: ExtensionContext) {
  return new RecommendedExtension(context).add()
}

export async function toggleAutosave(autoSaveIsOn: boolean) {
  const createIfNone = features.isOnInContextState(FeatureName.ForceLogin)

  if (autoSaveIsOn && createIfNone) {
    await promptUserSession()
  }
  return ContextState.addKey(NOTEBOOK_AUTOSAVE_ON, autoSaveIsOn)
}

export async function askChangeVarMode(varMode: EnvVarMode, kernel: Kernel) {
  if (!(await askNewRunnerSession(kernel))) {
    return
  }

  const notebook = window.activeNotebookEditor?.notebook
  const newMetadata = {
    ...notebook?.metadata,
  }
  delete newMetadata['envVarMode']

  if (notebook) {
    const unparsed = notebook.metadata['runme.dev/frontmatter']
    let fm: any
    if (unparsed.startsWith('---')) {
      const parsed = YAML.parseAllDocuments(unparsed)
      fm = parsed?.[0].toJS?.()
      delete fm['envVarMode']
    } else {
      fm = Object.entries(notebook.metadata[RUNME_FRONTMATTER_PARSED] ?? {}).reduce(
        (acc, [k, v]) => {
          if (v === '' || !Boolean(v)) {
            return acc
          }
          acc[k] = v
          return acc
        },
        <any>{},
      )
    }

    if (varMode !== EnvVarMode.Default) {
      newMetadata['envVarMode'] = varMode.toString()
      fm['envVarMode'] = varMode.toString()
    }
    const yamlStr = YAML.stringify(fm)
    newMetadata['runme.dev/frontmatter'] = `---\n${yamlStr}\n---`

    const notebookEdit = NotebookEdit.updateNotebookMetadata(newMetadata)
    const edit = new WorkspaceEdit()
    edit.set(notebook.uri, [notebookEdit])
    await workspace.applyEdit(edit)
    await notebook.save()
  }

  return ContextState.addKey(NOTEBOOK_ENV_VAR_MODE, varMode)
}

export async function toggleMasking(maskingIsOn: boolean): Promise<void> {
  ContextState.addKey(NOTEBOOK_OUTPUTS_MASKED, maskingIsOn)
}

export async function togglePreviewOutputs(previewOutputsIsOn: boolean): Promise<void> {
  await ContextState.addKey(NOTEBOOK_PREVIEW_OUTPUTS, previewOutputsIsOn)
}

export async function runCellWithPrompts(cell: NotebookCell, kernel: Kernel) {
  await ContextState.addKey(NOTEBOOK_RUN_WITH_PROMPTS, true)
  await kernel.executeAndFocusNotebookCell(cell)
  await ContextState.addKey(NOTEBOOK_RUN_WITH_PROMPTS, false)
}

export async function createGistCommand(e: NotebookUiEvent, context: ExtensionContext) {
  let gitShared = true
  try {
    if (!e.ui) {
      return
    }

    const uri = e.notebookEditor.notebookUri
    const fileName = path.basename(uri.path)
    const bytes = await workspace.fs.readFile(uri)
    const templatePath = Uri.joinPath(context.extensionUri, 'templates', 'gist.md')
    const byRunmeFile = await workspace.fs.readFile(templatePath)
    const fileNameParts = fileName.split('-')
    const sessionId = fileNameParts.pop() as string
    const originalFileName = fileNameParts.join('-')

    const createGistProgress = await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: 'Creating new Gist ...',
        cancellable: true,
      },
      async () => {
        const createdGist = await createGist({
          isPublic: false,
          files: {
            [fileName]: {
              content: Buffer.from(bytes).toString('utf8'),
            },
            [`summary-${sessionId}`]: {
              content: Buffer.from(byRunmeFile)
                .toString('utf8')
                .replaceAll('%%file%%', `${originalFileName}.md`)
                .replaceAll('%%session%%', sessionId.replace('.md', '')),
            },
          },
        })

        return createdGist
      },
    )

    const option = await window.showInformationMessage(
      'The Runme Gist has been created!',
      'Open',
      'Cancel',
    )

    if (option === 'Open') {
      env.openExternal(Uri.parse(`${createGistProgress.data?.html_url}`))
    }
  } catch (error) {
    gitShared = false
    window.showErrorMessage(`Failed to generate Runme Gist: ${(error as any).message}`)
  } finally {
    TelemetryReporter.sendTelemetryEvent(TELEMETRY_EVENTS.NotebookGist, {
      error: gitShared.toString(),
    })
  }
}

export async function toggleAuthorMode(isAuthorMode: boolean, kernel: Kernel) {
  kernel.messaging.postMessage({
    type: ClientMessages.onAuthorModeChange,
    output: {
      isAuthorMode,
    },
  })
  return ContextState.addKey(NOTEBOOK_AUTHOR_MODE_ON, isAuthorMode)
}

export async function createCellGistCommand(cell: NotebookCell, context: ExtensionContext) {
  let gitShared = true
  try {
    const uri = cell.notebook.uri
    const fileName = path.basename(uri.path)
    const templatePath = Uri.joinPath(context.extensionUri, 'templates', 'gist.md')
    const byRunmeFile = await workspace.fs.readFile(templatePath)
    const cellGistTemplate = await workspace.fs.readFile(
      Uri.joinPath(context.extensionUri, 'templates', 'cellGist.md'),
    )
    const fileNameParts = fileName.split('-')
    const sessionId = fileNameParts.pop() as string
    const originalFileName = fileNameParts.join('-')
    const cellId = cell.notebook.metadata['runme.dev/id']
    const markdownId = cellId ? `${cellId}.md` : sessionId

    const createGistProgress = await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: 'Creating new cell Gist ...',
        cancellable: true,
      },
      async () => {
        const createdGist = await createGist({
          isPublic: false,
          files: {
            [`${markdownId}`]: {
              content: Buffer.from(cellGistTemplate)
                .toString('utf8')
                .replaceAll('%%cell_text%%', cell.document.getText())
                .replaceAll('%%language%%', cell.document.languageId),
            },
            [`summary-${markdownId}`]: {
              content: Buffer.from(byRunmeFile)
                .toString('utf8')
                .replaceAll('%%file%%', `${originalFileName}.md`)
                .replaceAll('%%session%%', sessionId.replace('.md', '')),
            },
          },
        })

        return createdGist
      },
    )

    const option = await window.showInformationMessage(
      'The Runme Gist has been created for the cell!',
      'Open',
      'Cancel',
    )

    if (option === 'Open') {
      env.openExternal(Uri.parse(`${createGistProgress.data?.html_url}`))
    }
  } catch (error) {
    gitShared = false
    window.showErrorMessage(`Failed to generate Runme Gist: ${(error as any).message}`)
  } finally {
    TelemetryReporter.sendTelemetryEvent(TELEMETRY_EVENTS.CellGist, {
      error: gitShared.toString(),
    })
  }
}

export async function selectEnvironment(manager: EnvironmentManager) {
  const graphClient = await InitializeCloudClient()

  const result = await graphClient.query({
    query: GetUserEnvironmentsDocument,
  })

  const options = result.data.userEnvironments.map((env) => ({
    id: env.id,
    label: env.name,
    description: env.description || '',
  }))

  options.push({
    id: '',
    label: 'None',
    description: '',
  })

  const selected = await window.showQuickPick(options, {
    placeHolder: 'Select an environment',
    canPickMany: false,
  })
  if (selected) {
    const isEnv = !!selected.id
    manager.setEnvironment(isEnv ? selected : null)
    window.showInformationMessage(
      isEnv ? `Selected environment: ${selected.label}` : 'Environment cleared',
    )
  }
}

export function notebookSessionOutputs(kernel: Kernel, serializer: ISerializer) {
  return async (e: NotebookUiEvent) => {
    const runnerEnv = kernel.getRunnerEnvironment()
    const sessionId = runnerEnv?.getSessionId()
    if (!e.ui || !sessionId) {
      return
    }

    const { notebookUri } = e.notebookEditor
    await openPreviewOutputs(notebookUri, sessionId, serializer)
  }
}

export async function openPreviewOutputs(
  notebookUri: Uri,
  sessionId: string,
  serializer: ISerializer,
) {
  await togglePreviewOutputs(true)
  const outputFilePath = getOutputsUri(notebookUri, sessionId)

  await commands.executeCommand('workbench.action.files.save')

  await serializer.saveNotebookOutputs(notebookUri)
  await openFileAsRunmeNotebook(outputFilePath)
}
