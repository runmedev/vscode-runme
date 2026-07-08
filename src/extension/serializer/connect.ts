import path from 'node:path'

import {
  ExtensionContext,
  NotebookData,
  CancellationToken,
  workspace,
  WorkspaceEdit,
  NotebookEdit,
  Disposable,
  NotebookDocument,
  NotebookCellOutput,
  NotebookCellExecutionSummary,
} from 'vscode'
import { maskString } from 'data-guardian'
import YAML from 'yaml'

import { Serializer } from '../../types'
import { OutputType, RUNME_FRONTMATTER_PARSED } from '../../constants'
import { ParserService, createConnectClient, ConnectClient } from '../grpc/parser/connect/client'
import {
  RunmeSession,
  Notebook,
  Frontmatter,
  CellOutput,
  CellExecutionSummary,
  DeserializeRequest,
  SerializeRequest,
  SerializeRequestOptions,
} from '../grpc/parser/connect/types'
import { type ReadyPromise } from '../grpc/tcpClient'
import KernelServer from '../server/kernelServer'
import { Kernel } from '../kernel'
import getLogger from '../logger'

import { getDocumentCacheId, NotebookCellOutputWithProcessInfo, GrpcSerializer } from './serializer'

const log = getLogger('connect')

type ParserConnectClient = ConnectClient<typeof ParserService>

export class ConnectSerializer extends GrpcSerializer {
  private client!: ParserConnectClient
  protected ready: ReadyPromise
  protected serverUrl!: string

  private serverReadyListener?: Disposable

  constructor(
    protected context: ExtensionContext,
    server: KernelServer,
    kernel: Kernel,
  ) {
    super(context, server, kernel)

    // cleanup listener when it's outlived its purpose
    this.ready = new Promise((resolve) => {
      const disposable = server.onConnectTransportReady(() => {
        disposable.dispose()
        resolve()
      })
    })

    // if the event has fired the transport is ready, go ahead and use it to create our parser client
    this.serverReadyListener = server.onConnectTransportReady(({ transport }) => {
      this.client = createConnectClient(ParserService, transport)
    })
  }

  public override async switchLifecycleIdentity(
    notebook: NotebookDocument,
    lifecycleIdentity: Serializer.LifecycleIdentity,
  ): Promise<boolean> {
    // skip session outputs files
    if (!!notebook.metadata[RUNME_FRONTMATTER_PARSED]?.runme?.session?.id) {
      return false
    }

    await notebook.save()
    const source = await workspace.fs.readFile(notebook.uri)

    const deserializer = ConnectSerializer.deserializeNotebookFactory(this.client)
    const deserialized = await deserializer(lifecycleIdentity, source)

    if (!deserialized) {
      return false
    }

    deserialized.metadata = { ...deserialized.metadata, ...notebook.metadata }
    const notebookEdit = NotebookEdit.updateNotebookMetadata(deserialized.metadata)
    const edits = [notebookEdit]
    notebook.getCells().forEach((cell) => {
      const descell = deserialized.cells[cell.index]
      // skip if no IDs are present, means no cell identity required
      if (!descell.metadata?.['id']) {
        return
      }
      const metadata = { ...descell.metadata, ...cell.metadata }
      metadata['id'] = metadata['runme.dev/id']
      edits.push(NotebookEdit.updateCellMetadata(cell.index, metadata))
    })

    const edit = new WorkspaceEdit()
    edit.set(notebook.uri, edits)
    return await workspace.applyEdit(edit)
  }

  protected async saveNotebook(
    marshalFrontmatter: boolean,
    data: NotebookData,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    token: CancellationToken,
  ): Promise<Uint8Array> {
    const notebook = ConnectSerializer.marshalNotebook(data, { marshalFrontmatter })

    if (marshalFrontmatter) {
      data.metadata ??= {}
      data.metadata[RUNME_FRONTMATTER_PARSED] = notebook.frontmatter
    }
    const cacheId = getDocumentCacheId(data.metadata)
    const cacheOutputs = this.cacheNotebookOutputs(notebook, cacheId)

    const serializeReq = new SerializeRequest({ notebook })
    const request = this.client.serialize(serializeReq)

    // run in parallel
    const [serialResult] = await Promise.all([request, cacheOutputs])

    if (cacheId) {
      await this.saveNotebookOutputsByCacheId(cacheId)
    }

    if (serialResult.result === undefined) {
      throw new Error('serialization of notebook failed')
    }

    return serialResult.result
  }

  protected async reviveNotebook(
    content: Uint8Array,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    token: CancellationToken,
  ): Promise<Serializer.Notebook> {
    try {
      const deserializer = ConnectSerializer.deserializeNotebookFactory(this.client)
      return deserializer(this.lifecycleIdentity, content)
    } catch (e: any) {
      if (e.name === 'ConnectError') {
        e.message = `Unable to connect to the serializer service at ${this.serverUrl}`
      }
      log.error('Error in reviveNotebook: ', e as any)
      throw e
    }
  }

  private static deserializeNotebookFactory(client: ParserConnectClient) {
    return async (
      lifecycleIdentity: Serializer.LifecycleIdentity,
      content: Uint8Array,
    ): Promise<Serializer.Notebook> => {
      const identity = Number(lifecycleIdentity)
      const deserializeRequest = new DeserializeRequest({
        source: content,
        options: { identity },
      })
      const result = await client.deserialize(deserializeRequest)
      const notebook = result.notebook

      if (notebook === undefined) {
        throw new Error('deserialization failed to revive notebook')
      }

      return notebook as unknown as Serializer.Notebook
    }
  }

  private async cacheNotebookOutputs(
    notebook: Notebook,
    cacheId: string | undefined,
  ): Promise<void> {
    let session: RunmeSession | undefined
    const docUri = this.cacheDocUriMapping.get(cacheId ?? '')
    const sid = this.kernel.getRunnerEnvironment()?.getSessionId()
    if (sid && docUri) {
      const relativePath = path.basename(docUri.fsPath)
      session = new RunmeSession({
        id: sid,
        document: { relativePath },
      })
    }

    const outputs = { enabled: true, summary: true }
    const options = new SerializeRequestOptions({
      outputs,
      session,
    })

    const maskedNotebook = notebook.clone()
    maskedNotebook.cells.forEach((cell) => {
      cell.value = maskString(cell.value)
      cell.outputs.forEach((out) => {
        out.items.forEach((item) => {
          if (item.mime === OutputType.stdout) {
            const outDecoded = Buffer.from(item.data).toString('utf8')
            item.data = Buffer.from(maskString(outDecoded))
          }
        })
      })
    })

    const plainReq = new SerializeRequest({ notebook, options })
    const plainRes = this.client.serialize(plainReq)

    const maskedReq = new SerializeRequest({ notebook: maskedNotebook, options })
    const masked = this.client.serialize(maskedReq).then((maskedRes) => {
      if (maskedRes.result === undefined) {
        console.error('serialization of masked notebook failed')
        return Promise.resolve(Buffer.from(''))
      }
      return Buffer.from(maskedRes.result)
    })

    if (!cacheId) {
      console.error('skip masked caching since no lifecycleId was found')
    } else {
      this.maskedCache.set(cacheId, masked)
    }

    const plain = await plainRes
    if (plain.result === undefined) {
      throw new Error('serialization of notebook outputs failed')
    }

    const bytes = Buffer.from(plain.result)
    if (!cacheId) {
      console.error('skip plain caching since no lifecycleId was found')
    } else {
      this.plainCache.set(cacheId, Promise.resolve(bytes))
    }

    await Promise.all([plain, masked])
  }

  // vscode/NotebookData to buf-es/Notebook
  public static marshalNotebook(
    data: NotebookData,
    config?: {
      marshalFrontmatter?: boolean
      kernel?: Kernel
    },
  ): Notebook {
    // the bulk copies cleanly except for what's below
    const notebook = new Notebook(data as any)

    // cannot gurantee it wasn't changed
    if (notebook.metadata[RUNME_FRONTMATTER_PARSED]) {
      delete notebook.metadata[RUNME_FRONTMATTER_PARSED]
    }

    if (config?.marshalFrontmatter) {
      const metadata = notebook.metadata as unknown as {
        ['runme.dev/frontmatter']: string
      }
      notebook.frontmatter = this.marshalFrontmatter(metadata, config.kernel)
    }

    notebook.cells.forEach(async (cell, cellIdx) => {
      const dataExecSummary = data.cells[cellIdx].executionSummary
      cell.executionSummary = this.marshalCellExecutionSummary(dataExecSummary)
      const dataOutputs = data.cells[cellIdx].outputs
      cell.outputs = this.marshalCellOutputs(cell.outputs, dataOutputs)
    })

    return notebook
  }

  public static marshalFrontmatter(
    metadata: { ['runme.dev/frontmatter']?: string; 'runme.dev/id'?: string },
    kernel?: Kernel,
  ): Frontmatter {
    if (
      !metadata.hasOwnProperty('runme.dev/frontmatter') ||
      typeof metadata['runme.dev/frontmatter'] !== 'string'
    ) {
      log.warn('no frontmatter found in metadata')
      return new Frontmatter({
        category: '',
        tag: '',
        cwd: '',
        runme: {
          id: metadata['runme.dev/id'] || '',
          version: '',
          session: { id: kernel?.getRunnerEnvironment()?.getSessionId() || '' },
        },
        shell: '',
        skipPrompts: false,
        terminalRows: '',
        envVarMode: '',
      })
    }

    const rawFrontmatter = metadata['runme.dev/frontmatter']
    let data: {
      runme: {
        id?: string
        version?: string
      }
    } = { runme: {} }

    if (rawFrontmatter) {
      try {
        const yamlDocs = YAML.parseAllDocuments(metadata['runme.dev/frontmatter'])
        data = (yamlDocs[0].toJS?.() || {}) as typeof data
      } catch (error: any) {
        log.warn('failed to parse frontmatter, reason: ', error.message)
      }
    }

    return new Frontmatter({
      runme: {
        id: data.runme?.id || '',
        version: data.runme?.version || '',
        session: { id: kernel?.getRunnerEnvironment()?.getSessionId() || '' },
      },
      category: '',
      tag: '',
      cwd: '',
      shell: '',
      skipPrompts: false,
      terminalRows: '',
    })
  }

  private static marshalCellOutputs(
    outputs: CellOutput[],
    dataOutputs: NotebookCellOutput[] | undefined,
  ): CellOutput[] {
    if (!dataOutputs) {
      return []
    }

    outputs.forEach((out, outIdx) => {
      const dataOut: NotebookCellOutputWithProcessInfo = dataOutputs[outIdx]
      // todo(sebastian): consider sending error state too
      if (dataOut.processInfo?.exitReason?.type === 'exit') {
        if (dataOut.processInfo.exitReason.code) {
          out.processInfo!.exitReason!.code = dataOut.processInfo.exitReason.code
        } else {
          out.processInfo!.exitReason!.code = undefined
        }

        if (dataOut.processInfo?.pid !== undefined) {
          out.processInfo!.pid = BigInt(dataOut.processInfo.pid)
        } else {
          out.processInfo!.pid = undefined
        }
      }
      out.items.forEach((item) => {
        item.type = item.data.buffer ? 'Buffer' : typeof item.data
      })
    })

    return outputs
  }

  private static marshalCellExecutionSummary(
    executionSummary: NotebookCellExecutionSummary | undefined,
  ): CellExecutionSummary | undefined {
    if (!executionSummary) {
      return undefined
    }

    const { success, timing } = executionSummary
    if (success === undefined || timing === undefined) {
      return undefined
    }

    return new CellExecutionSummary({
      success: success,
      timing: {
        endTime: BigInt(timing!.endTime),
        startTime: BigInt(timing!.startTime),
      },
    })
  }

  public dispose(): void {
    this.serverReadyListener?.dispose()
    super.dispose()
  }
}
