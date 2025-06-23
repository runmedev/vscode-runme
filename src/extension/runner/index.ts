import {
  type Pseudoterminal,
  type Event,
  type Disposable,
  type TerminalDimensions,
  EventEmitter,
} from 'vscode'
import stripAnsi from 'strip-ansi'
import { Observable } from 'rxjs'
import { bufferTime, map, endWith, startWith } from 'rxjs/operators'

import type { DisposableAsync, Serializer } from '../../types'
import {
  CreateSessionRequest,
  CreateSessionRequestImpl,
  SessionEnvStoreSeedingEnum,
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
import { IRunnerServiceClient, RpcError } from '../grpc/tcpClient'
import { getSystemShellPath } from '../executors/utils'
import { IServer } from '../server/kernelServer'
import { convertEnvList } from '../utils'
import { getEnvDirEnv, getEnvWorkspaceFileOrder } from '../../utils/configuration'
import getLogger from '../logger'
import { XTermSerializer } from '../terminal/terminalState'

import { IRunnerChild, TerminalWindowState } from './types'
import { GrpcRunnerEnvironment, IRunnerEnvironment } from './environment'
import { IRunnerClient, GrpcRunnerClient } from './client'
import { GrpcRunnerProgramResolver } from './program'
import { GrpcRunnerMonitorEnvStore } from './monitorEnv'
import { GrpcNotebook } from './notebook'

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

  createTerminalSession(opts: RunProgramOptions): Promise<IRunnerTerminalSession>

  createMonitorEnvStore(): Promise<GrpcRunnerMonitorEnvStore>

  createProgramResolver(
    mode: ResolveProgramRequest_Mode,
    envs: Record<string, string>,
  ): Promise<GrpcRunnerProgramResolver>

  createNotebook(notebook: Serializer.Notebook | undefined): Promise<GrpcNotebook>

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
   * VS Code pseudoterminal interface
   */
  readonly onStdoutRaw: Event<Uint8Array>
  /**
   * Implementers should **still call `onDidErr`** to stay compatible with
   * VS Code pseudoterminal interface
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

export interface IRunnerTerminalSession extends IRunnerProgramSession {
  readonly raw: Promise<Uint8Array>
  readonly data: Promise<string>
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

  async createTerminalSession(opts: RunProgramOptions): Promise<IRunnerTerminalSession> {
    const session = new GrpcRunnerTerminalSession(this.client, opts)

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

  async createNotebook(notebook: Serializer.Notebook | undefined): Promise<GrpcNotebook> {
    const resolver = new GrpcNotebook(this.server, notebook)

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
    const envDirenv = getEnvDirEnv()
    // v1 calls it envs, whereas v2 calls it env - send both
    const req = <any>{
      metadata,
      env: envs,
      envs,
      project: {
        root: workspaceRoot,
        envLoadOrder,
        envDirenv,
      },
      envStoreType,
      config: {
        envStoreType,
        envStoreSeeding: SessionEnvStoreSeedingEnum().SYSTEM,
      },
    }
    const request = CreateSessionRequestImpl().create(req)

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

export const NON_TTY_BUFFER_SPAN_MS = 100
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

    // unbufferd
    const decoder = new TextDecoder()
    let decodedStdout$: Observable<string> = new Observable<Uint8Array>((observer) => {
      this.register(this._onStdoutRaw.event((bytes) => observer.next(bytes)))
      this.register(
        this._onDidClose.event(() => {
          observer.complete()
          this.dispose()
        }),
      )
      this.register(
        this._onInternalErr.event((err) => {
          observer.error(err)
          this.dispose()
        }),
      )
    }).pipe(
      map((bytes) => {
        if (!this.isPseudoterminal()) {
          return this.LFToCRLF(bytes)
        }
        return bytes
      }),
      map((bytes) => decoder.decode(bytes)),
    )

    // buffered
    if (!this.isPseudoterminal()) {
      decodedStdout$ = decodedStdout$.pipe(
        startWith('\r'),
        endWith('\r\n'),
        bufferTime(NON_TTY_BUFFER_SPAN_MS),
        map((chunks) => chunks.join('')),
      )
    }

    const sub = decodedStdout$.subscribe((data) => this._onDidWrite.fire(data))
    this.register({ dispose: () => sub.unsubscribe() })

    this.register(
      this._onStderrRaw.event((data) => {
        // TODO: web compat
        const stderr = Buffer.from(data).toString('utf-8')
        this._onDidErr.fire(stderr)

        // onDidErr is **not** part of VS Code's PTY interface
        // for non-interactive we deliberately write stderr to the PTY
        if (this.isPseudoterminal()) {
          return
        }
        const yellowStderr = `\x1b[33m${stderr}\x1b[0m`
        this._onDidWrite.fire(yellowStderr)
      }),
    )

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
      bytes = this.LFToCRLF(bytes)
    }

    return this[GrpcRunnerProgramSession.WRITE_LISTENER[channel]].fire(bytes)
  }

  protected LFToCRLF(bytes: Uint8Array) {
    const newBytes = new Array(bytes.byteLength)

    let i = 0,
      j = 0
    while (j < bytes.byteLength) {
      const byte = bytes[j++]

      const prev = j - 1 >= 0 ? bytes[j - 1] : undefined
      if (byte === 0x0a && prev !== 0x0d) {
        newBytes[i++] = 0x0d
      }

      newBytes[i++] = byte
    }

    bytes = Buffer.from(newBytes)
    return bytes
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
   * Implemented for compatibility with VS Code's `Pseudoterminal` interface;
   * please use `_close` internally
   */
  close() {
    if (this.hasExited()) {
      return
    }

    const execReq = ExecuteRequestImpl().create()
    execReq.stop = this.isPseudoterminal() ? ExecuteStopEnum().INTERRUPT : ExecuteStopEnum().KILL

    this.session.requests.send(execReq)
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
    //     // VS Code terminal window calls `setDimensions` only when focused - this
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

export class GrpcRunnerTerminalSession
  extends GrpcRunnerProgramSession
  implements IRunnerTerminalSession
{
  public raw: Promise<Uint8Array>

  constructor(client: IRunnerServiceClient, opts: RunProgramOptions) {
    super(client, opts)

    this.raw = new Promise((resolve) => {
      let data: Buffer = Buffer.alloc(0)
      this.onStdoutRaw((chunk) => {
        data = Buffer.concat([data, chunk])
      })

      this.onStderrRaw((chunk) => {
        data = Buffer.concat([data, chunk])
      })

      this.onDidClose(() => {
        resolve(data)
      })
    })
  }

  get data(): Promise<string> {
    const term = new XTermSerializer(100000)
    return this.raw.then((data) => {
      return term.write(data).then(() => {
        const serialized = term.serialize()
        const stripped = stripAnsi(serialized)

        const outro = ' the notebook.'
        const lastCommentIndex = stripped.lastIndexOf(outro)
        return stripped.substring(lastCommentIndex + outro.length).trimStart()
      })
    })
  }
}

function terminalDimensionsToWinsize({ rows, columns }: TerminalDimensions): Winsize {
  return WinsizeImpl().create({
    cols: columns,
    rows,
  })
}
