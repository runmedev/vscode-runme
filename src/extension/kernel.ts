import path from 'node:path'
import os from 'node:os'

import {
  Disposable,
  notebooks,
  window,
  workspace,
  ExtensionContext,
  NotebookEditor,
  NotebookCell,
  NotebookCellKind,
  WorkspaceEdit,
  NotebookEdit,
  NotebookDocument,
  env,
  Uri,
  commands,
  languages,
  TextDocument,
  NotebookRange,
  NotebookEditorRevealType,
  NotebookEditorSelectionChangeEvent,
  CancellationToken,
  NotebookData,
  version,
  NotebookCellData,
} from 'vscode'
import { TelemetryReporter } from 'vscode-telemetry'
import { UnaryCall } from '@protobuf-ts/runtime-rpc'
import { map } from 'rxjs/operators'
import { Subject } from 'rxjs'

import {
  type ActiveTerminal,
  type ClientMessage,
  type RunmeTerminal,
  type Serializer,
  type ExtensionName,
  type FeatureContext,
  FeatureName,
  SyncSchema,
  FeatureObserver,
} from '../types'
import {
  ClientMessages,
  DEFAULT_LANGUAGEID,
  NOTEBOOK_HAS_CATEGORIES,
  SUPPORTED_FILE_EXTENSIONS,
  CATEGORY_SEPARATOR,
  NOTEBOOK_MODE,
  NotebookMode,
  OutputType,
  RUNME_FRONTMATTER_PARSED,
} from '../constants'
import { API } from '../utils/deno/api'
import { postClientMessage } from '../utils/messaging'
import {
  getNotebookExecutionOrder,
  getNotebookTerminalConfigurations,
  registerExtensionEnvVarsMutation,
} from '../utils/configuration'
import features, { FEATURES_CONTEXT_STATE_KEY } from '../features'

import getLogger from './logger'
import executor, {
  type IEnvironmentManager,
  ENV_STORE_MANAGER,
  IKernelExecutor,
  IKernelExecutorOptions,
} from './executors'
import { DENO_ACCESS_TOKEN_KEY } from './constants'
import {
  getKeyInfo,
  getAnnotations,
  hashDocumentUri,
  processEnviron,
  isWindows,
  setNotebookCategories,
  getTerminalRunmeId,
  suggestCategories,
  handleNotebookAutosaveSettings,
  getWorkspaceFolder,
  getRunnerSessionEnvs,
  getEnvProps,
  warnBetaRequired,
} from './utils'
import { getEventReporter } from './ai/events'
import { getSystemShellPath, isShellLanguage } from './executors/utils'
import { RpcError, TransformRequest, TransformResponse } from './grpc/tcpClient'
import { IRunner, IRunnerReady, RunProgramOptions } from './runner'
import { IRunnerEnvironment } from './runner/environment'
import { IKernelRunnerOptions, executeRunner } from './executors/runner'
import { ITerminalState, NotebookTerminalType } from './terminal/terminalState'
import {
  NotebookCellManager,
  NotebookCellOutputManager,
  RunmeNotebookCellExecution,
  getCellById,
  insertCodeCell,
} from './cell'
import { handleCellOutputMessage } from './messages/cellOutput'
import handleGitHubMessage, { handleGistMessage } from './messages/github'
import { getNotebookCategories } from './utils'
import PanelManager from './panels/panelManager'
import { isDocumentSessionOutputs, ISerializer } from './serializer'
import {
  askAlternativeOutputsAction,
  askVarModeMismatch,
  openSplitViewAsMarkdownText,
} from './commands'
import { handlePlatformApiMessage } from './messages/platformRequest'
import { handleGCPMessage } from './messages/gcp'
import { IPanel } from './panels/base'
import { handleAWSMessage } from './messages/aws'
import { SessionEnvStoreType } from './grpc/runner/v1'
import ContextState from './contextState'
import { uri as runUriResource } from './executors/resource'
import { CommandModeEnum } from './grpc/runner/types'
import { GrpcReporter } from './reporter'
import { EnvStoreMonitorWithSession } from './panels/notebook'
import { SignedIn } from './signedIn'

enum ConfirmationItems {
  Yes = 'Yes',
  No = 'No',
  Skip = 'Run all sequentially (skip confirmations)',
  Parallel = 'Run all in parallel (skip confirmations)',
  Cancel = 'Cancel',
}

const log = getLogger('Kernel')

export class Kernel implements Disposable {
  static readonly type = 'runme' as const

  readonly #experiments = new Map<string, boolean>()
  readonly #featuresSettings = new Map<string, boolean>()
  readonly #onlySignedIn: SignedIn

  #disposables: Disposable[] = []
  #controller = notebooks.createNotebookController(
    Kernel.type,
    Kernel.type,
    Kernel.type.toUpperCase(),
  )
  public readonly messaging = notebooks.createRendererMessaging('runme-renderer')

  protected address?: string
  protected runner?: IRunner
  protected runnerEnv?: IRunnerEnvironment
  protected runnerReadyListener?: Disposable

  protected cellManager: NotebookCellManager
  protected activeTerminals: ActiveTerminal[] = []
  protected category?: string
  protected panelManager: PanelManager
  protected serializer?: ISerializer
  protected reporter?: GrpcReporter
  protected featuresState$?: FeatureObserver

  protected readonly monitor$ = new Subject<EnvStoreMonitorWithSession>()

  constructor(protected context: ExtensionContext) {
    const config = workspace.getConfiguration('runme.experiments')

    this.#experiments.set('grpcRunner', config.get<boolean>('grpcRunner', true))
    this.#experiments.set('grpcServer', config.get<boolean>('grpcServer', true))
    this.#experiments.set('smartEnvStore', config.get<boolean>('smartEnvStore', false))
    this.#experiments.set('shellWarning', config.get<boolean>('shellWarning', false))

    this.cellManager = new NotebookCellManager(this.#controller)
    this.#controller.supportsExecutionOrder = getNotebookExecutionOrder()
    this.#controller.description = 'Run your Markdown'
    this.#controller.executeHandler = this._executeAll.bind(this)

    languages.getLanguages().then((l) => {
      this.#controller.supportedLanguages = [
        // TODO(mxs): smartly select default language depending on user shell
        //            e.g., use powershell/bat for respective shells
        DEFAULT_LANGUAGEID,
        ...l.filter((x) => x !== DEFAULT_LANGUAGEID),

        // need to include file extensions since people often use file
        // extension to tag code blocks
        // TODO(mxs): should allow users to select their own
        ...SUPPORTED_FILE_EXTENSIONS,
      ]
    })

    this.messaging.postMessage({ from: 'kernel' })
    this.panelManager = new PanelManager(context)

    this.#disposables.push(
      this.messaging.onDidReceiveMessage(this.handleRendererMessage.bind(this)),
      workspace.onDidOpenNotebookDocument(this.#handleOpenNotebook.bind(this)),
      workspace.onDidSaveNotebookDocument(this.#handleSaveNotebook.bind(this)),
      window.onDidChangeActiveColorTheme(this.#handleActiveColorThemeMessage.bind(this)),
      window.onDidChangeActiveNotebookEditor(this.#handleActiveNotebook.bind(this)),
      this.panelManager,
      { dispose: () => this.monitor$.complete() },
      this.registerTerminalProfile(),
    )

    // group operations for signed in only users, all noops for unsigned in users
    this.#onlySignedIn = new SignedIn(this)
    this.#disposables.push(this.#onlySignedIn)

    const packageJSON = this.context?.extension?.packageJSON || {}
    const featContext: FeatureContext = {
      os: os.platform(),
      vsCodeVersion: version as string,
      extensionVersion: packageJSON?.version,
      githubAuth: false,
      statefulAuth: false,
      extensionId: this.context?.extension?.id as ExtensionName,
    }

    const runmeFeatureSettings = workspace.getConfiguration('runme.features')
    const featureNames = Object.keys(FeatureName)

    featureNames.forEach((feature) => {
      if (runmeFeatureSettings.has(feature)) {
        const result = runmeFeatureSettings.get<boolean>(feature, false)
        this.#featuresSettings.set(feature, result)
      }
    })

    this.featuresState$ = features.loadState(packageJSON, featContext, this.#featuresSettings)

    if (this.featuresState$) {
      const subscription = this.featuresState$
        .pipe(map((_state) => features.getSnapshot(this.featuresState$)))
        .subscribe((snapshot) => {
          ContextState.addKey(FEATURES_CONTEXT_STATE_KEY, snapshot)
          postClientMessage(this.messaging, ClientMessages.featuresUpdateAction, {
            snapshot: snapshot,
          })
        })

      this.#disposables.push({
        dispose: () => subscription.unsubscribe(),
      })
    }
  }

  get envProps() {
    const ext = {
      id: this.context!.extension.id,
      version: this.context!.extension.packageJSON.version,
    }
    return getEnvProps(ext)
  }

  emitPanelEvent<K extends keyof SyncSchema>(
    panelId: string,
    eventName: K,
    payload: SyncSchema[K],
  ) {
    const panel = this.panelManager.getPanel(panelId)

    if (!panel) {
      log.error(`Panel ${panelId} not found`)
      return
    }

    panel.getBus()?.emit(eventName, payload)
  }

  useMonitor() {
    return this.monitor$.asObservable()
  }

  isFeatureOn(featureName: FeatureName): boolean {
    if (!this.featuresState$) {
      return false
    }

    return features.isOn(featureName, this.featuresState$)
  }

  updateFeatureContext<K extends keyof FeatureContext>(key: K, value: FeatureContext[K]) {
    features.updateContext(this.featuresState$, key, value, this.#featuresSettings)
  }

  registerNotebookCell(cell: NotebookCell) {
    this.cellManager.registerCell(cell)
  }
  setCategory(category: string) {
    this.category = category
  }

  setSerializer(serializer: ISerializer) {
    this.serializer = serializer
  }

  setReporter(reporter: GrpcReporter) {
    this.reporter = reporter
  }

  hasExperimentEnabled(key: string, defaultValue?: boolean) {
    return this.#experiments.get(key) ?? defaultValue
  }

  dispose() {
    this.getEnvironmentManager()?.reset()
    this.#controller.dispose()
    this.#disposables.forEach((d) => d.dispose())
    this.runnerReadyListener?.dispose()
    this.activeTerminals = []
  }

  async getTerminalState(cell: NotebookCell): Promise<ITerminalState | undefined> {
    return (await this.getCellOutputs(cell)).getCellTerminalState()
  }

  async saveOutputState(cell: NotebookCell, type: OutputType, value: any) {
    const cellId = cell.metadata?.['runme.dev/id']
    const outputs = await this.getCellOutputs(cell)
    outputs.saveOutputState(cellId, type, value)
  }

  async cleanOutputState(cell: NotebookCell, type: OutputType) {
    const cellId = cell.metadata?.['runme.dev/id']
    const outputs = await this.getCellOutputs(cell)
    outputs.cleanOutputState(cellId, type)
  }

  async registerCellTerminalState(
    cell: NotebookCell,
    programOptions: RunProgramOptions,
    type: NotebookTerminalType,
  ): Promise<ITerminalState> {
    const outputs = await this.cellManager.getNotebookOutputs(cell)
    const { scrollback } = getNotebookTerminalConfigurations(cell.notebook.metadata)
    return outputs.registerCellTerminalState({ type, programOptions, scrollback })
  }

  async #setNotebookMode(notebookDocument: NotebookDocument): Promise<void> {
    const isSessionsOutput = isDocumentSessionOutputs(notebookDocument.metadata)
    const notebookMode = isSessionsOutput ? NotebookMode.SessionOutputs : NotebookMode.Execution
    await ContextState.addKey(NOTEBOOK_MODE, notebookMode)
  }

  async #handleSaveNotebook({ uri, isUntitled, notebookType, getCells }: NotebookDocument) {
    if (notebookType !== Kernel.type) {
      return
    }
    const availableCategories = new Set<string>([
      ...getCells()
        .map((cell) => getAnnotations(cell).category.split(CATEGORY_SEPARATOR))
        .flat()
        .filter((c) => c.length > 0),
    ])
    await setNotebookCategories(this.context, uri, availableCategories)
    await commands.executeCommand('setContext', NOTEBOOK_HAS_CATEGORIES, !!availableCategories.size)
    const isReadme = uri.fsPath.toUpperCase().includes('README')
    const hashed = hashDocumentUri(uri.toString())

    TelemetryReporter.sendTelemetryEvent('notebook.save', {
      'notebook.hashedUri': hashed,
      'notebook.isReadme': isReadme.toString(),
      'notebook.isUntitled': isUntitled.toString(),
    })
  }

  async #handleOpenNotebook(notebookDocument: NotebookDocument) {
    const { uri, isUntitled, notebookType, getCells } = notebookDocument
    if (notebookType !== Kernel.type) {
      return
    }
    await this.#setNotebookMode(notebookDocument)
    getCells().forEach((cell) => this.registerNotebookCell(cell))

    let availableCategories = new Set<string>()
    try {
      availableCategories = new Set<string>([
        ...getCells()
          .map((cell) => getAnnotations(cell).category.split(CATEGORY_SEPARATOR))
          .flat()
          .filter((c) => c.length > 0),
      ])
    } catch (err) {
      if (err instanceof Error) {
        const action = 'Edit Markdown'
        const taken = await window.showErrorMessage(
          `Failed to retrieve cell annotations in markdown; possibly invalid: ${err.message}`,
          action,
        )
        if (taken && taken === action) {
          openSplitViewAsMarkdownText(notebookDocument.uri)
        }
      }
    }

    await setNotebookCategories(this.context, uri, availableCategories)
    const isReadme = uri.fsPath.toUpperCase().includes('README')
    const hashed = hashDocumentUri(uri.toString())
    await handleNotebookAutosaveSettings()
    TelemetryReporter.sendTelemetryEvent('notebook.open', {
      'notebook.hashedUri': hashed,
      'notebook.isReadme': isReadme.toString(),
      'notebook.isUntitled': isUntitled.toString(),
    })
  }

  async #handleActiveNotebook(listener: NotebookEditor | undefined) {
    const notebookDocument = listener?.notebook
    if (!notebookDocument || notebookDocument.notebookType !== Kernel.type) {
      return
    }
    await this.#setNotebookMode(notebookDocument)
    const { uri } = notebookDocument
    const categories = await getNotebookCategories(this.context, uri)
    await commands.executeCommand('setContext', NOTEBOOK_HAS_CATEGORIES, !!categories.length)
  }

  // eslint-disable-next-line max-len
  async handleRendererMessage({
    editor,
    message,
  }: {
    editor: NotebookEditor
    message: ClientMessage<ClientMessages>
  }) {
    if (message.type === ClientMessages.mutateAnnotations) {
      const payload = message as ClientMessage<ClientMessages.mutateAnnotations>

      let editCell: NotebookCell | undefined = undefined
      for (const document of workspace.notebookDocuments) {
        for (const cell of document.getCells()) {
          if (
            cell.kind !== NotebookCellKind.Code ||
            cell.document.uri.fsPath !== editor.notebook.uri.fsPath
          ) {
            continue
          }

          if (cell.metadata?.['runme.dev/id'] === undefined) {
            log.error(`Cell with index ${cell.index} lacks id`)
            continue
          }

          if (cell.metadata?.['runme.dev/id'] === payload.output.annotations['runme.dev/id']) {
            editCell = cell
            break
          }
        }

        if (editCell) {
          break
        }
      }

      if (editCell) {
        const edit = new WorkspaceEdit()
        const newMetadata = {
          ...editCell.metadata,
          ...payload.output.annotations,
        }

        const onlyInternalAnnos =
          Object.entries(newMetadata).filter(([k, v]) => {
            return k.startsWith('runme.dev/') || k.startsWith('_') || v === ''
          }).length === Object.keys(newMetadata).length

        // only if all annotations are internal, can fenced be false
        if (
          !onlyInternalAnnos &&
          Object.entries(newMetadata).some(([k, v]) => k === 'runme.dev/fenced' && v === 'false')
        ) {
          newMetadata['runme.dev/fenced'] = true
        }

        const { rows } = getNotebookTerminalConfigurations(editCell.notebook.metadata)
        if (rows && newMetadata?.['terminalRows'] === rows) {
          delete newMetadata['terminalRows']
        }

        const notebookEdit = NotebookEdit.updateCellMetadata(editCell.index, newMetadata)

        edit.set(editCell.notebook.uri, [notebookEdit])
        await workspace.applyEdit(edit)
      }

      return
    } else if (message.type === ClientMessages.denoPromote) {
      const payload = message
      const token = await this.getEnvironmentManager().get(DENO_ACCESS_TOKEN_KEY)
      if (!token) {
        return
      }

      const api = API.fromToken(token)
      const deployed = await api.promoteDeployment(
        payload.output.id,
        payload.output.productionDeployment,
      )
      postClientMessage(this.messaging, ClientMessages.denoUpdate, {
        promoted: deployed.valueOf(),
      })
    } else if (message.type === ClientMessages.vercelProd) {
      const payload = message as ClientMessage<ClientMessages.vercelProd>
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const cell = editor.notebook.cellAt(payload.output.cellIndex)
      if (cell.executionSummary?.success) {
        process.env['vercelProd'] = 'true'
        return this._doExecuteCell(cell)
      }
    } else if (message.type === ClientMessages.infoMessage) {
      return window.showInformationMessage(message.output as string)
    } else if (message.type === ClientMessages.errorMessage) {
      return window.showErrorMessage(message.output as string)
    } else if (message.type === ClientMessages.openLink) {
      return env.openExternal(Uri.parse(message.output))
    } else if (message.type === ClientMessages.closeCellOutput) {
      const cell = await getCellById({ editor, id: message.output.id })
      if (!cell) {
        return
      }
      return handleCellOutputMessage({
        message,
        cell,
        kernel: this,
        outputType: message.output.outputType,
      })
    } else if (message.type === ClientMessages.githubWorkflowDispatch) {
      await handleGitHubMessage({ messaging: this.messaging, message })
    } else if (message.type === ClientMessages.displayPrompt) {
      const cell = await getCellById({ editor, id: message.output.id })
      if (!cell || message.output.id !== cell.metadata?.['runme.dev/id']) {
        return
      }
      const categories = await getNotebookCategories(this.context, cell.document.uri)
      const { disposables, answer } = await suggestCategories(
        categories,
        message.output.title,
        message.output.placeholder,
      )
      this.#disposables.push(...disposables)
      postClientMessage(this.messaging, ClientMessages.onPrompt, {
        answer,
        id: message.output.id,
      })
    } else if (message.type === ClientMessages.getState) {
      const cell = await getCellById({ editor, id: message.output.id })
      if (!cell) {
        return
      }
      postClientMessage(this.messaging, ClientMessages.onGetState, {
        state: message.output.state,
        value: getAnnotations(cell).category.split(CATEGORY_SEPARATOR).filter(Boolean),
        id: message.output.id,
      })
    } else if (message.type === ClientMessages.setState) {
      const cell = await getCellById({ editor, id: message.output.id })
      if (!cell) {
        return
      }
      const categories = await getNotebookCategories(this.context, cell.notebook.uri)
      await setNotebookCategories(
        this.context,
        cell.notebook.uri,
        new Set([...message.output.value, ...categories].sort()),
      )
    } else if (message.type === ClientMessages.onCategoryChange) {
      const btnSave = 'Save Now'
      window.showWarningMessage('Save changes?', btnSave).then((val) => {
        if (val === btnSave) {
          commands.executeCommand('workbench.action.files.save')
        }
      })
    } else if (message.type === ClientMessages.platformApiRequest) {
      return handlePlatformApiMessage({
        messaging: this.messaging,
        message,
        editor,
        kernel: this,
      })
    } else if (message.type === ClientMessages.optionsModal) {
      if (message.output.telemetryEvent) {
        TelemetryReporter.sendTelemetryEvent(message.output.telemetryEvent)
      }
      const answer = await window.showInformationMessage(
        message.output.title,
        { modal: true },
        ...message.output.options,
      )
      if (answer === 'Open') {
        await commands.executeCommand(
          'vscode.open',
          Uri.parse('https://stateful.com/redirect/runme-panel'),
        )
      }
    } else if (message.type === ClientMessages.optionsMessage) {
      if (message.output.telemetryEvent) {
        TelemetryReporter.sendTelemetryEvent(message.output.telemetryEvent)
      }
      const answer = await window.showInformationMessage(
        message.output.title,
        { modal: !!message.output.modal },
        ...message.output.options,
      )
      return postClientMessage(this.messaging, ClientMessages.onOptionsMessage, {
        option: answer,
        id: message.output.id,
      })
    } else if (message.type === ClientMessages.copyTextToClipboard) {
      await env.clipboard.writeText(message.output.text)
      return postClientMessage(this.messaging, ClientMessages.onCopyTextToClipboard, {
        id: message.output.id,
      })
    } else if (message.type === ClientMessages.openExternalLink) {
      TelemetryReporter.sendRawTelemetryEvent(message.output.telemetryEvent)
      return env.openExternal(Uri.parse(message.output.link))
    } else if (message.type === ClientMessages.tangleEvent) {
      const webviewPanel = this.panelManager.getPanel(message.output.webviewId)
      if (webviewPanel) {
        return webviewPanel.getBus()?.emit('onSave', {
          cellId: message.output.data.cellId,
        })
      }
    } else if (
      [
        ClientMessages.gcpClusterCheckStatus,
        ClientMessages.gcpClusterDetails,
        ClientMessages.gcpClusterDetailsNewCell,
        ClientMessages.gcpVMInstanceAction,
        ClientMessages.gcpCloudRunAction,
        ClientMessages.gcpLoadServices,
      ].includes(message.type)
    ) {
      return handleGCPMessage({ messaging: this.messaging, message, editor })
    } else if (
      [ClientMessages.awsEC2InstanceAction, ClientMessages.awsEKSClusterAction].includes(
        message.type,
      )
    ) {
      return handleAWSMessage({ messaging: this.messaging, message, editor })
    } else if (message.type === ClientMessages.gistCell) {
      TelemetryReporter.sendRawTelemetryEvent(message.output.telemetryEvent)
      return handleGistMessage({
        kernel: this,
        serializer: this.serializer!,
        editor,
        message,
      })
    } else if (message.type === ClientMessages.daggerCliAction) {
      let args: string[] = []
      switch (message.output.argument) {
        case 'path':
          if (!message.output.command.trimEnd().includes('export')) {
            const remotePath = await window.showInputBox({
              title: 'Specify path please',
            })
            if (!remotePath) {
              return
            }
            args.push('--path')
            args.push(remotePath || '')
            break
          }

          const loc = await window.showSaveDialog({
            title: 'Specify path please',
          })
          if (loc) {
            args.push('--path')
            const dir = path.dirname(editor.notebook.uri.fsPath)
            const idx = loc.fsPath.lastIndexOf(dir)
            if (idx >= 0) {
              args.push(loc.fsPath.substring(idx + dir.length + 1))
            } else {
              args.push(loc.fsPath)
            }
            break
          }
          return
        case 'address':
          const address = await window.showInputBox({
            prompt: 'Specify the address please',
          })
          if (address) {
            args.push('--address')
            args.push(address)
            break
          }
          return
      }
      const cellText = `${message.output.command} ${args.join(' ')}`
      return insertCodeCell(message.output.cellId, editor, cellText, 'sh', false)
    } else if (message.type.startsWith('terminal:')) {
      return
    } else if (message.type === ClientMessages.featuresRequest) {
      const snapshot = features.getSnapshot(this.featuresState$)
      postClientMessage(this.messaging, ClientMessages.featuresResponse, {
        snapshot: snapshot,
      })
      return
    }

    log.error(`Unknown kernel event type: ${message.type}`)
  }

  private async _executeAll(cells: NotebookCell[]) {
    const sessionOutputsDoc = cells.find((c) => isDocumentSessionOutputs(c.notebook.metadata))
    if (sessionOutputsDoc) {
      const { notebook } = sessionOutputsDoc
      await askAlternativeOutputsAction(path.dirname(notebook.uri.fsPath), notebook.metadata)
      return
    }

    const notebookFrontmatter = cells[0]?.notebook.metadata[RUNME_FRONTMATTER_PARSED]
    if (await askVarModeMismatch(notebookFrontmatter.envVarMode, this)) {
      return
    }

    await commands.executeCommand('setContext', NOTEBOOK_HAS_CATEGORIES, false)
    const totalNotebookCells =
      (cells[0] &&
        cells[0].notebook.getCells().filter((cell) => cell.kind === NotebookCellKind.Code)
          .length) ||
      0
    const totalCellsToExecute = cells.length
    let showConfirmPrompt = totalNotebookCells === totalCellsToExecute && totalNotebookCells > 1
    let cellsToRunParallel: NotebookCell[] = []
    let cellsToRunSerial: NotebookCell[] = []
    let cellsExecuted = 0

    outer: for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]
      const annotations = getAnnotations(cell)

      // Skip cells that are not assigned to requested category if requested
      if (
        totalCellsToExecute > 1 &&
        this.category &&
        !annotations.category.split(CATEGORY_SEPARATOR).includes(this.category)
      ) {
        continue
      }

      // skip cells that are excluded from run all
      if (totalCellsToExecute > 1 && annotations.excludeFromRunAll) {
        continue
      }

      if (showConfirmPrompt) {
        const cellText = cell.document.getText()
        const cellLabel =
          annotations.name || cellText.length > 20 ? `${cellText.slice(0, 20)}...` : cellText

        const answer = (await window.showQuickPick(Object.values(ConfirmationItems), {
          title: `Are you sure you want to run "${cellLabel}"?`,
          ignoreFocusOut: true,
        })) as ConfirmationItems | undefined

        switch (answer) {
          case ConfirmationItems.Yes:
            cellsToRunSerial.push(cell)
            break
          case ConfirmationItems.No:
            continue
          case ConfirmationItems.Skip:
            cellsToRunSerial.push(...cells.slice(i))
            showConfirmPrompt = false
            break
          case ConfirmationItems.Parallel:
            cellsToRunParallel.push(...cells.slice(i))
            showConfirmPrompt = false
            break
          default:
            break outer
        }
      } else {
        cellsToRunSerial = [cell]
      }

      for (const cell of cellsToRunSerial) {
        cellsExecuted++
        await this._doExecuteCell(cell)
      }
      cellsToRunSerial = []

      const cellExecs: Promise<void>[] = []
      for (const cell of cellsToRunParallel) {
        cellsExecuted++
        cellExecs.push(this._doExecuteCell(cell))
      }
      await Promise.all(cellExecs)
      cellsToRunParallel = []

      // if we've executed all cells, break out of the loop
      if (cellsExecuted >= totalCellsToExecute) {
        break outer
      }
    }

    this.category = undefined
    const uri = cells[0] && cells[0].notebook.uri
    const categories = await getNotebookCategories(this.context, uri)
    await commands.executeCommand('setContext', NOTEBOOK_HAS_CATEGORIES, !!categories.length)

    TelemetryReporter.sendTelemetryEvent('cells.executeAll', {
      'cells.total': totalNotebookCells?.toString(),
      'cells.executed': cellsExecuted?.toString(),
    })
  }

  #handleActiveColorThemeMessage(): void {
    this.messaging.postMessage(<ClientMessage<ClientMessages.activeThemeChanged>>{
      type: ClientMessages.activeThemeChanged,
    })
  }

  public async createCellExecution(
    cell: NotebookCell,
  ): Promise<RunmeNotebookCellExecution | undefined> {
    return await this.cellManager.createNotebookCellExecution(cell)
  }

  public async getCellOutputs(cell: NotebookCell): Promise<NotebookCellOutputManager> {
    return await this.cellManager.getNotebookOutputs(cell)
  }

  public async openAndWaitForTextDocument(uri: Uri): Promise<TextDocument | undefined> {
    let textDocument = await workspace.openTextDocument(uri)
    if (!textDocument) {
      textDocument = await new Promise((resolve) => {
        workspace.onDidOpenTextDocument((document: TextDocument) => {
          resolve(document)
        })
      })
    }
    return textDocument
  }

  private async _doExecuteCell(cell: NotebookCell): Promise<void> {
    const runningCell = await this.openAndWaitForTextDocument(cell.document.uri)
    if (!runningCell) {
      throw new Error(`Failed to open ${cell.document.uri}`)
    }
    const runmeExec = await this.createCellExecution(cell)

    if (!runmeExec) {
      log.warn('Unable to create execution')
      return
    }

    const exec = runmeExec.underlyingExecution

    const id = (cell.metadata as Serializer.Metadata)['runme.dev/id']

    if (!id) {
      throw new Error('Executable cell does not have ID field!')
    }

    TelemetryReporter.sendTelemetryEvent('cell.startExecute')
    const startTime = Date.now()
    runmeExec.start(startTime)

    const annotations = getAnnotations(cell)
    const { key: execKey, resource } = getKeyInfo(
      runningCell,
      annotations,
      cell.notebook.metadata[RUNME_FRONTMATTER_PARSED],
    )

    let successfulCellExecution: boolean

    const envMgr = this.getEnvironmentManager()
    const outputs = await this.getCellOutputs(cell)

    const executorOpts: IKernelExecutorOptions = {
      context: this.context,
      kernel: this,
      runner: this.runner!,
      runnerEnv: this.runnerEnv,
      doc: runningCell,
      exec,
      outputs,
      messaging: this.messaging,
      envMgr,
      resource,
      cellText: runningCell.getText(),
    }

    const runnerOpts: IKernelRunnerOptions = {
      ...executorOpts,
      doc: cell.document,
      runningCell,
      cellId: id,
      execKey,
    }

    try {
      successfulCellExecution = await this.executeCell(runnerOpts, executorOpts)
    } catch (e: any) {
      successfulCellExecution = false
      log.error('Error executing cell', e.message)
      window.showErrorMessage(e.message)
    }

    getEventReporter().reportExecution(cell, successfulCellExecution)

    TelemetryReporter.sendTelemetryEvent('cell.endExecute', {
      'cell.success': successfulCellExecution?.toString(),
      'cell.mimeType': annotations.mimeType,
    })

    const endTime = Date.now()
    // noop unless signed into Stateful Cloud
    this.#onlySignedIn.enqueueCellRun(
      cell,
      window.activeNotebookEditor,
      successfulCellExecution,
      startTime,
      endTime,
    )

    runmeExec.end(successfulCellExecution, endTime)
  }

  private async executeCell(
    runnerOpts: IKernelRunnerOptions,
    executorOpts: IKernelExecutorOptions,
  ): Promise<boolean> {
    // hard disable gRPC runner on windows
    // TODO(sebastian): support windows shells?
    const supportsGrpcRunner = this.runner && !isWindows()

    const execKey = runnerOpts.execKey
    const hasExecutor = execKey in executor

    if (
      supportsGrpcRunner &&
      (isShellLanguage(execKey) || !hasExecutor) &&
      executorOpts.resource === 'None'
    ) {
      if (['daggerCall', 'daggerShell'].includes(execKey) && supportsGrpcRunner) {
        this.cleanOutputState(runnerOpts.exec.cell, OutputType.daggerCall)
      }

      return this.executeRunnerSafe(runnerOpts)
    }

    /**
     * error if no custom notebook executor + renderer is available
     */
    if (!hasExecutor) {
      throw Error('Cell language is not executable')
    }

    const executorByKey: IKernelExecutor = executor[execKey as keyof typeof executor]
    if (executorOpts.resource === 'URI' && supportsGrpcRunner) {
      const runScript = (text?: string) => {
        const cellText = text || executorOpts.cellText
        return executorByKey({ ...executorOpts, cellText })
      }
      const opts: IKernelRunnerOptions = {
        ...runnerOpts,
        runScript,
      }
      return runUriResource(opts)
    }

    if (execKey === 'daggerCall' && supportsGrpcRunner) {
      const notify = async (res?: string): Promise<boolean> => {
        try {
          const daggerJsonParsed = JSON.parse(res || '{}')
          daggerJsonParsed.runme = { cellText: runnerOpts.runningCell.getText() }
          await this.saveOutputState(runnerOpts.exec.cell, OutputType.daggerCall, {
            json: JSON.stringify(daggerJsonParsed),
          })

          return new Promise<boolean>((resolve) => {
            this.messaging
              .postMessage(<ClientMessage<ClientMessages.daggerSyncState>>{
                type: ClientMessages.daggerSyncState,
                output: {
                  id: runnerOpts.cellId,
                  cellId: runnerOpts.cellId,
                  json: daggerJsonParsed,
                },
              })
              .then(() => resolve(true))
          })
        } catch (e) {
          // not a fatal error
          if (e instanceof Error) {
            console.error(e.message)
          }

          await this.saveOutputState(runnerOpts.exec.cell, OutputType.daggerCall, {
            text: res,
          })

          return new Promise<boolean>((resolve) => {
            this.messaging
              .postMessage(<ClientMessage<ClientMessages.daggerSyncState>>{
                type: ClientMessages.daggerSyncState,
                output: {
                  id: runnerOpts.cellId,
                  cellId: runnerOpts.cellId,
                  text: res,
                },
              })
              .then(() => resolve(true))
          })
        }
      }
      const runSecondary = () => {
        return runUriResource({ ...runnerOpts, runScript: notify })
      }
      this.cleanOutputState(runnerOpts.exec.cell, OutputType.daggerCall)
      return this.executeRunnerSafe({ ...runnerOpts, runScript: runSecondary })
    }

    return executorByKey(executorOpts)
  }

  private async executeRunnerSafe(executor: IKernelRunnerOptions): Promise<boolean> {
    return executeRunner(executor).catch((e) => {
      if (e instanceof RpcError) {
        if (e.message.includes('invalid LanguageId')) {
          // todo(sebastian): provide "Configure" button to trigger foldout
          window
            .showWarningMessage(
              // eslint-disable-next-line max-len
              'Not every language is automatically executable. ' +
                'Click below to learn what language runtimes are auto-detected. ' +
                'You can also set an "interpreter" in the "Configure" foldout to define how this cell executes.',
              'See Auto-Detected Languages',
            )
            .then((link) => {
              if (!link) {
                return
              }
              TelemetryReporter.sendTelemetryEvent('survey.shebangAutoDetectRedirect', {})
              commands.executeCommand(
                'vscode.open',
                Uri.parse('https://runme.dev/redirect/shebang-auto-detect'),
              )
            })
          return false
        }

        // cover runnerv1 and v2
        if (
          e.message.includes('invalid ProgramName') ||
          e.message.includes('failed program lookup') ||
          e.message.includes('unable to locate program')
        ) {
          window.showErrorMessage(
            // eslint-disable-next-line max-len
            'Unable to locate interpreter specified in shebang (aka #!). Please check the cell\'s "Configure" foldout.',
          )
          return false
        }
      }

      window.showErrorMessage(`Internal failure executing runner: ${e.message}`)
      log.error('Internal failure executing runner', e.message)
      return false
    })
  }

  useRunner(runner: IRunner) {
    this.runnerReadyListener?.dispose()

    if (this.hasExperimentEnabled('grpcRunner') && runner) {
      if (this.runner === runner) {
        return
      }

      this.runner = runner

      this.runnerReadyListener = runner.onReady(this.newRunnerEnvironment.bind(this))
    }
  }

  getRunnerEnvironment(): IRunnerEnvironment | undefined {
    return this.runnerEnv
  }

  async newRunnerEnvironment({ address }: IRunnerReady): Promise<void> {
    if (!this.runner) {
      log.error('Skipping new runner environment request since runner is not initialized.')
      return
    }

    // keep old address unless there's a new one
    this.address = address || this.address

    log.info('Requesting new runner environment.')

    try {
      this.runnerEnv?.dispose()
      this.runnerEnv = undefined

      const smartEnvStore = this.hasExperimentEnabled('smartEnvStore') ?? false
      const envStoreType = smartEnvStore ? SessionEnvStoreType.OWL : SessionEnvStoreType.UNSPECIFIED

      const workspaceRoot = getWorkspaceFolder()?.uri.fsPath
      const runnerEnv = await this.runner.createEnvironment({
        workspaceRoot,
        envStoreType,
        // copy env from process naively for now
        // does this really make sense if kernel/client aren't on the same host?
        envs: processEnviron(),
      })

      this.runnerEnv = runnerEnv

      this.cellManager.setRunnerEnv(runnerEnv)

      registerExtensionEnvVarsMutation(
        this.context,
        getRunnerSessionEnvs(this.context, runnerEnv, true, address),
      )

      this.monitor$.next({
        monitor: await this.runner.createMonitorEnvStore(),
        sessionId: this.runnerEnv.getSessionId(),
      })

      // runs this last to not overwrite previous outputs
      await commands.executeCommand('notebook.clearAllCellsOutputs')

      log.info('New runner environment assigned with session ID:', runnerEnv.getSessionId())
    } catch (e: any) {
      window.showErrorMessage(`Failed to create environment for gRPC Runner: ${e.message}`)
      log.error('Failed to create gRPC Runner environment', e)
    }
  }

  // TODO: use better abstraction as part of move away from executor model
  private getEnvironmentManager(): IEnvironmentManager {
    if (this.runner) {
      return {
        get: async (key) => {
          if (!this.runnerEnv) {
            return undefined
          }
          return (await this.runner?.getEnvironmentVariables(this.runnerEnv))?.[key]
        },
        set: async (key, val) => {
          if (!this.runnerEnv) {
            return undefined
          }
          await this.runner?.setEnvironmentVariables(this.runnerEnv, { [key]: val })
        },
        reset: async () => {
          await this.newRunnerEnvironment({})
        },
      }
    } else {
      return ENV_STORE_MANAGER
    }
  }

  getSupportedLanguages() {
    return this.#controller.supportedLanguages
  }

  registerTerminal(terminal: RunmeTerminal, executionId: number, runmeId: string) {
    // Dispose previously attached terminal
    const activeTerminal = this.activeTerminals.find((t) => t.runmeId === runmeId)
    if (activeTerminal) {
      this.activeTerminals.splice(this.activeTerminals.indexOf(activeTerminal), 1)
    }
    const exists = this.activeTerminals.find((t) => t.executionId === executionId)
    if (!exists) {
      this.activeTerminals.push({ ...terminal, executionId, runmeId })
    }
  }

  registerTerminalProfile(): Disposable {
    const kernel = this
    const baseUri = workspace.workspaceFolders?.[0].uri
    const cwd = baseUri?.fsPath

    return window.registerTerminalProfileProvider('runme.terminalProfile', {
      async provideTerminalProfile(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        token: CancellationToken,
      ) {
        if (!warnBetaRequired("Please switch to Runme's runner v2 (beta) to use Runme Terminal.")) {
          throw new Error('Runme terminal requires runner v2')
        }

        const session = await kernel.createTerminalSession(cwd)
        const sid = kernel.runnerEnv?.getSessionId()

        session.data.then(async (data) => {
          if (!data.trimEnd().endsWith('save') && data.indexOf('save\r\n') < 0) {
            return
          }

          const sessionNotebook = await workspace.openNotebookDocument(
            Kernel.type,
            new NotebookData([
              new NotebookCellData(
                NotebookCellKind.Markup,
                // eslint-disable-next-line max-len
                '# Terminal Session\n\nThe following cell contains a copy (best-effort) of your recent terminal session.',
                'markdown',
              ),
              new NotebookCellData(NotebookCellKind.Code, data, 'sh'),
              new NotebookCellData(
                NotebookCellKind.Markup,
                '*Read the docs on [runme.dev](https://runme.dev/docs/intro)' +
                  ' to learn how to get most out of Runme notebooks!*',
                'markdown',
              ),
            ]),
          )
          await commands.executeCommand('vscode.openWith', sessionNotebook.uri, Kernel.type)
        })

        return {
          options: {
            name: `Runme Terminal ${sid ? `(${sid})` : ''}`,
            pty: session,
            iconPath: {
              dark: Uri.joinPath(kernel.context.extensionUri, 'assets', 'logo-open-dark.svg'),
              light: Uri.joinPath(kernel.context.extensionUri, 'assets', 'logo-open-light.svg'),
            },
          },
        }
      },
    })
  }

  async createTerminalSession(cwd: string | undefined) {
    const runner = this.runner!
    // todo(sebastian): why are the env collection mutations not doing this?
    const envVars = getRunnerSessionEnvs(this.context, this.runnerEnv, false, this.address)
    const sysShell = getSystemShellPath() || '/bin/bash'
    const session = await runner.createTerminalSession({
      programName: `${sysShell} -l`,
      tty: true,
      cwd,
      runnerEnv: this.runnerEnv,
      envs: Object.entries(envVars).map(([k, v]) => `${k}=${v}`),
      commandMode: CommandModeEnum().TERMINAL,
    })

    session.registerTerminalWindow('vscode')
    session.setActiveTerminalWindow('vscode')

    return session
  }

  getTerminal(runmeId: string) {
    return this.activeTerminals.find((t) => {
      return getTerminalRunmeId(t) === runmeId
    }) as RunmeTerminal | undefined
  }

  registerWebview(webviewId: string, panel: IPanel, disposableWebViewProvider: Disposable): void {
    this.panelManager.addPanel(webviewId, panel, disposableWebViewProvider)
  }

  // Emulate a human perception delay
  async keyboardDelay() {
    return new Promise((cb) => setTimeout(cb, 100))
  }

  async executeAndFocusNotebookCell(cell: NotebookCell) {
    // if the notebook is already opened
    if (!window.activeNotebookEditor?.selection) {
      let disposable: Disposable
      const onChangeSelection = async (_e: NotebookEditorSelectionChangeEvent) => {
        disposable.dispose()
        await this.doExecuteAndFocusNotebookCell(cell)
      }

      disposable = window.onDidChangeNotebookEditorSelection(onChangeSelection)
      return
    }

    await this.doExecuteAndFocusNotebookCell(cell)
  }

  async doExecuteAndFocusNotebookCell(cell: NotebookCell) {
    await this.doFocusNotebookCell(cell)
    await commands.executeCommand('notebook.cell.execute')
    await commands.executeCommand('notebook.cell.focusInOutput')
  }

  async focusNotebookCell(cell: NotebookCell) {
    if (!window.activeNotebookEditor?.selection) {
      let disposable: Disposable
      const onChangeSelection = async (_e: NotebookEditorSelectionChangeEvent) => {
        disposable.dispose()
        await this.doFocusNotebookCell(cell)
      }

      disposable = window.onDidChangeNotebookEditorSelection(onChangeSelection)
      return
    }

    await this.doFocusNotebookCell(cell)
  }

  async doFocusNotebookCell(cell: NotebookCell) {
    await commands.executeCommand('notebook.focusTop')

    const promises = Promise.allSettled(
      Array.from({ length: cell.index }, async (_v, index) => {
        window.activeNotebookEditor?.revealRange(
          new NotebookRange(index, index),
          NotebookEditorRevealType.InCenter,
        )
        return commands.executeCommand('notebook.focusNextEditor')
      }),
    )

    await promises
  }

  public getMaskedCache(cacheId: string): Promise<Uint8Array> | undefined {
    return this.serializer?.getMaskedCache(cacheId)
  }

  public getPlainCache(cacheId: string): Promise<Uint8Array> | undefined {
    return this.serializer?.getPlainCache(cacheId)
  }

  public getNotebookDataCache(cacheId: string): NotebookData | undefined {
    return this.serializer?.getNotebookDataCache(cacheId)
  }

  public async getParserCacheSynced(
    cacheId: string,
    cell: NotebookCell,
  ): Promise<Serializer.Notebook | undefined> {
    // ensure the serializer is caught up
    for (let i = 0; i < 20; i++) {
      const cellText = cell.document.getText()
      const notebook = this.serializer?.getParserCache(cacheId)
      if (notebook && notebook.cells[cell.index].value === cellText) {
        return notebook
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    return undefined
  }

  public async getReporterPayload(
    input: TransformRequest,
  ): Promise<UnaryCall<TransformRequest, TransformResponse> | undefined> {
    return await this.reporter?.transform(input)
  }

  async runProgram(program?: RunProgramOptions | string): Promise<string | undefined> {
    let programOptions: RunProgramOptions
    const logger = getLogger('runProgram')

    if (!this.runner) {
      logger.error('No runner available')
      return
    }

    if (typeof program === 'object') {
      programOptions = program
    } else if (typeof program === 'string') {
      programOptions = {
        programName: 'bash',
        background: false,
        exec: {
          type: 'script',
          script: program,
        },
        languageId: 'sh',
        commandMode: CommandModeEnum().INLINE_SHELL,
        storeLastOutput: false,
        tty: false,
      }
    } else {
      logger.error('Invalid program options')
      return
    }

    const programSession = await this.runner.createProgramSession(programOptions)

    this.context.subscriptions.push(programSession)

    const decoder = new TextDecoder()
    let execRes = ''
    const onData = (data: Uint8Array) => {
      execRes += decoder.decode(data)
    }

    // read raw directly from process instead of tty/pty
    programSession.onStdoutRaw(onData)
    programSession.onStderrRaw(onData)

    const success = new Promise<boolean>((resolve, reject) => {
      programSession.onDidClose(async (code) => {
        if (code !== 0) {
          return resolve(false)
        }
        return resolve(true)
      })

      programSession.onInternalErr((e) => {
        reject(e)
      })

      const exitReason = programSession.hasExited()

      if (exitReason) {
        switch (exitReason.type) {
          case 'error':
            {
              reject(exitReason.error)
            }
            break

          case 'exit':
            {
              resolve(exitReason.code === 0)
            }
            break

          default: {
            resolve(false)
          }
        }
      }
    })

    programSession.run()
    const result = await success

    return result ? execRes?.trim() : undefined
  }
}
