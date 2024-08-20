import { test, expect, vi, suite, beforeEach } from 'vitest'
import { NotebookCell, commands, notebooks, window, workspace } from 'vscode'

import { Kernel } from '../../src/extension/kernel'
import executors from '../../src/extension/executors'
import { TelemetryReporter } from '../../__mocks__/vscode-telemetry'
import { ClientMessages } from '../../src/constants'
import { APIMethod } from '../../src/types'
import * as platform from '../../src/extension/messages/platformRequest/saveCellExecution'
import { isPlatformAuthEnabled } from '../../src/utils/configuration'
import { askAlternativeOutputsAction } from '../../src/extension/commands'

vi.mock('vscode')
vi.mock('vscode-telemetry')
vi.mock('../../src/extension/utils', async () => {
  return {
    getKeyInfo: vi.fn((cell) => ({ key: cell.languageId, uriResource: false })),
    getAnnotations: vi.fn((cell) => cell.metadata),
    getNotebookCategories: vi.fn().mockResolvedValue([]),
    isWindows: () => false,
    isShellLanguage: () => false,
    getAuthSession: vi.fn().mockResolvedValue({
      accessToken: '123',
    }),
  }
})
vi.mock('../../src/utils/configuration', async (importActual) => {
  const actual = (await importActual()) as any
  return {
    ...actual,
    isPlatformAuthEnabled: vi.fn(),
  }
})
vi.mock('../../src/extension/executors/index.js', () => ({
  default: { foobar: vi.fn() },
  ENV_STORE_MANAGER: {},
}))
vi.mock('../../src/extension/runner', () => ({}))
vi.mock('../../src/extension/grpc/runner/v1', () => ({}))
vi.mock('../../src/extension/commands', () => ({ askAlternativeOutputsAction: vi.fn() }))
vi.mock('../../src/extension/messages/platformRequest/saveCellExecution')
vi.mock('../../../../src/extension/services/runme', () => ({
  RunmeService: class {
    async getUserToken() {}
    constructor() {
      this.getUserToken = vi.fn().mockResolvedValue({
        token: 'token',
      })
    }
  },
}))

const genCells = (cnt: number, metadata: Record<string, any> = {}) =>
  [...new Array(cnt)].map(
    (_, i) =>
      ({
        document: { getText: vi.fn().mockReturnValue(`Cell #${i}`) },
        notebook: {
          getCells: vi.fn().mockReturnValue([...new Array(10)].map(() => ({ kind: 2 }))),
        },
        metadata: {
          'runme.dev/name': `Cell #${i}`,
          category: '',
          ...metadata,
        },
      }) as any as NotebookCell,
  )
suite('#handleRendererMessage', () => {
  const editor = {
    notebook: {
      metadata: {
        ['runme.dev/frontmatterParsed']: { runme: { id: 'ulid' } },
      },
    },
  } as any

  let message = {
    output: {
      id: 'cell-id',
      method: APIMethod.CreateCellExecution,
      data: {
        stdout: 'hello world',
      },
    },
  } as any

  beforeEach(() => {
    vi.mocked(notebooks.createRendererMessaging).mockImplementation((_name: string) => {
      return {
        postMessage: vi.fn(),
        onDidReceiveMessage: vi.fn().mockImplementation((handler) => {
          return handler({ editor: editor, message: message })
        }),
      }
    })
  })

  test('isPlatformAuthEnabled', async () => {
    vi.mocked(platform.default).mockClear()
    vi.mocked(isPlatformAuthEnabled).mockReturnValue(true)

    message = {
      ...message,
      type: ClientMessages.platformApiRequest,
    }
    const messaging = notebooks.createRendererMessaging('foo')
    const requestMessage: platform.APIRequestMessage = {
      messaging: messaging,
      message,
      editor,
    }

    new Kernel({} as any)
    await messaging.postMessage(requestMessage)
    expect(platform.default).toBeCalledTimes(1)
  })

  test(ClientMessages.platformApiRequest, async () => {
    vi.mocked(platform.default).mockClear()
    message = {
      ...message,
      type: ClientMessages.platformApiRequest,
    }

    const messaging = notebooks.createRendererMessaging('foo')
    const requestMessage: platform.APIRequestMessage = {
      messaging: messaging,
      message,
      editor,
    }
    new Kernel({} as any)
    await messaging.postMessage(requestMessage)
    expect(platform.default).toBeCalledTimes(1)
  })
})

test('#doExecuteAndFocusNotebookCell', async () => {
  const k = new Kernel({} as any)
  const cell = { index: 20 } as NotebookCell

  await k.doExecuteAndFocusNotebookCell(cell)

  expect(commands.executeCommand).toHaveBeenCalledWith('notebook.focusTop')
  expect(commands.executeCommand).toHaveBeenNthCalledWith(20, 'notebook.focusNextEditor')
  expect(commands.executeCommand).toHaveBeenCalledWith('notebook.cell.execute')
  expect(commands.executeCommand).toHaveBeenCalledWith('notebook.cell.focusInOutput')
})

test('#executeAndFocusNotebookCell', async () => {
  const k = new Kernel({} as any)
  const cell = { index: 20 } as NotebookCell

  await k.executeAndFocusNotebookCell(cell)
  expect(window.onDidChangeNotebookEditorSelection).toHaveBeenCalledOnce()
})

test('dispose', () => {
  vi.mocked(notebooks.createRendererMessaging).mockImplementation((_name: string) => {
    return {
      postMessage: vi.fn(),
      onDidReceiveMessage: vi.fn().mockImplementation(() => {
        return { dispose: vi.fn() }
      }),
    }
  })

  const k = new Kernel({} as any)
  const reset = vi.fn()
  ;(k as any).getEnvironmentManager = vi.fn().mockImplementation(() => ({ reset }))

  k.dispose()
  expect(reset).toBeCalledTimes(1)
})

suite('_executeAll', async () => {
  test('does not run cells if it is a session outputs document', async () => {
    const k = new Kernel({} as any)

    const cells = genCells(1)
    ;(cells[0].notebook.uri as any) = { fsPath: '/foo/bar' }
    ;(cells[0].notebook.metadata as any) = {
      'runme.dev/frontmatterParsed': {
        runme: {
          session: {
            id: 'abc123',
          },
        },
      },
    }
    await k['_executeAll'](cells)
    expect(askAlternativeOutputsAction).toBeCalledTimes(1)
  })

  test('runs individual cells or cell selections', async () => {
    window.showQuickPick = vi.fn().mockReturnValue(new Promise(() => {}))
    const k = new Kernel({} as any)
    k['_doExecuteCell'] = vi.fn()
    await k['_executeAll'](genCells(10).slice(0, 5))
    expect(k['_doExecuteCell']).toBeCalledTimes(5)
    expect(TelemetryReporter.sendTelemetryEvent).lastCalledWith('cells.executeAll', {
      'cells.executed': '5',
      'cells.total': '10',
    })
  })

  test('runs cells if answer is yes', async () => {
    const k = new Kernel({} as any)
    // @ts-ignore readonly
    window.showQuickPick = vi.fn().mockResolvedValue('Yes')
    k['_doExecuteCell'] = vi.fn()
    await k['_executeAll'](genCells(10))
    expect(window.showQuickPick).toBeCalledTimes(10)
    expect(k['_doExecuteCell']).toBeCalledTimes(10)
    expect(TelemetryReporter.sendTelemetryEvent).lastCalledWith('cells.executeAll', {
      'cells.executed': '10',
      'cells.total': '10',
    })
  })

  test('do not show confirmation for notebooks with just one cell', async () => {
    const k = new Kernel({} as any)
    // @ts-ignore readonly
    window.showQuickPick = vi.fn().mockResolvedValue('Yes')
    k['_doExecuteCell'] = vi.fn()
    await k['_executeAll'](genCells(1))
    expect(window.showQuickPick).toBeCalledTimes(0)
    expect(k['_doExecuteCell']).toBeCalledTimes(1)
    expect(TelemetryReporter.sendTelemetryEvent).lastCalledWith('cells.executeAll', {
      'cells.executed': '1',
      'cells.total': '10',
    })
  })

  test('runs no cells if answer is no', async () => {
    const k = new Kernel({} as any)
    // @ts-ignore readonly
    window.showQuickPick = vi.fn().mockResolvedValue('No')
    k['_doExecuteCell'] = vi.fn()
    await k['_executeAll'](genCells(10))
    expect(window.showQuickPick).toBeCalledTimes(10)
    expect(k['_doExecuteCell']).toBeCalledTimes(0)
    expect(TelemetryReporter.sendTelemetryEvent).lastCalledWith('cells.executeAll', {
      'cells.executed': '0',
      'cells.total': '10',
    })
  })

  test('cancels execution completely', async () => {
    const k = new Kernel({} as any)
    // @ts-ignore readonly
    window.showQuickPick = vi.fn().mockResolvedValue('Cancel')
    k['_doExecuteCell'] = vi.fn()
    await k['_executeAll'](genCells(10))
    expect(window.showQuickPick).toBeCalledTimes(1)
    expect(k['_doExecuteCell']).toBeCalledTimes(0)
    expect(TelemetryReporter.sendTelemetryEvent).lastCalledWith('cells.executeAll', {
      'cells.executed': '0',
      'cells.total': '10',
    })
  })

  test('skips prompt', async () => {
    const k = new Kernel({} as any)
    // @ts-ignore readonly
    window.showQuickPick = vi.fn().mockResolvedValue('Skip confirmation and run all')
    k['_doExecuteCell'] = vi.fn()
    await k['_executeAll'](genCells(10))
    expect(window.showQuickPick).toBeCalledTimes(1)
    expect(k['_doExecuteCell']).toBeCalledTimes(10)
    expect(TelemetryReporter.sendTelemetryEvent).lastCalledWith('cells.executeAll', {
      'cells.executed': '10',
      'cells.total': '10',
    })
  })

  test('does not runs any cells for non-existent cell category', async () => {
    window.showQuickPick = vi.fn().mockReturnValue(new Promise(() => {}))
    const k = new Kernel({} as any)
    k.setCategory('shellscripts')
    k['_doExecuteCell'] = vi.fn()
    await k['_executeAll'](genCells(10).slice(0, 5))
    expect(k['_doExecuteCell']).toBeCalledTimes(0)
    expect(TelemetryReporter.sendTelemetryEvent).lastCalledWith('cells.executeAll', {
      'cells.executed': '0',
      'cells.total': '10',
    })
  })

  test('does run cells for specific cell category', async () => {
    window.showQuickPick = vi.fn().mockReturnValue(new Promise(() => {}))
    const k = new Kernel({} as any)
    k.setCategory('shellscripts')
    k['_doExecuteCell'] = vi.fn()
    const cellsFromCategory = genCells(2, { category: 'shellscripts' }).concat(genCells(5))
    await k['_executeAll'](cellsFromCategory)
    expect(k['_doExecuteCell']).toBeCalledTimes(2)
    expect(TelemetryReporter.sendTelemetryEvent).lastCalledWith('cells.executeAll', {
      'cells.executed': '2',
      'cells.total': '10',
    })
  })

  test('does run cells for specific cell category and skip cells with excludeFromRunAll', async () => {
    window.showQuickPick = vi.fn().mockReturnValue(new Promise(() => {}))
    const k = new Kernel({} as any)
    k.setCategory('shellscripts')
    k['_doExecuteCell'] = vi.fn()
    const cellsFromCategory = genCells(2, {
      category: 'foo,shellscripts,bar',
      excludeFromRunAll: true,
    })
      .concat(genCells(1, { category: 'bar,shellscripts,foo' }))
      .concat(genCells(1, { category: 'barfoo,shellscripts' }))
      .concat(genCells(1))
    await k['_executeAll'](cellsFromCategory)
    expect(k['_doExecuteCell']).toBeCalledTimes(2)
    expect(TelemetryReporter.sendTelemetryEvent).lastCalledWith('cells.executeAll', {
      'cells.executed': '2',
      'cells.total': '10',
    })
  })
})

suite('_doExecuteCell', () => {
  beforeEach(() => {
    vi.mocked(workspace.openTextDocument).mockReset()
    vi.mocked(TelemetryReporter.sendTelemetryEvent).mockClear()
  })

  test('calls proper executor if present', async () => {
    const k = new Kernel({} as any)

    k.createCellExecution = vi.fn().mockResolvedValue({
      start: vi.fn(),
      end: vi.fn(),
      underlyingExecution: vi.fn(),
    })
    k.getCellOutputs = vi.fn().mockResolvedValue({})
    k.openAndWaitForTextDocument = vi
      .fn()
      .mockImplementation(() => ({ languageId: 'foobar', getText: () => 'foobar cell' }))

    vi.mocked(workspace.openTextDocument).mockResolvedValueOnce({
      languageId: 'foobar',
    } as any)

    await k['_doExecuteCell']({
      document: { uri: { fsPath: '/foo/bar' } },
      metadata: { 'runme.dev/id': '01HGVC56X3XDWBPCC0NQDMGJ1Q' },
    } as any)
    // @ts-expect-error mocked out
    expect(executors.foobar).toBeCalledTimes(1)
    expect(TelemetryReporter.sendTelemetryEvent).toHaveBeenCalledWith('cell.startExecute')
    expect(TelemetryReporter.sendTelemetryEvent).toHaveBeenCalledWith('cell.endExecute', {
      'cell.success': undefined,
      'cell.mimeType': undefined,
    })
  })

  test('shows error window if language is not supported', async () => {
    const k = new Kernel({} as any)
    k['runner'] = undefined

    k.createCellExecution = vi.fn().mockResolvedValue({
      start: vi.fn(),
      end: vi.fn(),
      underlyingExecution: vi.fn(),
    })
    k.getCellOutputs = vi.fn().mockResolvedValue({})
    k.openAndWaitForTextDocument = vi
      .fn()
      // languageId makes sure no executor is found
      .mockImplementation(() => ({ languageId: undefined, getText: () => 'foobar cell' }))

    vi.mocked(workspace.openTextDocument).mockResolvedValueOnce({
      languageId: 'barfoo',
    } as any)

    try {
      await k['_doExecuteCell']({
        document: { uri: { fsPath: '/foo/bar' } },
        metadata: {
          'runme.dev/id': '01HGVC56X3XDWBPCC0NQDMGJ1Q',
          mimeType: 'text/plain',
        },
      } as any)
    } catch (e) {
      console.error(e)
    }

    expect(TelemetryReporter.sendTelemetryEvent).toHaveBeenCalledWith('cell.startExecute')
    expect(TelemetryReporter.sendTelemetryEvent).toHaveBeenCalledWith('cell.endExecute', {
      'cell.success': 'false',
      'cell.mimeType': 'text/plain',
    })
  })
})

test('supportedLanguages', async () => {
  const k = new Kernel({} as any)

  expect(k.getSupportedLanguages()![0]).toStrictEqual('shellscript')
})
