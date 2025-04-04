import { ExtensionContext, notebooks, Uri } from 'vscode'
import { suite, vi, it, beforeAll, afterAll, afterEach, expect } from 'vitest'
import { HttpResponse, graphql } from 'msw'
import { setupServer } from 'msw/node'

import saveCellExecution, {
  type APIRequestMessage,
} from '../../../../src/extension/messages/platformRequest/saveCellExecution'
import { Kernel } from '../../../../src/extension/kernel'
import { ClientMessages } from '../../../../src/constants'
import { APIMethod } from '../../../../src/types'
import { ConnectSerializer } from '../../../../src/extension/serializer/connect'
import {
  StatefulAuthProvider,
  StatefulAuthSession,
} from '../../../../src/extension/provider/statefulAuth'

vi.mock('../../../../src/extension/serializer/serializer', async (importOriginal) => {
  const original = (await importOriginal()) as any
  return {
    ...original,
    getDocumentCacheId: vi.fn().mockReturnValue('cache-id'),
  }
})

vi.mock('../../../../src/extension/features', async (importOriginal) => {
  const original = (await importOriginal()) as any
  original.default.isOnInContextState = vi.fn().mockReturnValue(true)
  return original
})

vi.mock('vscode-telemetry')
vi.mock('../../../src/extension/runner', () => ({}))
vi.mock('../../../src/extension/grpc/runner/v1', () => ({}))
vi.mock('node:os', async (importOriginal) => {
  const original = (await importOriginal()) as any
  return {
    default: {
      ...original.default,
      platform: vi.fn().mockReturnValue('linux'),
    },
  }
})

vi.mock('vscode', async () => {
  const mocked = (await vi.importActual('../../../../__mocks__/vscode')) as any
  return {
    ...mocked,
    default: {
      NotebookCellKind: {
        Markup: 1,
        Code: 2,
      },
    },
    window: {
      ...mocked.window,
    },
  }
})

vi.mock('../../../../src/extension/cell', async () => {
  const actual = await import('../../../../src/extension/cell')
  return {
    ...actual,
    getCellById: vi.fn(),
  }
})

const graphqlHandlers = [
  graphql.mutation('CreateExtensionCellOutput', () => {
    return HttpResponse.json({
      data: {
        id: 'cell-id',
        htmlUrl: 'https://app.runme.dev/cell/gotyou!',
      },
    })
  }),
]

const server = setupServer(...graphqlHandlers)

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
})

afterAll(() => {
  server.close()
})

afterEach(() => {
  server.resetHandlers()
})

const mockCellInCache = (kernel, cellId) => {
  vi.spyOn(kernel, 'getNotebookDataCache').mockImplementationOnce(() => ({
    cells: [],
  }))
  vi.spyOn(ConnectSerializer, 'marshalNotebook').mockReturnValueOnce(<any>{
    cells: [
      {
        kind: 2,
        languageId: 'markdown',
        outputs: [],
        value: '',
        metadata: {
          id: cellId,
        },
      },
    ],
    metadata: {},
  })
}

const contextFake: ExtensionContext = {
  extensionUri: Uri.parse('file:///Users/fakeUser/projects/vscode-runme'),
  secrets: {
    store: vi.fn(),
  },
  subscriptions: [],
} as any

StatefulAuthProvider.initialize(contextFake)

suite('Save cell execution', () => {
  const kernel = new Kernel({} as any)
  it('Should save the output for authenticated user', async () => {
    const cellId = 'cell-id'
    mockCellInCache(kernel, cellId)
    const messaging = notebooks.createRendererMessaging('runme-renderer')
    const authenticationSession: StatefulAuthSession = {
      accessToken: '',
      id: '',
      scopes: ['repo'],
      account: {
        id: '',
        label: '',
      },
      isExpired: false,
      expiresIn: 2145848400000,
    }
    const message = {
      type: ClientMessages.platformApiRequest,
      output: {
        id: cellId,
        method: APIMethod.CreateCellExecution,
        data: {
          stdout: 'hello world',
        },
      },
    } as any
    const requestMessage: APIRequestMessage = {
      messaging,
      message,
      editor: {
        notebook: {
          save: vi.fn(),
          uri: { fsPath: '/foo/bar/README.md' },
          metadata: {
            ['runme.dev/frontmatterParsed']: { runme: { id: 'ulid' } },
          },
        },
      } as any,
    }
    vi.spyOn(StatefulAuthProvider.instance, 'currentSession').mockResolvedValue(
      authenticationSession,
    )
    await saveCellExecution(requestMessage, kernel)

    expect(messaging.postMessage).toMatchInlineSnapshot(`
      [MockFunction spy] {
        "calls": [
          [
            {
              "from": "kernel",
            },
          ],
          [
            {
              "output": {
                "snapshot": "{"features":{},"context":{"os":"linux","vsCodeVersion":"9.9.9","githubAuth":false,"statefulAuth":false}}",
              },
              "type": "features:updateAction",
            },
          ],
          [
            {
              "output": {
                "data": {
                  "data": {
                    "htmlUrl": "https://app.runme.dev/cell/gotyou!",
                    "id": "cell-id",
                  },
                },
                "id": "cell-id",
              },
              "type": "common:platformApiResponse",
            },
          ],
        ],
        "results": [
          {
            "type": "return",
            "value": undefined,
          },
          {
            "type": "return",
            "value": undefined,
          },
          {
            "type": "return",
            "value": undefined,
          },
        ],
      }
    `)
  })

  it('Should not save cell output when user is not authenticated', async () => {
    const cellId = 'cell-id'
    const messaging = notebooks.createRendererMessaging('runme-renderer')
    const message = {
      type: ClientMessages.platformApiRequest,
      output: {
        id: cellId,
        method: APIMethod.CreateCellExecution,
        data: {
          stdout: 'hello world',
        },
      },
    } as any
    const requestMessage: APIRequestMessage = {
      messaging,
      message,
      editor: {
        notebook: {
          save: vi.fn(),
          uri: { fsPath: '/foo/bar/README.md' },
          metadata: {
            ['runme.dev/frontmatterParsed']: { runme: { id: 'ulid' } },
          },
        },
      } as any,
    }
    vi.spyOn(StatefulAuthProvider.instance, 'currentSession').mockResolvedValue(undefined)
    await saveCellExecution(requestMessage, kernel)

    expect(messaging.postMessage).toMatchInlineSnapshot(`
      [MockFunction spy] {
        "calls": [
          [
            {
              "from": "kernel",
            },
          ],
          [
            {
              "output": {
                "snapshot": "{"features":{},"context":{"os":"linux","vsCodeVersion":"9.9.9","githubAuth":false,"statefulAuth":false}}",
              },
              "type": "features:updateAction",
            },
          ],
          [
            {
              "output": {
                "data": {
                  "data": {
                    "htmlUrl": "https://app.runme.dev/cell/gotyou!",
                    "id": "cell-id",
                  },
                },
                "id": "cell-id",
              },
              "type": "common:platformApiResponse",
            },
          ],
          [
            {
              "output": {
                "data": "You must authenticate with your Stateful account",
                "hasErrors": true,
                "id": "cell-id",
              },
              "type": "common:platformApiResponse",
            },
          ],
        ],
        "results": [
          {
            "type": "return",
            "value": undefined,
          },
          {
            "type": "return",
            "value": undefined,
          },
          {
            "type": "return",
            "value": undefined,
          },
          {
            "type": "return",
            "value": undefined,
          },
        ],
      }
    `)
  })

  it("Should throw if there's not cache notebook", async () => {
    const cellId = 'cell-id'
    const cacheId = 'cache-id'

    const authenticationSession: StatefulAuthSession = {
      accessToken: '',
      id: '',
      scopes: ['repo'],
      account: {
        id: '',
        label: '',
      },
      isExpired: false,
      expiresIn: 2145848400000,
    }
    vi.spyOn(StatefulAuthProvider.instance, 'currentSession').mockResolvedValue(
      authenticationSession,
    )
    vi.spyOn(kernel, 'getNotebookDataCache').mockImplementationOnce(() => undefined)

    const messaging = notebooks.createRendererMessaging('runme-renderer')
    const message = {
      type: ClientMessages.platformApiRequest,
      output: {
        id: cellId,
        method: APIMethod.CreateCellExecution,
        data: {
          stdout: 'hello world',
        },
      },
    } as any
    const requestMessage: APIRequestMessage = {
      messaging,
      message,
      editor: {
        notebook: {
          save: vi.fn(),
          uri: { fsPath: '/foo/bar/README.md' },
          metadata: {
            ['runme.dev/frontmatterParsed']: { runme: { id: 'ulid' } },
          },
        },
      } as any,
    }
    await saveCellExecution(requestMessage, kernel)

    expect(messaging.postMessage).toHaveBeenCalledWith({
      output: {
        data: `Notebook data cache not found for cache ID: ${cacheId}`,
        hasErrors: true,
        id: cellId,
      },
      type: ClientMessages.platformApiResponse,
    })
  })

  it("Should throw if there's the cell is not found in the marshalled notebook", async () => {
    const cellId = 'cell-id'
    const notebookId = 'ulid'

    const authenticationSession: StatefulAuthSession = {
      accessToken: '',
      id: '',
      scopes: ['repo'],
      account: {
        id: '',
        label: '',
      },
      isExpired: false,
      expiresIn: 2145848400000,
    }
    vi.spyOn(StatefulAuthProvider.instance, 'currentSession').mockResolvedValue(
      authenticationSession,
    )
    vi.spyOn(kernel, 'getNotebookDataCache').mockImplementationOnce(() => ({
      cells: [],
    }))
    vi.spyOn(ConnectSerializer, 'marshalNotebook').mockReturnValueOnce(<any>{
      cells: [],
      metadata: {},
      frontmatter: {
        terminalRows: '0',
        category: 'notebook',
        cwd: '/foo/bar',
        shell: 'bash',
        skipPrompts: false,
        runme: {
          version: '0.0.1',
          id: notebookId,
        },
        tag: '',
      },
    })
    const messaging = notebooks.createRendererMessaging('runme-renderer')
    const message = {
      type: ClientMessages.platformApiRequest,
      output: {
        id: cellId,
        method: APIMethod.CreateCellExecution,
        data: {
          stdout: 'hello world',
        },
      },
    } as any
    const requestMessage: APIRequestMessage = {
      messaging,
      message,
      editor: {
        notebook: {
          save: vi.fn(),
          uri: { fsPath: '/foo/bar/README.md' },
          metadata: {
            ['runme.dev/frontmatterParsed']: { runme: { id: 'ulid' } },
          },
        },
      } as any,
    }
    await saveCellExecution(requestMessage, kernel)

    expect(messaging.postMessage).toHaveBeenCalledWith({
      output: {
        data: `Cell not found in notebook ${notebookId}`,
        hasErrors: true,
        id: cellId,
      },
      type: ClientMessages.platformApiResponse,
    })
  })
})
