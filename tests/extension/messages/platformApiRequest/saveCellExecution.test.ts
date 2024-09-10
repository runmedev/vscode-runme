import { AuthenticationSession, authentication, notebooks } from 'vscode'
import { suite, vi, it, beforeAll, afterAll, afterEach, expect } from 'vitest'
import { HttpResponse, graphql } from 'msw'
import { setupServer } from 'msw/node'

import saveCellExecution, {
  type APIRequestMessage,
} from '../../../../src/extension/messages/platformRequest/saveCellExecution'
import { Kernel } from '../../../../src/extension/kernel'
import { ClientMessages } from '../../../../src/constants'
import { APIMethod } from '../../../../src/types'
import { GrpcSerializer } from '../../../../src/extension/serializer'

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

suite('Save cell execution', () => {
  const kernel = new Kernel({} as any)
  kernel.hasExperimentEnabled = vi.fn((params) => params === 'reporter')
  it('Should save the output for authenticated user', async () => {
    const messaging = notebooks.createRendererMessaging('runme-renderer')
    const authenticationSession: AuthenticationSession = {
      accessToken: '',
      id: '',
      scopes: ['repo'],
      account: {
        id: '',
        label: '',
      },
    }
    const message = {
      type: ClientMessages.platformApiRequest,
      output: {
        id: 'cell-id',
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
    vi.spyOn(GrpcSerializer, 'marshalNotebook').mockReturnValue({
      cells: [],
      metadata: {},
    })
    vi.mocked(authentication.getSession).mockResolvedValue(authenticationSession)

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
                "snapshot": "{"features":[],"context":{"os":"linux","vsCodeVersion":"9.9.9","githubAuth":false,"statefulAuth":false}}",
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
    const messaging = notebooks.createRendererMessaging('runme-renderer')
    const message = {
      type: ClientMessages.platformApiRequest,
      output: {
        id: 'cell-id',
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
    vi.mocked(authentication.getSession).mockResolvedValue(undefined)
    vi.spyOn(GrpcSerializer, 'marshalNotebook').mockReturnValue({
      cells: [],
      metadata: {},
    })

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
                "snapshot": "{"features":[],"context":{"os":"linux","vsCodeVersion":"9.9.9","githubAuth":false,"statefulAuth":false}}",
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
                "data": {
                  "displayShare": false,
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
          {
            "type": "return",
            "value": undefined,
          },
        ],
      }
    `)
  })
})
