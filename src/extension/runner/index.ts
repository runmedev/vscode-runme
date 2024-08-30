import {
  type Pseudoterminal,
  type Event,
  type Disposable,
  type TerminalDimensions,
  EventEmitter,
} from 'vscode'

import type { DisposableAsync } from '../../types'
import {
  CreateSessionRequest,
  CreateSessionRequestImpl,
  ExecuteRequestImpl,
  ExecuteStopEnum,
  GetSessionRequestImpl,
  Winsize,
  WinsizeImpl,
} from '../grpc/runner/types'
import {
  CommandMode,
  ExecuteRequest as ExecuteRequestType,
  ResolveProgramRequest_Mode,
  SessionEnvStoreType,
} from '../grpc/runner/types'
import { ExecuteDuplex } from '../grpc/runner/types'
import { progconf } from '../grpc/runner/v2'
import { IRunnerServiceClient, RpcError } from '../grpc/client'
import { getSystemShellPath } from '../executors/utils'
import { IServer } from '../server/kernelServer'
import { convertEnvList } from '../utils'
import { getEnvWorkspaceFileOrder } from '../../utils/configuration'
import getLogger from '../logger'

import { IRunnerChild, TerminalWindowState } from './types'
import { GrpcRunnerEnvironment, IRunnerEnvironment } from './environment'
import { IRunnerClient, GrpcRunnerClient } from './client'
import { GrpcRunnerProgramResolver } from './program'
import { GrpcRunnerMonitorEnvStore } from './monitorEnv'

export type RunProgramExecution =
  | {
      type: 'commands'
      commands: string[]
    }
  | {
      type: 'script'
      script: string
    }

export type TerminalWindow = 'vscode' | 'notebook'

export interface RunProgramOptions {
  programName: string
  args?: string[]
  cwd?: string
  envs?: string[]
  exec?: RunProgramExecution
  tty?: boolean
  runnerEnv?: IRunnerEnvironment
  terminalDimensions?: TerminalDimensions
  background?: boolean
  convertEol?: boolean
  storeLastOutput?: boolean
  languageId?: string
  fileExtension?: string
  commandMode?: CommandMode
  knownId?: string
  knownName?: string
}

export type IRunnerReady = { address?: string }

export interface IRunner extends Disposable {
  /**
   * Called when underlying transport is ready
   *
   * May be called multiple times if server restarts
   */
  readonly onReady: Event<IRunnerReady>

  close(): void

  createEnvironment({
    workspaceRoot,
    envStoreType,
    envs,
    metadata,
  }: {
    workspaceRoot?: string
    envStoreType?: SessionEnvStoreType
    envs?: string[]
    metadata?: { [index: string]: string }
  }): Promise<IRunnerEnvironment>

  createProgramSession(opts: RunProgramOptions): Promise<IRunnerProgramSession>

  createMonitorEnvStore(): Promise<GrpcRunnerMonitorEnvStore>

  createProgramResolver(
    mode: ResolveProgramRequest_Mode,
    envs: Record<string, string>,
  ): Promise<GrpcRunnerProgramResolver>

  getEnvironmentVariables(
    runnerEnv: IRunnerEnvironment,
  ): Promise<Record<string, string> | undefined>

  setEnvironmentVariables(
    runnerEnv: IRunnerEnvironment,
    variables: Record<string, string | undefined>,
  ): Promise<boolean>
}

export type RunnerExitReason =
  | {
      type: 'exit'
      code: number
    }
  | {
      type: 'error'
      error: Error
    }
  | {
      type: 'disposed'
    }

export interface IRunnerProgramSession extends IRunnerChild, Pseudoterminal {
  /**
   * Called when an unrecoverable error occurs, for instance a failure over gRPC
   * transport
   *
   * Note that this is different from `onDidErr`, which is for stderr
   */
  readonly onInternalErr: Event<Error>

  readonly onDidErr: Event<string>
  readonly onDidClose: Event<number | void>

  /**
   * Implementers should **still call `onDidWrite`** to stay compatible with
   * VSCode pseudoterminal interface
   */
  readonly onStdoutRaw: Event<Uint8Array>
  /**
   * Implementers should **still call `onDidErr`** to stay compatible with
   * VSCode pseudoterminal interface
   */
  readonly onStderrRaw: Event<Uint8Array>

  /**
   * Number of registered terminal windows
   */
  readonly numTerminalWindows: number

  readonly pid: Promise<number | undefined>

  readonly mimeType: Promise<string | undefined>

  handleInput(message: string): Promise<void>

  setRunOptions(opts: RunProgramOptions): void
  run(): Promise<void>
  hasExited(): RunnerExitReason | undefined

  setDimensions(
    dimensions: TerminalDimensions,
    terminalWindow?: TerminalWindow,
  ): void | Promise<void>

  /**
   * Register terminal window for usage with this program
   *
   * When windows are registered, the program will be run after all registered
   * windows have made a call to `open`
   *
   * @param window Type of terminal window
   */
  registerTerminalWindow(window: TerminalWindow, initialDimensions?: TerminalDimensions): void

  /**
   * The "active" terminal window is the one whose dimensions are used for the
   * underlying program sesssion's shell process
   */
  setActiveTerminalWindow(window: TerminalWindow): Promise<void>

  open(
    initialDimensions?: TerminalDimensions,
    terminalWindow?: TerminalWindow,
  ): void | Promise<void>
}

export default class GrpcRunner implements IRunner {
  protected client: IRunnerClient

  private children: WeakRef<IRunnerChild>[] = []
  private disposables: Disposable[] = []

  protected _onReady = this.register(new EventEmitter<IRunnerReady>())
  onReady = this._onReady.event

  constructor(protected server: IServer) {
    this.client = new GrpcRunnerClient(server, this._onReady)
    this.register(this.client)
  }

  async createMonitorEnvStore(): Promise<GrpcRunnerMonitorEnvStore> {
    const monitor = new GrpcRunnerMonitorEnvStore(this.client)
    this.registerChild(monitor)
    return monitor
  }

  async createProgramSession(opts: RunProgramOptions): Promise<IRunnerProgramSession> {
    const session = new GrpcRunnerProgramSession(this.client, opts)

    this.registerChild(session)

    return session
  }

  async createProgramResolver(
    mode: ResolveProgramRequest_Mode,
    envs: Record<string, string>,
  ): Promise<GrpcRunnerProgramResolver> {
    const resolver = new GrpcRunnerProgramResolver(this.client, mode, envs)

    this.registerChild(resolver)

    return resolver
  }

  async createEnvironment({
    workspaceRoot,
    envStoreType,
    envs,
    metadata,
  }: {
    workspaceRoot?: string
    envStoreType?: SessionEnvStoreType
    envs?: string[]
    metadata?: { [index: string]: string }
  }) {
    const envLoadOrder = getEnvWorkspaceFileOrder()
    const request = CreateSessionRequestImpl().create({
      metadata,
      envs,
      project: {
        root: workspaceRoot,
        envLoadOrder,
      },
      envStoreType,
    })

    try {
      const client = this.client

      return client
        .createSession(request as CreateSessionRequest)
        .then(({ response: { session } }) => {
          if (!session) {
            throw new Error('Did not receive session!!')
          }

          const runnerEnv = new GrpcRunnerEnvironment(client, session)

          this.registerChild(runnerEnv)
          return runnerEnv
        })
        .catch((e) => {
          throw e
        })
    } catch (err: any) {
      console.error(err)
      this.close()
      throw err
    }
  }

  async getEnvironmentVariables(
    runnerEnv: IRunnerEnvironment,
  ): Promise<Record<string, string> | undefined> {
    if (!(runnerEnv instanceof GrpcRunnerEnvironment)) {
      throw new Error('Invalid runner environment!')
    }

    const id = runnerEnv.getSessionId()

    const { session } = await this.client.getSession(GetSessionRequestImpl().create({ id }))
      .response

    if (!session) {
      return undefined
    }

    const env = (session as any).envs ?? (session as any).env ?? []
    convertEnvList(env)
  }

  // TODO: create a gRPC endpoint for this so it can be done without making a
  // new program (and hopefully preventing race conditions etc)
  async setEnvironmentVariables(
    runnerEnv: IRunnerEnvironment,
    variables: Record<string, string | undefined>,
    shellPath?: string,
  ): Promise<boolean> {
    const commands = Object.entries(variables).map(([key, val]) => `export ${key}=${val ?? ''}`)

    const program = await this.createProgramSession({
      programName: shellPath ?? getSystemShellPath() ?? 'sh',
      runnerEnv,
      exec: {
        type: 'commands',
        commands,
      },
    })

    return await new Promise<boolean>((resolve, reject) => {
      program.onDidClose((code) => {
        resolve(code === 0)
      })

      program.onInternalErr((e) => {
        reject(e)
      })

      program.run()
    })
  }

  close(): void {}

  async dispose(): Promise<void> {
    this.disposables.forEach((d) => d.dispose())
    await this.disposeChildren().finally(() => this.close())
  }

  async disposeChildren(): Promise<void> {
    await Promise.all(this.children.map((c) => c.deref()?.dispose()))
  }

  /**
   * Register disposable child weakref, so that it can still be GC'ed even if
   * there is a reference to it in this object and its already been disposed of
   */
  protected registerChild(d: DisposableAsync) {
    this.children.push(new WeakRef(d))
  }

  protected register<T extends Disposable>(d: T): T {
    this.disposables.push(d)
    return d
  }
}

const log = getLogger('GrpcRunnerProgramSession')
export class GrpcRunnerProgramSession implements IRunnerProgramSession {
  private disposables: Disposable[] = []

  readonly _onInternalErr = this.register(new EventEmitter<Error>())
  readonly _onDidWrite = this.register(new EventEmitter<string>())
  readonly _onDidErr = this.register(new EventEmitter<string>())
  readonly _onDidClose = this.register(new EventEmitter<number | void>())
  readonly _onStdoutRaw = this.register(new EventEmitter<Uint8Array>())
  readonly _onStderrRaw = this.register(new EventEmitter<Uint8Array>())
  readonly _onPid = this.register(new EventEmitter<number | undefined>())
  readonly _onMimeType = this.register(new EventEmitter<string | undefined>())

  readonly onDidWrite = this._onDidWrite.event
  readonly onDidErr = this._onDidErr.event
  readonly onDidClose = this._onDidClose.event
  readonly onStdoutRaw = this._onStdoutRaw.event
  readonly onStderrRaw = this._onStderrRaw.event
  readonly onInternalErr = this._onInternalErr.event

  protected exitReason?: RunnerExitReason

  private readonly session: ExecuteDuplex

  private isDisposed = false

  protected initialized = false

  protected buffer = ''

  protected activeTerminalWindow?: TerminalWindow
  protected terminalWindows = new Map<TerminalWindow, TerminalWindowState>()

  pid = new Promise<number | undefined>(this._onPid.event)

  mimeType = new Promise<string | undefined>(this._onMimeType.event)

  constructor(
    private readonly client: IRunnerServiceClient,
    protected opts: RunProgramOptions,
  ) {
    this.session = this.client.execute()

    this.register(
      this._onStdoutRaw.event((data) => {
        // TODO: web compat
        const stdout = Buffer.from(data).toString('utf-8')
        this._onDidWrite.fire(stdout)
      }),
    )

    this.register(
      this._onStderrRaw.event((data) => {
        // TODO: web compat
        const stderr = Buffer.from(data).toString('utf-8')
        this._onDidErr.fire(stderr)
      }),
    )

    this.register(this._onDidClose.event(() => this.dispose()))
    this.register(this._onInternalErr.event(() => this.dispose()))

    let detectedMimeType = ''
    this.session.responses.onMessage(({ stderrData, stdoutData, exitCode, pid, mimeType }) => {
      if (mimeType) {
        const mimeWithoutEncoding = mimeType.split(';')[0]
        detectedMimeType = mimeWithoutEncoding
        this._onMimeType.fire(mimeWithoutEncoding)
      }

      if (stdoutData.length > 0) {
        this.write('stdout', detectedMimeType, stdoutData)
      }

      if (stderrData.length > 0) {
        this.write('stderr', detectedMimeType, stderrData)
      }

      if (exitCode) {
        this._close({ type: 'exit', code: exitCode.value })
        this.dispose()
      }

      if (pid) {
        const v = (pid as any).pid ?? (pid as any).value
        this._onPid.fire(Number(v))
      }
    })

    this.session.responses.onComplete(() => {
      if (!this.hasExited()) {
        this.error(new Error('gRPC Server closed output stream unexpectedly!'))
      }
    })

    this.session.responses.onError((error) => {
      if (error instanceof RpcError) {
        console.error(
          'RpcError occurred!',
          {
            // duping here since `Error` types are uninspectable in console
            code: error.code,
            message: error.message,
            method: error.methodName,
            meta: error.meta,
            service: error.serviceName,
            name: error.name,
          },
          error,
        )
      } else {
        console.error('Unexpected error!!', error)
      }

      this.error(error)
    })
  }

  private static readonly WRITE_LISTENER = {
    stdout: '_onStdoutRaw',
    stderr: '_onStderrRaw',
  } as const

  protected write(channel: 'stdout' | 'stderr', mimeType: string, bytes: Uint8Array): void {
    if (this.convertEol(mimeType) && !this.isPseudoterminal()) {
      const newBytes = new Array(bytes.byteLength)

      let i = 0,
        j = 0
      while (j < bytes.byteLength) {
        const byte = bytes[j++]

        if (byte === 0x0a) {
          newBytes[i++] = 0x0d
        }

        newBytes[i++] = byte
      }

      bytes = Buffer.from(newBytes)
    }

    return this[GrpcRunnerProgramSession.WRITE_LISTENER[channel]].fire(bytes)
  }

  protected async init(opts?: RunProgramOptions) {
    if (this.initialized) {
      throw new Error('Already initialized!')
    }
    if (opts) {
      this.opts = opts
    }

    this.initialized = true

    this.opts.envs ??= []

    if (this.opts.tty) {
      this.opts.envs.push('TERM=xterm-256color')
    } else {
      this.opts.envs.push('TERM=')
    }

    await this.session.requests.send(GrpcRunnerProgramSession.runOptionsToExecuteRequest(this.opts))
  }

  setRunOptions(opts: RunProgramOptions): void {
    this.opts = opts
  }

  async run(opts?: RunProgramOptions): Promise<void> {
    await this.init(opts)
  }

  isPseudoterminal(): boolean {
    return !!this.opts.tty
  }

  async handleInput(data: string): Promise<void> {
    if (this.hasExited()) {
      log.warn('Cannot write to closed program session')
      return
    }
    this.sendRawInput(data)
  }

  protected async sendRawInput(data: string) {
    const inputData = Buffer.from(data)

    this.session.requests.send(
      ExecuteRequestImpl().create({
        inputData: inputData,
      }),
    )
  }

  registerTerminalWindow(window: TerminalWindow, initialDimensions?: TerminalDimensions): void {
    this.terminalWindows.set(window, {
      dimensions: initialDimensions,
      opened: false,
    })
  }

  private _setActiveTerminalWindow(window: TerminalWindow): void {
    this.activeTerminalWindow = window
  }

  async setActiveTerminalWindow(window: TerminalWindow): Promise<void> {
    const terminalWindowState = this.terminalWindows.get(window)

    if (!terminalWindowState) {
      console.error(`Attempted to set active terminal window to unregistered window '${window}'`)
      return
    }

    this._setActiveTerminalWindow(window)

    if (terminalWindowState.dimensions && this.initialized) {
      await this.setDimensions(terminalWindowState.dimensions, window)
    }
  }

  open(initialDimensions?: TerminalDimensions, terminalWindow: TerminalWindow = 'vscode'): void {
    const terminalWindowState = this.terminalWindows.get(terminalWindow)

    if (!terminalWindowState) {
      console.error(`Attempted to open unregistered terminal window '${terminalWindow}'!`)
      return
    }

    if (terminalWindowState.opened) {
      console.warn(`Attempted to open terminal window '${terminalWindow}' that has already opened!`)
      return
    }

    terminalWindowState.opened = true

    // Workaround to force terminal to close if opened after early exit
    // TODO(mxs): find a better solution here
    if (this.hasExited()) {
      this._onDidClose.fire(1)
      return
    }

    if (initialDimensions) {
      terminalWindowState.dimensions = initialDimensions
    }

    if (terminalWindow === this.activeTerminalWindow) {
      this.opts.terminalDimensions = terminalWindowState.dimensions
    }

    if ([...this.terminalWindows.values()].every(({ opened }) => opened)) {
      // in pty, we wait for open to run
      this.run()
    }
  }

  async dispose() {
    if (this.isDisposed) {
      return
    }
    this.isDisposed = true

    this._close({ type: 'disposed' })

    await this.session.requests.complete()
  }

  _close(reason: RunnerExitReason) {
    if (this.hasExited()) {
      return
    }

    this.exitReason = reason

    if (reason.type !== 'disposed') {
      this._onDidClose.fire(reason.type === 'exit' ? reason.code : 1)
    }
  }

  /**
   * Manually closed by the user
   *
   * Implemented for compatibility with VSCode's `Pseudoterminal` interface;
   * please use `_close` internally
   */
  close() {
    if (this.hasExited()) {
      return
    }

    this.session.requests.send(
      ExecuteRequestImpl().create({
        stop: this.isPseudoterminal() ? ExecuteStopEnum().INTERRUPT : ExecuteStopEnum().KILL,
      }),
    )
  }

  /**
   * Unrecoverable internal error
   */
  private error(error: Error) {
    this._close({ type: 'error', error })

    this._onInternalErr.fire(error)

    this.dispose()
  }

  async setDimensions(
    dimensions: TerminalDimensions,
    terminalWindow: TerminalWindow = 'vscode',
  ): Promise<void> {
    const terminalWindowState = this.terminalWindows.get(terminalWindow)

    if (!terminalWindowState) {
      throw new Error(`Tried to set dimensions for unregistered terminal window ${terminalWindow}`)
    }

    // removed this functionality in favor of preferring notebook terminal
    //
    // if(terminalWindow === 'vscode' && this.initialized) {
    //   if (terminalWindowState.hasSetDimensions) {
    //     // VSCode terminal window calls `setDimensions` only when focused - this
    //     // can be conveniently used to set the active window to the terminal
    //     this._setActiveTerminalWindow(terminalWindow)
    //   } else {
    //     terminalWindowState.hasSetDimensions = true
    //   }
    // }

    terminalWindowState.dimensions = dimensions

    if (this.activeTerminalWindow === terminalWindow && this.initialized) {
      await this.session.requests.send(
        ExecuteRequestImpl().create({
          winsize: terminalDimensionsToWinsize(dimensions),
        }),
      )
    }
  }

  hasExited() {
    return this.exitReason
  }

  protected register<T extends Disposable>(disposable: T): T {
    this.disposables.push(disposable)
    return disposable
  }

  protected convertEol(mimeType?: string) {
    if (this.opts.convertEol !== undefined) {
      return this.opts.convertEol
    }

    if (mimeType && mimeType !== 'text/plain') {
      return false
    }

    return true
  }

  static runOptionsToExecuteRequest({
    programName,
    args,
    cwd,
    runnerEnv,
    exec,
    tty,
    envs,
    terminalDimensions,
    background,
    storeLastOutput,
    fileExtension,
    languageId,
    commandMode,
    knownId,
    knownName,
  }: RunProgramOptions): ExecuteRequestType {
    if (runnerEnv && !(runnerEnv instanceof GrpcRunnerEnvironment)) {
      throw new Error('Expected gRPC runner environment!')
    }

    let source: progconf.ProgramConfig['source'] | undefined = undefined
    switch (exec?.type) {
      case 'commands':
        source = {
          oneofKind: 'commands',
          commands: { items: exec.commands },
        }
        break
      case 'script':
        source = {
          oneofKind: 'script',
          script: exec.script,
        }
        break
      default:
      // undefined
    }

    // attempt to satisfy both v1 and v2
    const execReq: any = {
      arguments: args,
      envs,
      directory: cwd,
      tty,
      sessionId: runnerEnv?.getSessionId(),
      programName,
      background: background,
      ...(exec?.type === 'commands' && { commands: exec.commands }),
      ...(exec?.type === 'script' && { script: exec.script }),
      ...(terminalDimensions && { winsize: terminalDimensionsToWinsize(terminalDimensions) }),
      storeLastOutput,
      storeStdoutInEnv: storeLastOutput,
      fileExtension,
      languageId,
      commandMode,
      knownId,
      knownName,
      // runnerv2's program config
      config: {
        arguments: args,
        env: envs,
        directory: cwd,
        interactive: tty,
        programName,
        background,
        fileExtension,
        languageId,
        mode: commandMode,
        source,
        knownId,
        knownName,
      },
    }

    return ExecuteRequestImpl().create(execReq) as ExecuteRequestType
  }

  get numTerminalWindows() {
    return this.terminalWindows.size
  }
}

function terminalDimensionsToWinsize({ rows, columns }: TerminalDimensions): Winsize {
  return WinsizeImpl().create({
    cols: columns,
    rows,
  })
}
