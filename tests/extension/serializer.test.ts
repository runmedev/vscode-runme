import { CancellationTokenSource, NotebookData, NotebookEdit, workspace } from 'vscode'
import { expect, vi, it, describe } from 'vitest'
import { isValid } from 'ulidx'
import { RunmeIdentity, Notebook } from '@buf/runmedev_runme.bufbuild_es/runme/parser/v1/parser_pb'

import { ConnectSerializer } from '../../src/extension/serializer'
import {
  addRunmeCellId,
  getDocumentCacheId,
  getOutputsFilePath,
  getSourceFilePath,
  GrpcSerializer,
  isDocumentSessionOutputs,
} from '../../src/extension/serializer/serializer'
import { Uri } from '../../__mocks__/vscode'
import { Serializer } from '../../src/types'
import ContextState from '../../src/extension/contextState'
import { OutputType } from '../../src/constants'
import { getOutputsUri } from '../../src/extension/serializer/utils'

import fixtureMarshalNotebook from './fixtures/marshalNotebook.json'

vi.mock('../../src/extension/serializer/utils', () => ({
  getOutputsUri: vi.fn(),
}))

vi.mock('vscode', () => ({
  window: {
    activeNotebookEditor: undefined,
    showErrorMessage: vi.fn().mockResolvedValue({}),
    createOutputChannel: vi.fn(),
    createTextEditorDecorationType: vi.fn().mockResolvedValue({}),
  },
  Uri: { joinPath: vi.fn().mockReturnValue('/foo/bar'), parse: vi.fn() },
  workspace: {
    fs: { readFile: vi.fn().mockResolvedValue({}), writeFile: vi.fn() },
    onDidChangeNotebookDocument: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidCloseNotebookDocument: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidSaveNotebookDocument: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onDidOpenNotebookDocument: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    applyEdit: vi.fn(),
    getConfiguration: vi.fn().mockReturnValue({
      update: vi.fn(),
      get: vi.fn(),
    }),
    notebookDocuments: [],
  },
  commands: { executeCommand: vi.fn() },
  WorkspaceEdit: Map<Uri, NotebookEdit[]>,
  NotebookEdit: {
    updateCellMetadata: (i: number, metadata: any) => ({ i, metadata, type: 'updateCellMetadata' }),
    updateNotebookMetadata: (metadata: any) => ({ metadata, type: 'updateNotebookMetadata' }),
  },
  CancellationTokenSource: vi.fn(),
  NotebookData: class {
    constructor(public cells: any[]) {}
  },
  NotebookCellKind: {
    Markup: 1,
    Code: 2,
  },
}))

vi.mock('../../src/extension/grpc/tcpClient', () => ({
  ParserServiceClient: vi.fn(),
}))

vi.mock('../../src/extension/languages', () => ({
  default: {
    fromContext: vi.fn(),
  },
  NotebookData: class {},
}))

vi.mock('../../src/extension/utils', () => ({
  initWasm: vi.fn(),
  isWindows: vi.fn().mockReturnValue(false),
}))

vi.mock('../../src/extension/features')

vi.mock('../../src/extension/contextState')

vi.mock('../../src/extension/commands', () => ({
  togglePreviewOutputs: vi.fn(),
}))

describe('GrpcSerializer', () => {
  it('serializeNotebook transforms languages', async () => {
    const TestSerializer = class extends GrpcSerializer {
      public getMaskedCache(_cacheId: string): Promise<Uint8Array> | undefined {
        throw new Error('Method not implemented.')
      }
      public getPlainCache(_cacheId: string): Promise<Uint8Array> | undefined {
        throw new Error('Method not implemented.')
      }
      public getNotebookDataCache(_cacheId: string): NotebookData | undefined {
        throw new Error('Method not implemented.')
      }

      protected async saveNotebookOutputsByCacheId(_cacheId: string): Promise<number> {
        return 0
      }

      public async saveNotebookOutputs(_uri: Uri): Promise<number> {
        return 0
      }

      protected ready: Promise<void | Error> = Promise.resolve()

      protected async saveNotebook(
        marshalFrontmatter: boolean,
        data: NotebookData,
      ): Promise<Uint8Array> {
        return data as any
      }

      protected async reviveNotebook(content: Uint8Array): Promise<Serializer.Notebook> {
        return content as any
      }

      protected async preSaveCheck() {}
    }

    const serializer = new TestSerializer({} as any, {} as any, {} as any)

    const processed = (await serializer['serializeNotebook'](
      {
        cells: [
          {
            languageId: 'shellscript',
          },
          {
            languageId: 'javascriptreact',
          },
          {
            languageId: 'typescriptreact',
          },
          {
            languageId: 'python',
          },
        ],
      } as any,
      {} as any,
    )) as any

    expect(processed.cells).toStrictEqual([
      {
        languageId: 'sh',
      },
      {
        languageId: 'jsx',
      },
      {
        languageId: 'tsx',
      },
      {
        languageId: 'python',
      },
    ])
  })
})

describe('ConnectSerializer', () => {
  const deepCopyFixture = () => {
    const raw = fixtureMarshalNotebook as any
    return bufferConvert(JSON.parse(JSON.stringify(raw)))
  }

  // item.data.type is an invalid property per the .proto and is an artifiact of JSON.stringify
  // normal execution would see a Buffer object here, not a Buffer-like object
  const bufferConvert = (fixture: any) => {
    fixture.cells.forEach((cell) => {
      cell.outputs.forEach((out) => {
        out.items.forEach((item) => {
          if (item.mime === OutputType.stdout || item.mime === OutputType.terminal) {
            item.data = item.data?.type === 'Buffer' ? Buffer.from(item.data) : item.data
          }
        })
      })
    })
    return fixture
  }

  const context: any = {
    extensionUri: { fsPath: '/foo/bar' },
  }

  const Server = vi.fn().mockImplementation(() => ({
    onTransportReady: vi.fn(),
    onConnectTransportReady: vi.fn(),
    ready: vi.fn().mockResolvedValue(null),
  }))

  const Kernel = vi.fn().mockImplementation(() => ({
    hasExperimentEnabled: vi.fn().mockReturnValue(true),
    getRunnerEnvironment: vi.fn().mockImplementation(() => ({
      getSessionId: vi.fn().mockImplementation(() => 'FAKE-SESSION'),
    })),
  }))

  describe('#isDocumentSessionOutputs', () => {
    it('should return false when frontmatter does not include a session ID', () => {
      const fixture = deepCopyFixture()
      const res = isDocumentSessionOutputs(fixture.metadata)
      expect(res).toBeFalsy()
    })

    it('should return false for undefined metadata', () => {
      const res = isDocumentSessionOutputs(undefined)
      expect(res).toBeFalsy()
    })

    it('should return true when frontmatter does include a session ID', () => {
      const res = isDocumentSessionOutputs({
        'runme.dev/frontmatterParsed': { runme: { session: { id: 'my-fake-session' } } },
      })
      expect(res).toBeTruthy()
    })
  })

  describe('#addRunmeCellId', () => {
    const copyCell = () =>
      JSON.parse(
        JSON.stringify({
          kind: 2,
          value: '$ date | tee /dev/stderr',
          languageId: 'sh',
          metadata: {
            'runme.dev/id': '01HF7B0KJPF469EG9ZVSTKPEZ6',
            interactive: 'true',
            name: 'stdio-test',
          },
        }),
      )

    it('should never run against cells returned by the kernel', () => {
      const cell = copyCell()
      const res = addRunmeCellId(cell.metadata, Number(RunmeIdentity.ALL))
      expect(res['runme.dev/id']).toStrictEqual(cell.metadata['runme.dev/id'])
      expect(res['id']).toBeUndefined()
    })

    it('should add id to cell metadata when identity requires it', () => {
      const cell = { metadata: {} }
      const res = addRunmeCellId(cell.metadata, Number(RunmeIdentity.CELL))
      expect(res['runme.dev/id']).toBeDefined()
      expect(isValid(res['runme.dev/id'])).toBeTruthy()
      expect(res['id']).toBeDefined()
      expect(isValid(res['id'])).toBeTruthy()
    })

    it('should only add runme.dev/id to cell metadata when no identity is required', () => {
      const cell = { metadata: {} }
      const res = addRunmeCellId(cell.metadata, Number(RunmeIdentity.DOCUMENT))
      expect(res['runme.dev/id']).toBeDefined()
      expect(isValid(res['runme.dev/id'])).toBeTruthy()
      expect(res['id']).toBeUndefined()
    })
  })

  describe('#getDocumentCacheId', () => {
    it('should return the document cache ID if present', () => {
      const fixture = deepCopyFixture()
      const res = getDocumentCacheId(fixture.metadata)
      expect(res).toStrictEqual('01J97S5FVEKBPD9GAH0AZBV0HB')
    })

    it('should return undefined for documents without lifecycle IDs', () => {
      const fixture = deepCopyFixture()
      delete fixture.metadata['runme.dev/cacheId']

      const res = getDocumentCacheId(fixture.metadata)
      expect(res).toBeUndefined()
    })

    it('should return undefined for undefined metadata', () => {
      const res = getDocumentCacheId(undefined)
      expect(res).toBeUndefined()
    })
  })

  describe('#switchLifecycleIdentity', () => {
    const fakeSrcDocUri = { fsPath: '/tmp/fake/source.md' } as any

    it('should not run for session outputs', async () => {
      const fixture = deepCopyFixture()
      fixture.metadata['runme.dev/frontmatterParsed'].runme.session = { id: 'FAKE-SESSION' }

      const serializer: any = new ConnectSerializer(context, new Server(), new Kernel())

      const applied = await serializer.switchLifecycleIdentity(
        {
          uri: fakeSrcDocUri,
          metadata: fixture.metadata,
        },
        1, // aka RunmeIdentity.ALL
      )

      expect(applied).toBeFalsy()
    })

    it('should apply lifecycle identity retaining initial IDs', async () => {
      const fixture = deepCopyFixture()
      const descells = fixture.cells.map((cell, i) => {
        cell.index = i
        const c = { ...cell }
        c.metadata = { ...cell.metadata }
        // simluate different ephemeral IDs here to make sure they are not used once applied
        c.metadata['runme.dev/id'] = c.metadata['runme.dev/id'].toString().slice(0, 10)
        c.metadata['id'] = c.metadata['runme.dev/id']
        return c
      })
      const metadata = { ...fixture.metadata }
      metadata['runme.dev/cacheId'] = metadata['runme.dev/cacheId'].toString().slice(0, 10)

      const serializer: any = new ConnectSerializer(context, new Server(), new Kernel())
      serializer.client = {
        deserialize: vi.fn().mockResolvedValue({
          notebook: { cells: descells, metadata },
        }),
      }
      vi.mocked(workspace.applyEdit).mockResolvedValue(true)

      const save = vi.fn()
      const applied = await serializer.switchLifecycleIdentity(
        {
          uri: fakeSrcDocUri,
          metadata: fixture.metadata,
          save,
          getCells: vi.fn().mockReturnValue(fixture.cells),
        },
        1, // aka RunmeIdentity.ALL
      )

      const expectedEdits = new Map()
      expectedEdits.set(
        {
          fsPath: '/tmp/fake/source.md',
        },
        [
          {
            metadata: {
              'runme.dev/cacheId': '01J97S5FVEKBPD9GAH0AZBV0HB',
              'runme.dev/finalLineBreaks': '1',
              'runme.dev/frontmatter':
                '---\nrunme:\n  id: 01HF7B0KJPF469EG9ZWDNKKACQ\n  version: v2.0\n---',
              'runme.dev/frontmatterParsed': {
                cwd: '',
                runme: {
                  id: '01HF7B0KJPF469EG9ZWDNKKACQ',
                  version: 'v2.0',
                },
                shell: '',
                skipPrompts: false,
              },
            },
            type: 'updateNotebookMetadata',
          },
          {
            i: 0,
            metadata: {
              id: '01HF7B0KJPF469EG9ZVSTKPEZ6',
              interactive: 'true',
              name: 'stdio-test',
              'runme.dev/id': '01HF7B0KJPF469EG9ZVSTKPEZ6',
            },
            type: 'updateCellMetadata',
          },
          {
            i: 1,
            metadata: {
              background: 'false',
              id: '01HF7B0KJPF469EG9ZVX256S75',
              interactive: 'true',
              'runme.dev/id': '01HF7B0KJPF469EG9ZVX256S75',
            },
            type: 'updateCellMetadata',
          },
        ],
      )

      expect(save).toBeCalled()
      expect(workspace.applyEdit).toBeCalledWith(expectedEdits)
      expect(applied).toBeTruthy()
    })
  })

  describe('#applyFrontmatterForFileExtension', () => {
    const fakeSrcDocUri = { fsPath: '/tmp/fake/source.md' } as any

    it('should not run for documents with cells', async () => {
      const serializer: any = new ConnectSerializer(context, new Server(), new Kernel())

      const applied = await serializer['applyFrontmatterForFileExtension']({
        cellCount: 2,
        uri: fakeSrcDocUri,
      })

      expect(applied).toBeFalsy()
    })

    it('should not run documents that are not empty', async () => {
      const fixture = deepCopyFixture()

      const serializer: any = new ConnectSerializer(context, new Server(), new Kernel())

      const applied = await serializer['applyFrontmatterForFileExtension']({
        cellCount: 0,
        uri: fakeSrcDocUri,
        metadata: fixture.metadata,
      })

      expect(applied).toBeFalsy()
    })

    it('should apply dagger shell for .dag file extensions', async () => {
      vi.mocked(workspace.applyEdit).mockResolvedValue(true)

      const fixture = deepCopyFixture()
      fakeSrcDocUri.fsPath = '/tmp/fake/source.dag'

      const serializer: any = new ConnectSerializer(context, new Server(), new Kernel())

      delete fixture.metadata['runme.dev/frontmatterParsed']
      delete fixture.metadata['runme.dev/frontmatter']
      const save = vi.fn()
      const applied = await serializer['applyFrontmatterForFileExtension']({
        save,
        uri: fakeSrcDocUri,
        metadata: fixture.metadata,
      })

      const expectedEdits = new Map()
      expectedEdits.set(
        {
          fsPath: '/tmp/fake/source.dag',
        },
        [
          {
            metadata: {
              'runme.dev/cacheId': '01J97S5FVEKBPD9GAH0AZBV0HB',
              'runme.dev/finalLineBreaks': '1',
              'runme.dev/frontmatter': '---\nshell: dagger shell\n---',
              'runme.dev/frontmatterParsed': { shell: 'dagger shell' },
            },
            type: 'updateNotebookMetadata',
          },
        ],
      )

      expect(save).toBeCalled()
      expect(workspace.applyEdit).toBeCalledWith(expectedEdits)
      expect(applied).toBeTruthy()
    })
  })

  describe('cell execution summary marshaling', () => {
    it('should not misrepresenting uninitialized values', () => {
      // i.e. undefined is not sucess=false
      const execSummaryFixture = deepCopyFixture()
      expect(execSummaryFixture.cells.length).toBe(2)

      // set here since JSON does not represent "undefined" as vscode APIs do
      execSummaryFixture.cells[0].executionSummary = {
        success: undefined,
        timing: { startTime: undefined, endTime: undefined },
      }

      const notebookData = ConnectSerializer.marshalNotebook(execSummaryFixture)
      expect(notebookData.cells.length).toBe(2)
      expect(notebookData.cells[0].executionSummary).toBeUndefined()
    })

    it('should wrap raw values for protobuf', () => {
      const execSummaryFixture = deepCopyFixture()
      expect(execSummaryFixture.cells.length).toBe(2)

      const notebookData = ConnectSerializer.marshalNotebook(execSummaryFixture)
      expect(notebookData.cells.length).toBe(2)

      const summary = notebookData.cells[1].executionSummary
      expect(summary?.success).toBeDefined()
      expect(summary?.success).toStrictEqual(false)

      expect(summary?.timing).toBeDefined()
      expect(summary?.timing?.startTime).toStrictEqual(1701444499517n)
      expect(summary?.timing?.endTime).toStrictEqual(1701444501696n)
    })
  })

  describe('cell outputs marshaling', () => {
    it('should backfill the output type for buffers', () => {
      const outputsFixture = deepCopyFixture()
      expect(outputsFixture.cells.length).toBe(2)

      const notebookData = ConnectSerializer.marshalNotebook(outputsFixture)
      expect(notebookData.cells.length).toBe(2)
      const cells = notebookData.cells[1]
      const items = cells.outputs[0].items
      expect(items.length).toBe(2)
      items.forEach((item) => {
        expect(item.type).toBe('Buffer')
        expect(item.mime).toBeDefined()
      })
      const { processInfo } = cells.outputs[0]
      expect(processInfo?.exitReason).toBeDefined()
      expect(processInfo?.exitReason?.type).toStrictEqual('exit')
      expect(processInfo?.exitReason?.code).toStrictEqual(16)
      expect(processInfo?.pid).toBeDefined()
      expect(processInfo?.pid).toStrictEqual(98354n)
    })
  })

  describe('frontmatter handling', () => {
    it('should remove parse frontmatter on serialization', () => {
      const outputsFixture = deepCopyFixture()
      expect(outputsFixture.cells.length).toBe(2)
      expect(outputsFixture.metadata['runme.dev/cacheId']).toBeDefined()
      expect(outputsFixture.metadata['runme.dev/frontmatterParsed']).toBeDefined()
      expect(Object.keys(outputsFixture.metadata).length).toStrictEqual(4)

      const notebookData = ConnectSerializer.marshalNotebook(outputsFixture)
      expect(outputsFixture.metadata['runme.dev/cacheId']).toBeDefined()
      expect(notebookData.metadata['runme.dev/frontmatterParsed']).toBeUndefined()
      expect(Object.keys(notebookData.metadata).length).toStrictEqual(3)
    })
  })

  describe('session file', () => {
    const fakeSrcDocUri = { fsPath: '/tmp/fake/source.md' } as any

    it("maps document lifecycle ids to source doc's URIs on notebook opening", async () => {
      const fixture = deepCopyFixture()
      const cacheId = fixture.metadata['runme.dev/cacheId']

      const serializer: any = new ConnectSerializer(context, new Server(), new Kernel())

      await serializer.handleOpenNotebook({
        uri: fakeSrcDocUri,
        metadata: fixture.metadata,
      })

      const lidDocUri = serializer.cacheDocUriMapping.get(cacheId)
      expect(lidDocUri).toStrictEqual(fakeSrcDocUri)
    })

    describe('#saveNotebookOutputs', () => {
      const fakeCachedBytes = Buffer.from([1, 2, 3, 4])
      const serializer: any = new ConnectSerializer(context, new Server(), new Kernel())
      const togglePreviewButton = vi.fn()
      serializer.togglePreviewButton = togglePreviewButton

      it('skips if preview outputs are disabled', async () => {
        const fixture = deepCopyFixture()
        serializer.plainCache.set(
          fixture.metadata['runme.dev/frontmatterParsed'].runme.id,
          fakeCachedBytes,
        )
        await serializer.handleSaveNotebookOutputs({
          uri: fakeSrcDocUri,
          metadata: fixture.metadata,
        })

        expect(workspace.fs.writeFile).toHaveBeenCalledTimes(0)
      })

      it('skips if notebook has zero bytes', async () => {
        const fixture = deepCopyFixture()
        serializer.plainCache.set(
          fixture.metadata['runme.dev/frontmatterParsed'].runme.id,
          undefined,
        )
        await serializer.handleSaveNotebookOutputs({
          uri: fakeSrcDocUri,
          metadata: fixture.metadata,
        })

        expect(workspace.fs.writeFile).toHaveBeenCalledTimes(0)
      })

      it('skips if uri mapping to cacheId is unknown', async () => {
        const fixture = deepCopyFixture()
        serializer.plainCache.set(
          fixture.metadata['runme.dev/frontmatterParsed'].runme.id,
          fakeCachedBytes,
        )
        await serializer.handleSaveNotebookOutputs({
          uri: fakeSrcDocUri,
          metadata: fixture.metadata,
        })

        expect(workspace.fs.writeFile).toHaveBeenCalledTimes(0)
      })

      it('skips if session file mapping is unknown', async () => {
        const fixture = deepCopyFixture()
        serializer.cacheDocUriMapping.set(
          fixture.metadata['runme.dev/frontmatterParsed'].runme.id,
          fakeSrcDocUri,
        )
        serializer.plainCache.set(
          fixture.metadata['runme.dev/frontmatterParsed'].runme.id,
          fakeCachedBytes,
        )
        await serializer.handleSaveNotebookOutputs({
          uri: fakeSrcDocUri,
          metadata: fixture.metadata,
        })

        expect(workspace.fs.writeFile).toHaveBeenCalledTimes(0)
      })

      it('skips if runner env session in unknown', async () => {
        const fixture = deepCopyFixture()
        serializer.cacheDocUriMapping.set(
          fixture.metadata['runme.dev/frontmatterParsed'].runme.id,
          fakeSrcDocUri,
        )
        serializer.plainCache.set(
          fixture.metadata['runme.dev/frontmatterParsed'].runme.id,
          fakeCachedBytes,
        )
        serializer.kernel.getRunnerEnvironment = () => ({
          getSessionId: vi.fn().mockImplementation(() => undefined),
        })
        await serializer.handleSaveNotebookOutputs({
          uri: fakeSrcDocUri,
          metadata: fixture.metadata,
        })

        expect(workspace.fs.writeFile).toHaveBeenCalledTimes(0)
      })

      it('writes cached bytes to session file on serialization and save', async () => {
        const fixture = deepCopyFixture()
        const writeableSer: any = new ConnectSerializer(context, new Server(), new Kernel())
        writeableSer.client = {
          serialize: vi.fn().mockResolvedValue({ result: fakeCachedBytes }),
        }
        writeableSer.cacheDocUriMapping.set(fixture.metadata['runme.dev/cacheId'], fakeSrcDocUri)
        ContextState.getKey = vi.fn().mockImplementation(() => true)
        vi.mocked(getOutputsUri).mockReturnValue(fakeSrcDocUri)

        const result = await writeableSer.serializeNotebook(
          { cells: [], metadata: fixture.metadata } as any,
          new CancellationTokenSource().token,
        )
        expect(result.length).toStrictEqual(4)

        await writeableSer.handleSaveNotebookOutputs({
          uri: fakeSrcDocUri,
          metadata: fixture.metadata,
        })

        expect(workspace.fs.writeFile).toBeCalledWith(fakeSrcDocUri, fakeCachedBytes)
        expect(workspace.fs.writeFile).toHaveBeenCalledTimes(2)
      })
    })

    it('derives its path from notebook source document and session', () => {
      const outputFilePath = getOutputsFilePath(
        '/tmp/fake/runbook.md',
        '01HGX8KYWM9K41YVYP0CNR3TZW',
      )
      expect(outputFilePath).toStrictEqual('/tmp/fake/runbook-01HGX8KYWM9K41YVYP0CNR3TZW.md')
    })

    it('can reverse the process to get the source document path', () => {
      const sourceFilePath = getSourceFilePath('/tmp/fake/runbook-01HGX8KYWM9K41YVYP0CNR3TZW.md')
      expect(sourceFilePath).toStrictEqual('/tmp/fake/runbook.md')
    })

    it('can reverse the process even with mulitple dashes to get the source document path', () => {
      const sourceFilePath = getSourceFilePath('/tmp/fake/my-runbook-01HGX8KYWM9K41YVYP0CNR3TZW.md')
      expect(sourceFilePath).toStrictEqual('/tmp/fake/my-runbook.md')
    })

    it('should include session and document info on serialization', async () => {
      const context: any = {
        extensionUri: { fsPath: '/foo/bar' },
      }
      const fixture = new Notebook({
        cells: [],
        metadata: {
          'runme.dev/finalLineBreaks': '1',
          'runme.dev/frontmatter':
            '---\nrunme:\n  id: 01HF7B0KJPF469EG9ZWDNKKACQ\n  version: v2.0\n---',
        },
      })

      const serialize = vi.fn().mockImplementation(() =>
        Promise.resolve({
          result: new Uint8Array([4, 3, 2, 1]),
        }),
      )
      const ser = new ConnectSerializer(context, new Server(), new Kernel())
      ;(ser as any).cacheDocUriMapping = { get: vi.fn().mockReturnValue(fakeSrcDocUri) }
      ;(ser as any).client = { serialize }

      await (ser as any).cacheNotebookOutputs(fixture, 'irrelevant')

      expect(serialize).toBeCalledWith({
        notebook: {
          cells: [],
          metadata: {
            'runme.dev/finalLineBreaks': '1',
            'runme.dev/frontmatter':
              '---\nrunme:\n  id: 01HF7B0KJPF469EG9ZWDNKKACQ\n  version: v2.0\n---',
          },
        },
        options: {
          outputs: {
            enabled: true,
            summary: true,
          },
          session: {
            document: {
              relativePath: 'source.md',
            },
            id: 'FAKE-SESSION',
          },
        },
      })
    })
  })

  describe('apply cell lifecycle identity', () => {
    it('skips cells if identity does not require it', async () => {
      // make serializer.lifecycleIdentity return 2
      ContextState.getKey = vi.fn().mockImplementation(() => 2)
      const fixture = deepCopyFixture()

      const serializer: any = new ConnectSerializer(context, new Server(), new Kernel())

      fixture.cells.forEach((cell: { kind: number; metadata: { [x: string]: any } }) => {
        cell.metadata['runme.dev/id'] = cell.metadata['id']
        delete cell.metadata['id']
        expect(cell.metadata['id']).toBeUndefined()
      })

      const applied = serializer.applyCellIdentity(fixture)

      applied.cells.forEach((cell: { metadata: { [x: string]: any } }) => {
        expect(cell.metadata['id']).toBeUndefined()
      })
    })

    it('skips non-code cells', async () => {
      const serializer: any = new ConnectSerializer(context, new Server(), new Kernel())
      const fixture = deepCopyFixture()

      fixture.cells.forEach((cell: { kind: number; metadata: { [x: string]: any } }) => {
        cell.kind = 1
        cell.metadata['runme.dev/id'] = cell.metadata['id']
        delete cell.metadata['id']
        expect(cell.metadata['id']).toBeUndefined()
      })

      const applied = serializer.applyCellIdentity(fixture)

      applied.cells.forEach((cell: { metadata: { [x: string]: any } }) => {
        expect(cell.metadata['id']).toBeUndefined()
      })
    })

    it('populates code cells with id where deserializer returned runme.dev/id', async () => {
      const serializer: any = new ConnectSerializer(context, new Server(), new Kernel())
      const fixture = deepCopyFixture()

      fixture.cells.forEach((cell: { metadata: { [x: string]: any } }) => {
        delete cell.metadata['id']
        expect(cell.metadata['id']).toBeUndefined()
      })

      // make serializer.lifecycleIdentity return 3
      ContextState.getKey = vi.fn().mockImplementation(() => 3)

      const applied = serializer.applyCellIdentity(fixture)

      const ref = deepCopyFixture()
      applied.cells.forEach((cell: { metadata: { [x: string]: any } }, i: number) => {
        expect(cell.metadata['id']).toBeDefined()
        expect(cell.metadata['runme.dev/id']).toStrictEqual(ref.cells[i].metadata['runme.dev/id'])
      })
    })
  })
})
