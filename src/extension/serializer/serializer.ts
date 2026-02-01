import path from 'node:path'

import {
  NotebookSerializer,
  ExtensionContext,
  Uri,
  NotebookData,
  NotebookCellData,
  NotebookCellKind,
  CancellationToken,
  workspace,
  WorkspaceEdit,
  NotebookEdit,
  NotebookDocumentChangeEvent,
  Disposable,
  NotebookDocument,
  NotebookCellOutput,
} from 'vscode'
import { ulid } from 'ulidx'

import { FeatureName, Serializer } from '../../types'
import {
  NOTEBOOK_AUTOSAVE_ON,
  NOTEBOOK_LIFECYCLE_ID,
  NOTEBOOK_OUTPUTS_MASKED,
  NOTEBOOK_PREVIEW_OUTPUTS,
  OutputType,
  RUNME_FRONTMATTER_PARSED,
  VSCODE_LANGUAGEID_MAP,
} from '../../constants'
import { ServerLifecycleIdentity } from '../../utils/configuration'
import { type ReadyPromise } from '../grpc/tcpClient'
import Languages from '../languages'
import { PLATFORM_OS } from '../constants'
import { Kernel } from '../kernel'
import { getCellById } from '../cell'
import ContextState from '../contextState'
import * as ghost from '../ai/ghost'
import { IProcessInfoState } from '../terminal/terminalState'
import KernelServer from '../server/kernelServer'
import { togglePreviewOutputs } from '../commands'
import features from '../features'

import { getOutputsUri } from './utils'

const DEFAULT_LANG_ID = 'text'
// const log = getLogger('grpc')

export interface ISerializer extends NotebookSerializer, Disposable {
  dispose(): void
  serializeNotebook(data: NotebookData, token: CancellationToken): Promise<Uint8Array>
  deserializeNotebook(content: Uint8Array, token: CancellationToken): Promise<NotebookData>
  switchLifecycleIdentity(
    notebook: NotebookDocument,
    identity: Serializer.LifecycleIdentity,
  ): Promise<boolean>
  saveNotebookOutputs(uri: Uri): Promise<number>
  getMaskedCache(cacheId: string): Promise<Uint8Array> | undefined
  getPlainCache(cacheId: string): Promise<Uint8Array> | undefined
  getNotebookDataCache(cacheId: string): NotebookData | undefined
  getParserCache(cacheId: string): Serializer.Notebook | undefined
}

export type NotebookCellOutputWithProcessInfo = NotebookCellOutput & {
  processInfo?: IProcessInfoState
}

export abstract class GrpcSerializer implements ISerializer {
  protected abstract readonly ready: ReadyPromise
  protected readonly languages: Languages
  protected disposables: Disposable[] = []

  // todo(sebastian): naive cache for now, consider use lifecycle events for gc
  protected readonly plainCache = new Map<string, Promise<Buffer>>()
  protected readonly maskedCache = new Map<string, Promise<Buffer>>()
  protected readonly parserCache = new Map<string, Serializer.Notebook>()
  protected readonly notebookDataCache = new Map<string, NotebookData>()
  protected readonly cacheDocUriMapping: Map<string, Uri> = new Map<string, Uri>()

  constructor(
    protected context: ExtensionContext,
    protected server: KernelServer,
    protected kernel: Kernel,
  ) {
    this.languages = Languages.fromContext(this.context)
    this.disposables.push(
      workspace.onDidChangeNotebookDocument(this.handleNotebookChanged.bind(this)),
    )

    this.disposables.push(
      workspace.onDidSaveNotebookDocument(this.handleSaveNotebookOutputs.bind(this)),
      workspace.onDidOpenNotebookDocument(this.handleOpenNotebook.bind(this)),
    )
  }

  public dispose() {
    this.disposables.forEach((d) => d.dispose())
  }

  protected applyCellIdentity(data: Serializer.Notebook): Serializer.Notebook {
    const lcid = Number(this.lifecycleIdentity)
    if (
      lcid === Serializer.LifecycleIdentity.UNSPECIFIED ||
      lcid === Serializer.LifecycleIdentity.DOCUMENT
    ) {
      return data
    }

    data.cells.forEach((cell) => {
      if (cell.kind !== NotebookCellKind.Code) {
        return
      }
      if (!cell.metadata?.['id'] && cell.metadata?.['runme.dev/id']) {
        cell.metadata['id'] = cell.metadata['runme.dev/id']
      }
    })

    return data
  }

  protected get lifecycleIdentity(): Serializer.LifecycleIdentity {
    const lcid = ContextState.getKey<ServerLifecycleIdentity>(NOTEBOOK_LIFECYCLE_ID)
    return Number(lcid)
  }

  private async handleOpenNotebook(doc: NotebookDocument) {
    const cacheId = getDocumentCacheId(doc.metadata)

    if (!cacheId) {
      return
    }

    if (isDocumentSessionOutputs(doc.metadata)) {
      return
    }

    await this.applyFrontmatterForFileExtension(doc)

    this.cacheDocUriMapping.set(cacheId, doc.uri)
  }

  private async applyFrontmatterForFileExtension(notebook: NotebookDocument): Promise<boolean> {
    // don't tamper with existing docs
    if (notebook.cellCount > 0 || !!notebook.metadata?.['runme.dev/frontmatterParsed']) {
      return false
    }

    const fileExtension = path.extname(notebook.uri.fsPath)
    if (fileExtension.toLowerCase() === '.dag') {
      const metadata = {
        ...notebook.metadata,
        'runme.dev/frontmatter': '---\n\shell: dagger shell\n---',
        'runme.dev/frontmatterParsed': { shell: 'dagger shell' },
      }
      const notebookEdit = NotebookEdit.updateNotebookMetadata(metadata)
      const edit = new WorkspaceEdit()
      edit.set(notebook.uri, [notebookEdit])
      await workspace.applyEdit(edit)
      await notebook.save()
      return true
    }

    return false
  }

  private async handleSaveNotebookOutputs(doc: NotebookDocument) {
    const cacheId = getDocumentCacheId(doc.metadata)

    if (!cacheId) {
      return
    }

    this.cacheDocUriMapping.set(cacheId, doc.uri)

    await this.saveNotebookOutputsByCacheId(cacheId)
  }

  protected async saveNotebookOutputsByCacheId(cacheId: string): Promise<number> {
    const mode = ContextState.getKey<boolean>(NOTEBOOK_OUTPUTS_MASKED)
    const cache = mode ? this.maskedCache : this.plainCache
    const bytes = await cache.get(cacheId ?? '')

    if (!bytes) {
      return -1
    }

    const srcDocUri = this.cacheDocUriMapping.get(cacheId ?? '')
    if (!srcDocUri) {
      return -1
    }

    const runnerEnv = this.kernel.getRunnerEnvironment()
    const sessionId = runnerEnv?.getSessionId()
    if (!sessionId) {
      return -1
    }

    const sessionFilePath = getOutputsUri(srcDocUri, sessionId)

    // If preview button is clicked, save the outputs to a file
    const isPreview = GrpcSerializer.isPreviewOutput()

    if (isPreview) {
      await togglePreviewOutputs(false)
    }

    const showWriteOutputs = await GrpcSerializer.shouldWriteOutputs(sessionFilePath, isPreview)
    if (showWriteOutputs) {
      if (!sessionFilePath) {
        return -1
      }
      await workspace.fs.writeFile(sessionFilePath, bytes)
    }

    return bytes.length
  }

  private static isPreviewOutput(): boolean {
    const isPreview = ContextState.getKey<boolean>(NOTEBOOK_PREVIEW_OUTPUTS)
    return isPreview
  }

  private static async shouldWriteOutputs(
    sessionFilePath: Uri,
    isPreview: boolean,
  ): Promise<boolean> {
    const isAutosaveOn = ContextState.getKey<boolean>(NOTEBOOK_AUTOSAVE_ON)
    const isSignedIn = features.isOnInContextState(FeatureName.SignedIn)
    const sessionFileExists = await this.sessionFileExists(sessionFilePath)

    return isPreview || (isAutosaveOn && !isSignedIn) || (isAutosaveOn && sessionFileExists)
  }

  private static async sessionFileExists(sessionFilePath: Uri): Promise<boolean> {
    try {
      await workspace.fs.stat(sessionFilePath)
      return true
    } catch (_e) {
      return false
    }
  }

  /**
   * Handle newly added cells (live edits) to have IDs
   */
  private handleNotebookChanged(changes: NotebookDocumentChangeEvent) {
    changes.contentChanges.forEach((contentChanges) => {
      contentChanges.addedCells.forEach((cellAdded) => {
        this.kernel.registerNotebookCell(cellAdded)

        if (
          cellAdded.kind !== NotebookCellKind.Code ||
          cellAdded.metadata['runme.dev/id'] !== undefined
        ) {
          return
        }

        const notebookEdit = NotebookEdit.updateCellMetadata(
          cellAdded.index,
          addRunmeCellId(cellAdded.metadata, this.lifecycleIdentity),
        )
        const edit = new WorkspaceEdit()
        edit.set(cellAdded.notebook.uri, [notebookEdit])
        workspace.applyEdit(edit)
      })
    })
  }

  public async saveNotebookOutputs(uri: Uri): Promise<number> {
    let cacheId: string | undefined
    this.cacheDocUriMapping.forEach((docUri, cid) => {
      const src = getSourceFileUri(uri)
      if (docUri.fsPath.toString() === src.fsPath.toString()) {
        cacheId = cid
      }
    })
    if (!cacheId) {
      return -1
    }

    return this.saveNotebookOutputsByCacheId(cacheId ?? '')
  }

  protected abstract saveNotebook(
    marshalFrontmatter: boolean,
    data: NotebookData,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    token: CancellationToken,
  ): Promise<Uint8Array>

  public async serializeNotebook(
    data: NotebookData,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    token: CancellationToken,
  ): Promise<Uint8Array> {
    const lcid = Number(this.lifecycleIdentity)
    let marshalFrontmatter = false
    if (
      lcid === Serializer.LifecycleIdentity.ALL ||
      lcid === Serializer.LifecycleIdentity.DOCUMENT
    ) {
      marshalFrontmatter = true
    }

    const cells = await addExecInfo(data, this.kernel)
    const metadata = data.metadata

    // Prune any ghost cells when saving.
    const cellsToSave = cells.filter((cell) => !GrpcSerializer.isGhostCell(cell))
    data = new NotebookData(cellsToSave)
    data.metadata = metadata

    let encoded: Uint8Array
    try {
      const cacheId = getDocumentCacheId(data.metadata)
      if (cacheId) {
        this.parserCache.set(cacheId, data)
        this.notebookDataCache.set(cacheId, data)
      }

      encoded = await this.saveNotebook(marshalFrontmatter, data, token)
    } catch (err: any) {
      console.error(err)
      throw err
    }

    return encoded
  }

  protected abstract reviveNotebook(
    content: Uint8Array,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    token: CancellationToken,
  ): Promise<Serializer.Notebook>

  public async deserializeNotebook(
    content: Uint8Array,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    token: CancellationToken,
  ): Promise<NotebookData> {
    let notebook: Serializer.Notebook
    try {
      const err = await this.ready
      if (err) {
        throw err
      }
      notebook = await this.reviveNotebook(content, token)
      notebook = notebook as unknown as Serializer.Notebook
      this.applyCellIdentity(notebook)

      const cacheId = getDocumentCacheId(notebook.metadata)
      if (cacheId) {
        this.parserCache.set(cacheId as string, notebook)
      }
    } catch (err: any) {
      return this.printCell(
        '⚠️ __Error__: document could not be loaded' +
          (err ? `\n<small>${err.message}</small>` : '') +
          '.<p>Please report bug at https://github.com/runmedev/vscode-runme/issues' +
          ' or let us know on Discord (https://discord.gg/stateful)</p>',
      )
    }

    try {
      const cells = notebook.cells ?? []
      notebook.cells = await Promise.all(
        cells.map((elem) => {
          if (elem.kind !== NotebookCellKind.Code) {
            return Promise.resolve(elem)
          }

          if (elem.value && (elem.languageId || '') === '') {
            const norm = normalize(elem.value)
            return this.languages.guess(norm, PLATFORM_OS).then((guessed) => {
              if (guessed) {
                elem.languageId = guessed
              }
              return elem
            })
          }

          if (elem.languageId && VSCODE_LANGUAGEID_MAP[elem.languageId]) {
            elem.languageId = VSCODE_LANGUAGEID_MAP[elem.languageId]
          }

          return Promise.resolve(elem)
        }),
      )
    } catch (err: any) {
      console.error(`Error guessing snippet languages: ${err}`)
    }

    notebook.metadata ??= {}
    notebook.metadata[RUNME_FRONTMATTER_PARSED] = notebook.frontmatter

    const notebookData = new NotebookData(GrpcSerializer.revive(notebook, this.lifecycleIdentity))
    if (notebook.metadata) {
      notebookData.metadata = notebook.metadata
    } else {
      notebookData.metadata = {}
    }

    return notebookData
  }

  // revive converts the Notebook proto to VSCode's NotebookData.
  // It returns a an array of VSCode NotebookCellData objects.
  public static revive(notebook: Serializer.Notebook, identity: Serializer.LifecycleIdentity) {
    return notebook.cells.reduce(
      (accu, elem) => {
        let cell: NotebookCellData

        if (elem.kind === NotebookCellKind.Code) {
          cell = new NotebookCellData(
            NotebookCellKind.Code,
            elem.value,
            elem.languageId || DEFAULT_LANG_ID,
          )
        } else {
          cell = new NotebookCellData(NotebookCellKind.Markup, elem.value, 'markdown')
        }

        if (cell.kind === NotebookCellKind.Code) {
          // The serializer used to own the lifecycle of IDs, however,
          // that's no longer true since they are coming out of the kernel now.
          // However, if "net new" cells show up after deserialization, ie inserts, we backfill them here.
          cell.metadata = addRunmeCellId(elem.metadata, identity)
        }

        cell.metadata ??= {}
        ;(cell.metadata as Serializer.Metadata)['runme.dev/textRange'] = elem.textRange

        accu.push(cell)

        return accu
      },
      <NotebookCellData[]>[],
    )
  }

  public async switchLifecycleIdentity(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    notebook: NotebookDocument,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    identity: Serializer.LifecycleIdentity,
  ): Promise<boolean> {
    return false
  }

  protected printCell(content: string, languageId = 'markdown') {
    return new NotebookData([new NotebookCellData(NotebookCellKind.Markup, content, languageId)])
  }

  public getMaskedCache(cacheId: string): Promise<Uint8Array> | undefined {
    return this.maskedCache.get(cacheId)
  }

  public getPlainCache(cacheId: string): Promise<Uint8Array> | undefined {
    return this.plainCache.get(cacheId)
  }

  public getNotebookDataCache(cacheId: string): NotebookData | undefined {
    return this.notebookDataCache.get(cacheId)
  }

  public getParserCache(cacheId: string): Serializer.Notebook | undefined {
    return this.parserCache.get(cacheId)
  }

  protected static isGhostCell(cell: NotebookCellData): boolean {
    const metadata = cell.metadata
    return metadata?.[ghost.ghostKey] === true
  }
}

export function addRunmeCellId(
  metadata: Serializer.Metadata | undefined,
  identity: Serializer.LifecycleIdentity,
): {
  [key: string]: any
} {
  // never run for cells that came out of kernel
  if (metadata?.['runme.dev/id']) {
    return metadata
  }

  // newly inserted cells may have blank metadata
  const id = metadata?.['id'] || ulid()

  // only set `id` if all or cell identity is required
  if (
    identity === Serializer.LifecycleIdentity.ALL ||
    identity === Serializer.LifecycleIdentity.CELL
  ) {
    return {
      ...(metadata || {}),
      ...{ 'runme.dev/id': id, id },
    }
  }

  return {
    ...(metadata || {}),
    ...{ 'runme.dev/id': id },
  }
}

export async function addExecInfo(data: NotebookData, kernel: Kernel): Promise<NotebookCellData[]> {
  return Promise.all(
    data.cells.map(async (cell) => {
      // The NotebookData structure doesn't include transient metadata,
      // but We need the cell ID to properly track terminal outputs.
      // I extract the cell ID from the terminal output metadata
      // since this preserves the connection between cells and their outputs.
      // This is particularly problematic when lifecycleIdentity is NONE
      // since cells won't have IDs assigned directly.
      const cellOutputs: NotebookCellOutput[] = cell.outputs || []
      const terminalOutputs = cellOutputs.reduce(
        (acc, curr) => {
          if (!curr.items) {
            return acc
          }

          const terminalOutput = curr.items.find((item) => item.mime === OutputType.terminal)

          if (terminalOutput) {
            acc[curr?.metadata?.['runme.dev/id']] = curr
          }

          return acc
        },
        {} as { [key: string]: NotebookCellOutputWithProcessInfo },
      )

      // Currently we assume each cell has at most one terminal output,
      // so we only take the first entry
      const entries = Object.entries(terminalOutputs)
      const [id, terminalOutput] = entries.length > 0 ? entries[0] : ['', undefined]

      const notebookCell = await getCellById({ id })
      if (notebookCell && terminalOutput) {
        const terminalState = await kernel.getCellOutputs(notebookCell).then((cellOutputMgr) => {
          const terminalState = cellOutputMgr.getCellTerminalState()
          if (terminalState?.outputType !== OutputType.terminal) {
            return undefined
          }
          return terminalState
        })

        if (terminalState !== undefined) {
          const processInfo = terminalState.hasProcessInfo()
          if (processInfo) {
            if (processInfo.pid === undefined) {
              delete processInfo.pid
            }
            terminalOutput.processInfo = processInfo
          }
          const strTerminalState = terminalState?.serialize()
          terminalOutput.items.forEach((item) => {
            if (item.mime === OutputType.stdout) {
              item.data = Buffer.from(strTerminalState)
            }
          })
        }
      }

      const languageId = cell.languageId ?? ''

      return {
        ...cell,
        languageId: VSCODE_LANGUAGEID_MAP[languageId] ?? languageId,
      }
    }),
  )
}

export function normalize(source: string): string {
  const lines = source.split('\n')
  const normed = lines.filter((l) => !(l.trim().startsWith('```') || l.trim().endsWith('```')))
  return normed.join('\n')
}

export function getOutputsFilePath(fsPath: string, sid: string): string {
  const fileDir = path.dirname(fsPath)
  const fileExt = path.extname(fsPath)
  const fileBase = path.basename(fsPath, fileExt)
  const filePath = path.normalize(`${fileDir}/${fileBase}-${sid}${fileExt}`)

  return filePath
}

export function getDocumentCacheId(
  metadata: { [key: string]: any } | undefined,
): string | undefined {
  if (!metadata) {
    return undefined
  }

  // cacheId is always present, stays persistent across multiple de/-serialization cycles
  const cacheId = metadata['runme.dev/cacheId'] as string | undefined

  return cacheId
}

export function isDocumentSessionOutputs(metadata: { [key: string]: any } | undefined): boolean {
  if (!metadata) {
    // it's not session outputs unless known
    return false
  }
  const sessionOutputId = metadata[RUNME_FRONTMATTER_PARSED]?.['runme']?.['session']?.['id']
  return Boolean(sessionOutputId)
}

export function getSourceFilePath(outputsFile: string): string {
  const fileExt = path.extname(outputsFile)
  let fileBase = path.basename(outputsFile, fileExt)
  const parts = fileBase.split('-')
  if (parts.length > 1) {
    parts.pop()
  }
  fileBase = parts.join('-')
  const fileDir = path.dirname(outputsFile)
  const filePath = path.normalize(`${fileDir}/${fileBase}${fileExt}`)

  return filePath
}

export function getSourceFileUri(outputsUri: Uri): Uri {
  return Uri.parse(getSourceFilePath(outputsUri.fsPath))
}
