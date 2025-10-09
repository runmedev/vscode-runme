import path from 'node:path'

import { vi, suite, test, expect, beforeEach } from 'vitest'
import { type GrpcTransport } from '@protobuf-ts/grpc-transport'
import {
  EventEmitter,
  NotebookCellKind,
  Position,
  tasks,
  commands,
  EndOfLine,
  window,
} from 'vscode'
import { URI } from 'vscode-uri'

import { GrpcRunnerClient } from '../../../src/extension/runner/client'
import GrpcRunner, {
  GrpcRunnerProgramSession,
  IRunner,
  NON_TTY_BUFFER_SPAN_MS,
  RunProgramOptions,
} from '../../../src/extension/runner'
import { GrpcRunnerEnvironment } from '../../../src/extension/runner/environment'
import { type ExecuteResponse } from '../../../src/extension/grpc/runner/v1'
import { ActionCommand, RunmeCodeLensProvider } from '../../../src/extension/provider/codelens'
import { RunmeTaskProvider } from '../../../src/extension/provider/runmeTask'
import { isWindows } from '../../../src/extension/utils'
import { SurveyWinCodeLensRun } from '../../../src/extension/survey'

vi.mock('../../../src/extension/utils', () => ({
  getGrpcHost: vi.fn().mockReturnValue('127.0.0.1:7863'),
  getAnnotations: vi.fn().mockReturnValue({}),
  isWindows: vi.fn().mockReturnValue(false),
  convertEnvList: vi.fn().mockImplementation((envs: string[]) =>
    envs.reduce(
      (prev, curr) => {
        const [key, value = ''] = curr.split(/\=(.*)/s)
        prev[key] = value

        return prev
      },
      {} as Record<string, string | undefined>,
    ),
  ),
}))

vi.mock('vscode', async () => ({
  ...(await import(path.join(process.cwd(), '__mocks__', 'vscode'))),
}))

vi.mock('vscode-telemetry')

vi.mock('@protobuf-ts/grpc-transport', () => ({
  GrpcTransport: class {
    constructor() {}

    close() {}
  },
}))

let id = 0

const resetId = () => {
  id = 0
}

const createSession = vi.fn((envs?: string[]) => ({
  id: (id++).toString(),
  envs: [...(envs ?? []), 'foo=bar'],
}))

const deleteSession = vi.fn(async () => ({}))

class MockedDuplexClientStream {
  constructor() {}

  _onMessage = new EventEmitter<ExecuteResponse>()
  _onComplete = new EventEmitter<void>()
  _onError = new EventEmitter<Error>()

  responses = {
    onMessage: this._onMessage.event,
    onComplete: this._onComplete.event,
    onError: this._onError.event,
  }

  requests = {
    send: vi.fn(async () => {}),
    complete: vi.fn(),
  }
}

vi.mock('../../../src/extension/grpc/tcpClient', () => {
  class MockedRunnerServiceClient {
    constructor() {}

    async createSession(request: { envs?: string[] }) {
      return {
        response: {
          session: createSession(request.envs),
        },
      }
    }

    async deleteSession() {
      return {
        response: deleteSession(),
      }
    }

    execute() {
      return new MockedDuplexClientStream()
    }
  }

  return {
    RunnerServiceClient: MockedRunnerServiceClient,
    getRunnerServiceClient: vi.fn(() => new MockedRunnerServiceClient()),
  }
})

vi.mock('@buf/runmedev_runme.community_timostamm-protobuf-ts/runme/runner/v1/runner_pb', () => ({
  default: {},
  CreateSessionRequest: {
    create: vi.fn((x: any) => x),
  },
  ExecuteRequest: {
    create: vi.fn((x: any) => x),
  },
  Winsize: {
    create: vi.fn((x: any) => x),
  },
}))

class MockedKernelServer {
  _onTransportReady = new EventEmitter<{ transport: GrpcTransport }>()
  _onClose = new EventEmitter<{ code: number | null }>()

  onTransportReady = this._onTransportReady.event
  onClose = this._onClose.event
}

vi.mock('../../../src/extension/provider/runmeTask', async () => {
  return {
    RunmeTaskProvider: {
      newRunmeTask: vi.fn().mockResolvedValue({}),
    },
  }
})

beforeEach(() => {
  resetId()
  deleteSession.mockClear()
})

suite('grpc runner client', () => {
  test('cannot get runner environment variables not initialized', async () => {
    const { runner } = createGrpcRunner(false)
    await expect(runner.getEnvironmentVariables({} as any)).rejects.toThrowError(
      'Invalid runner environment!',
    )
  })

  test('cannot use client if server is closed', async () => {
    const { client, server } = createGrpcRunnerClient(true)

    server._onClose.fire({ code: null })
    await expect(() => client.execute()).toThrowError('Client is not active!')
  })
})

suite('grpc runner', () => {
  test('runner environment dispose is called on runner dispose', async () => {
    const { runner } = createGrpcRunner()
    const runnerEnv = (await runner.createEnvironment({})) as GrpcRunnerEnvironment

    const oldEnvDispose = runnerEnv.dispose

    const runnerEnvDispose = vi.fn(async () => {
      await oldEnvDispose.call(runnerEnv)
    })

    runnerEnv.dispose = runnerEnvDispose

    await runner.dispose()

    expect(runnerEnvDispose).toBeCalledTimes(1)
    expect(deleteSession).toBeCalledTimes(1)
  })

  test('runner environment has loaded variables', async () => {
    const { runner } = createGrpcRunner()
    const runnerEnv = await runner.createEnvironment({ envs: ['bar=baz'] })

    const initialEnvs = runnerEnv.initialEnvs()

    // { 'foo': 'bar', 'bar': 'baz' }
    expect(initialEnvs).toStrictEqual(new Set(['foo', 'bar']))
  })

  test('cannot create runner environment if server not initialized', async () => {
    const { runner } = createGrpcRunner(false)
    await expect(runner.createEnvironment({})).rejects.toThrowError('Client is not active!')
  })

  test('cannot create program session if server not initialized', async () => {
    const { runner } = createGrpcRunner(false)
    await expect(runner.createProgramSession({ programName: 'sh' })).rejects.toThrowError(
      'Client is not active!',
    )
  })

  test('cannot create runner environment if server closed', async () => {
    const { runner, server } = createGrpcRunner(true)

    server._onClose.fire({ code: null })
    await expect(runner.createEnvironment({})).rejects.toThrowError('Client is not active!')
  })

  test('cannot create program session if server closed', async () => {
    const { runner, server } = createGrpcRunner(true)

    server._onClose.fire({ code: null })
    await expect(runner.createProgramSession({ programName: 'sh' })).rejects.toThrowError(
      'Client is not active!',
    )
  })

  suite('grpc program session', () => {
    beforeEach(() => {
      vi.mocked(window.showErrorMessage).mockClear()
    })

    test('session dispose is called on runner dispose', async () => {
      const { runner, session, duplex } = await createNewSession()

      const oldSessionDispose = session.dispose

      const sessionDispose = vi.fn(async () => {
        await oldSessionDispose.call(session)
      })

      session.dispose = sessionDispose

      await runner.dispose()

      expect(sessionDispose).toBeCalledTimes(1)
      expect(duplex.requests.complete).toBeCalledTimes(1)
    })

    test('duplex onMessage calls stdout raw', async () => {
      const { duplex, stdoutListener, stderrListener } = await createNewSession()

      duplex._onMessage.fire({
        stdoutData: Buffer.from('test'),
        stderrData: Buffer.from(''),
        mimeType: 'text/plain',
      })

      expect(stdoutListener).toBeCalledTimes(1)
      expect(stdoutListener).toBeCalledWith(Buffer.from('test'))

      expect(stderrListener).not.toBeCalled()
    })

    test('duplex onMessage calls stderr raw', async () => {
      const { duplex, stdoutListener, stderrListener } = await createNewSession()

      duplex._onMessage.fire({
        stdoutData: Buffer.from(''),
        stderrData: Buffer.from('test'),
        mimeType: 'text/plain',
      })

      expect(stdoutListener).not.toBeCalled()

      expect(stderrListener).toBeCalledTimes(1)
      expect(stderrListener).toBeCalledWith(Buffer.from('test'))
    })

    test('duplex onMessage exposes PID in background mode', async () => {
      const { duplex, session } = await createNewSession({ background: true })

      duplex._onMessage.fire({
        stdoutData: Buffer.from(''),
        stderrData: Buffer.from(''),
        mimeType: 'text/plain',
        pid: {
          pid: '1234',
        },
      })

      const pid = await session.pid

      expect(pid).toStrictEqual(1234)
    })

    test('PID is defined in non-background mode', async () => {
      const { duplex, session } = await createNewSession()

      duplex._onMessage.fire({
        stdoutData: Buffer.from(''),
        stderrData: Buffer.from(''),
        mimeType: 'text/plain',
        pid: {
          pid: '4321',
        },
      })

      await session.run()

      const pid = await session.pid

      expect(pid).toStrictEqual(4321)
    })

    test('duplex onMessage calls onDidWrite', async () => {
      const { duplex, writeListener } = await createNewSession()

      duplex._onMessage.fire({
        stdoutData: Buffer.from('test'),
        stderrData: Buffer.from(''),
        mimeType: 'text/plain',
      })

      expect(writeListener).toBeCalledTimes(1)
      expect(writeListener).toBeCalledWith('test')
    })

    test('duplex onMessage calls onDidErr', async () => {
      const { duplex, errListener } = await createNewSession()

      duplex._onMessage.fire({
        stdoutData: Buffer.from(''),
        stderrData: Buffer.from('test'),
        mimeType: 'text/plain',
      })

      expect(errListener).toBeCalledTimes(1)
      expect(errListener).toBeCalledWith('test')
    })

    test('duplex onMessage calls close', async () => {
      const { duplex, stdoutListener, stderrListener, closeListener } = await createNewSession()

      duplex._onMessage.fire({
        stdoutData: Buffer.from(''),
        stderrData: Buffer.from(''),
        mimeType: 'text/plain',
        exitCode: {
          value: 1,
        },
      })

      expect(stdoutListener).not.toBeCalled()
      expect(stderrListener).not.toBeCalled()

      expect(closeListener).toBeCalledTimes(1)
      expect(closeListener).toBeCalledWith(1)
    })

    test('initial request has winsize', async () => {
      const { duplex, session } = await createNewSession({
        tty: true,
      })

      session.registerTerminalWindow('vscode')
      session.setActiveTerminalWindow('vscode')

      session.open({ columns: 50, rows: 20 })

      expect(duplex.requests.send).toBeCalledTimes(1)
      expect((duplex.requests.send.mock.calls[0] as any)[0]).toMatchObject({
        tty: true,
        winsize: {
          cols: 50,
          rows: 20,
        },
      })
    })

    test('further requests have winsize', async () => {
      const { duplex, session } = await createNewSession({
        tty: true,
      })

      session.registerTerminalWindow('vscode')
      session.setActiveTerminalWindow('vscode')

      session.open({ columns: 50, rows: 20 })
      session.setDimensions({ columns: 60, rows: 30 })

      expect(duplex.requests.send).toBeCalledTimes(2)
      expect((duplex.requests.send.mock.calls[1] as any)[0]).toStrictEqual({
        winsize: {
          cols: 60,
          rows: 30,
        },
      })
    })

    test('requires all active windows to open before starting', async () => {
      const { duplex, session } = await createNewSession({
        tty: true,
      })

      session.registerTerminalWindow('vscode')

      session.registerTerminalWindow('notebook')
      session.setActiveTerminalWindow('notebook')

      session.open({ columns: 50, rows: 20 })
      expect(duplex.requests.send).toBeCalledTimes(0)

      session.open({ columns: 60, rows: 30 }, 'notebook')
      expect(duplex.requests.send).toBeCalledTimes(1)
      expect((duplex.requests.send.mock.calls[0] as any)[0]).toMatchObject({
        tty: true,
        winsize: {
          cols: 60,
          rows: 30,
        },
      })
      duplex.requests.send.mockClear()

      session.setDimensions({ columns: 70, rows: 40 })
      expect(duplex.requests.send).toBeCalledTimes(0)

      duplex.requests.send.mockClear()

      session.setDimensions({ columns: 80, rows: 50 }, 'notebook')
      expect(duplex.requests.send).toBeCalledTimes(1)
      expect((duplex.requests.send.mock.calls[0] as any)[0]).toStrictEqual({
        winsize: {
          cols: 80,
          rows: 50,
        },
      })
      duplex.requests.send.mockClear()

      await session.setActiveTerminalWindow('vscode')
      expect(duplex.requests.send).toBeCalledTimes(1)
      expect((duplex.requests.send.mock.calls[0] as any)[0]).toStrictEqual({
        winsize: { cols: 70, rows: 40 },
      })
    })

    test('active window does not send dimensions if program is uninitialized', async () => {
      const { duplex, session } = await createNewSession({
        tty: true,
      })

      session.registerTerminalWindow('vscode', { rows: 40, columns: 40 })
      session.registerTerminalWindow('notebook', { rows: 50, columns: 50 })

      await session.setActiveTerminalWindow('vscode')
      expect(duplex.requests.send).toBeCalledTimes(0)
      duplex.requests.send.mockClear()

      session.open(undefined, 'vscode')
      session.open(undefined, 'notebook')

      expect(duplex.requests.send).toBeCalledTimes(1)
      expect((duplex.requests.send.mock.calls[0] as any)[0]).toMatchObject({
        tty: true,
        winsize: {
          cols: 40,
          rows: 40,
        },
      })
      duplex.requests.send.mockClear()

      await session.setActiveTerminalWindow('notebook')
      expect((duplex.requests.send.mock.calls[0] as any)[0]).toStrictEqual({
        winsize: {
          cols: 50,
          rows: 50,
        },
      })
      duplex.requests.send.mockClear()
    })

    test('cannot set dimensions of unregistered terminal window', async () => {
      const { session } = await createNewSession({
        tty: true,
      })

      expect(session.setDimensions({ columns: 10, rows: 10 }, 'vscode')).rejects.toThrowError(
        'Tried to set dimensions for unregistered terminal window vscode',
      )
    })

    test('cannot set active terminal to unregistered window', async () => {
      const { session } = await createNewSession({
        tty: true,
      })

      session.registerTerminalWindow('vscode')
      session.setActiveTerminalWindow('vscode')

      const consoleError = vi.spyOn(console, 'error')
      session.setActiveTerminalWindow('notebook')

      expect(consoleError).toBeCalledWith(
        "Attempted to set active terminal window to unregistered window 'notebook'",
      )
    })

    test('cannot open unregistered terminal window', async () => {
      const { session } = await createNewSession({
        tty: true,
      })

      const consoleError = vi.spyOn(console, 'error')
      session.open(undefined, 'notebook')

      expect(consoleError).toBeCalledWith(
        "Attempted to open unregistered terminal window 'notebook'!",
      )
      expect(session['terminalWindows'].get('notebook')?.opened).toBeUndefined()
    })

    test('cannot open terminal window twice', async () => {
      const { session } = await createNewSession({
        tty: true,
      })

      session.registerTerminalWindow('notebook')

      const consoleWarn = vi.spyOn(console, 'warn')
      session.open(undefined, 'notebook')
      expect(consoleWarn).toBeCalledTimes(0)

      session.open(undefined, 'notebook')

      expect(consoleWarn).toBeCalledWith(
        "Attempted to open terminal window 'notebook' that has already opened!",
      )
    })

    test('onDidWrite replaces returns in non-interactive', async () => {
      const { duplex, writeListener } = await createNewSession({
        tty: false,
        convertEol: true,
      })

      duplex._onMessage.fire({
        stdoutData: Buffer.from('test\n'),
        stderrData: Buffer.from(''),
        mimeType: 'text/plain',
      })

      await waitForBufferTimespan()
      expect(writeListener).toBeCalled()
      expect(writeListener).toBeCalledWith('\rtest\r\r\n')
    })

    test('onDidWrite replaces returns in complex string in non-interactive', async () => {
      const { duplex, writeListener } = await createNewSession({
        tty: false,
        convertEol: true,
      })

      duplex._onMessage.fire({
        stdoutData: Buffer.from('SERVICE_FOO_TOKEN: foobar\r\nSERVICE_BAR_TOKEN: barfoo'),
        stderrData: Buffer.from(''),
        mimeType: 'text/plain',
      })

      await waitForBufferTimespan()
      expect(writeListener).toBeCalled()
      expect(writeListener).toBeCalledWith(
        '\rSERVICE_FOO_TOKEN: foobar\r\r\r\nSERVICE_BAR_TOKEN: barfoo',
      )
    })

    test('onDidWrite replaces returns in non-interactive in stderr', async () => {
      const { duplex, errListener } = await createNewSession({
        tty: false,
        convertEol: true,
      })

      duplex._onMessage.fire({
        stdoutData: Buffer.from(''),
        stderrData: Buffer.from('test\n'),
        mimeType: 'text/plain',
      })

      expect(errListener).toBeCalledTimes(1)
      expect(errListener).toBeCalledWith('test\r\n')
    })

    test('onDidWrite does not replaces returns in interactive', async () => {
      const { duplex, writeListener } = await createNewSession({
        convertEol: true,
        tty: true,
      })

      duplex._onMessage.fire({
        stdoutData: Buffer.from('test\r\n'),
        stderrData: Buffer.from(''),
        mimeType: 'text/plain',
      })

      expect(writeListener).toBeCalledTimes(1)
      expect(writeListener).toBeCalledWith('test\r\n')
    })

    test('onDidWrite does not replace return in non-interactive if flag is off', async () => {
      const { duplex, writeListener } = await createNewSession({
        convertEol: false,
      })

      duplex._onMessage.fire({
        stdoutData: Buffer.from('test\n'),
        stderrData: Buffer.from(''),
        mimeType: 'text/plain',
      })

      expect(writeListener).toBeCalledTimes(1)
      expect(writeListener).toBeCalledWith('test\n')
    })
  })
})

suite('RunmeCodeLensProvider', () => {
  beforeEach(() => {
    vi.mocked(tasks.executeTask).mockClear()
    vi.mocked(isWindows).mockClear()
  })

  test('returns nothing without runner', async () => {
    const provider = createCodeLensProvider()

    const lenses = await provider.provideCodeLenses({} as any, {} as any)

    expect(lenses).toStrictEqual([])
  })

  test('returns serializer result normally', async () => {
    const textParts = [
      '```sh\n',
      'echo "Hello World!"\n```',
      '\n\n',
      '🔥'.repeat(20),
      '🔥'.repeat(20),
      '🔥'.repeat(20),
      '🔥'.repeat(20),
      '\n\n',
      '```sh\n',
      'echo "Hello World!"',
      '\n```',
    ]

    const block1Start = textParts.slice(0, 1).join('')
    const block1End = textParts.slice(0, 2).join('')

    const block2Start = textParts.slice(0, 9).join('')
    const block2End = textParts.slice(0, 10).join('')

    const serializer = {
      deserializeNotebook: vi.fn(async () => ({
        cells: [
          {
            kind: NotebookCellKind.Code,
            metadata: {
              'runme.dev/textRange': {
                start: Buffer.from(block1Start, 'utf-8').length,
                end: Buffer.from(block1End, 'utf-8').length,
              },
            },
          },
          {
            kind: NotebookCellKind.Code,
            metadata: {
              'runme.dev/textRange': {
                start: Buffer.from(block2Start, 'utf-8').length,
                end: Buffer.from(block2End, 'utf-8').length,
              },
            },
          },
        ],
      })),
    } as any

    const provider = createCodeLensProvider(serializer, {} as any)

    const lenses = await provider.provideCodeLenses(
      {
        eol: EndOfLine.LF,
        getText: vi.fn().mockReturnValue(textParts.join('')),
        positionAt: vi.fn((c) => new Position(1, c)),
      } as any,
      {} as any,
    )

    expect(serializer.deserializeNotebook).toBeCalledTimes(1)

    expect(lenses).toHaveLength(6)

    lenses.forEach((lens, i) => {
      switch (i) {
        case 0:
          {
            const line = block1Start.split('\n').length - 2

            expect(lens.range.start.line).toStrictEqual(line)
            expect(lens.range.start.character).toStrictEqual(0)

            expect(lens.range.end.line).toStrictEqual(line)
            expect(lens.range.end.character).toStrictEqual(0)
          }
          break

        case 3:
          {
            const line = block2Start.split('\n').length - 2

            expect(lens.range.start.line).toStrictEqual(line)
            expect(lens.range.start.character).toStrictEqual(0)

            expect(lens.range.end.line).toStrictEqual(line)
            expect(lens.range.end.character).toStrictEqual(0)
          }
          break
      }

      expect(lens.command).toBeTruthy()

      expect(lens.command!.command).toStrictEqual(ActionCommand)

      expect(lens.command!.tooltip).toBeUndefined()
    })
  })

  test('action callback for run command', async () => {
    const provider = createCodeLensProvider({}, {} as any)

    await provider['codeLensActionCallback'](
      { uri: { fsPath: '' } } as any,
      {} as any,
      {} as any,
      {} as any,
      0,
      'run',
    )

    expect(RunmeTaskProvider.newRunmeTask).toBeCalledTimes(1)

    expect(isWindows).toBeCalledTimes(1)

    expect(tasks.executeTask).toBeCalledTimes(1)
    expect(tasks.executeTask).toBeCalledWith({})
  })

  test('action callback for run command on windows', async () => {
    const provider = createCodeLensProvider({}, {} as any)

    provider['surveyWinCodeLensRun']['prompt'] = vi.fn()

    vi.mocked(isWindows).mockReturnValueOnce(true)

    await provider['codeLensActionCallback'](
      { uri: { fsPath: '' } } as any,
      {} as any,
      {} as any,
      {} as any,
      0,
      'run',
    )

    expect(isWindows).toBeCalledTimes(1)
    expect(provider['surveyWinCodeLensRun']['prompt']).toBeCalledTimes(1)

    expect(tasks.executeTask).toBeCalledTimes(0)
  })

  test('action callback for open command', async () => {
    const provider = createCodeLensProvider()

    const document = { uri: { fsPath: '' } }
    await provider['codeLensActionCallback'](
      document as any,
      {} as any,
      {} as any,
      {} as any,
      0,
      'open',
    )

    expect(commands.executeCommand).toBeCalledWith('vscode.openWith', document.uri, 'runme')
  })
})

function waitForBufferTimespan() {
  return new Promise((resolve) => setTimeout(resolve, 4 * NON_TTY_BUFFER_SPAN_MS))
}

function getMockedDuplex(session: GrpcRunnerProgramSession): MockedDuplexClientStream {
  return session['session'] as unknown as MockedDuplexClientStream
}

function createGrpcRunner(initialize = true) {
  const server = new MockedKernelServer()
  const runner = new GrpcRunner(server as any)

  if (initialize) {
    server._onTransportReady.fire({ transport: {} as any })
  }

  return { server, runner }
}

function createGrpcRunnerClient(initialize = true) {
  const server = new MockedKernelServer()
  const client = new GrpcRunnerClient(server as any)

  if (initialize) {
    server._onTransportReady.fire({ transport: {} as any })
  }

  return { server, client }
}

async function createNewSession(
  options: Partial<RunProgramOptions> = {},
  runner?: GrpcRunner,
  initialize?: boolean,
) {
  const { runner: generatedRunner, server } = createGrpcRunner(initialize)

  runner ??= generatedRunner
  const session = (await runner.createProgramSession({
    programName: 'sh',
    tty: true,
    ...options,
  })) as GrpcRunnerProgramSession

  const stdoutListener = vi.fn()
  session.onStdoutRaw(stdoutListener)
  const stderrListener = vi.fn()
  session.onStderrRaw(stderrListener)
  const closeListener = vi.fn()
  session.onDidClose(closeListener)
  const writeListener = vi.fn()
  session.onDidWrite(writeListener)
  const errListener = vi.fn()
  session.onDidErr(errListener)

  return {
    runner,
    session,
    duplex: getMockedDuplex(session),
    stdoutListener,
    stderrListener,
    closeListener,
    writeListener,
    errListener,
    server,
  }
}

function createCodeLensProvider(serializer = {} as any, runner?: IRunner) {
  return new RunmeCodeLensProvider(
    URI.parse('file:///foo/bar'),
    serializer,
    vi.fn(),
    new SurveyWinCodeLensRun({} as any),
    runner,
  )
}
