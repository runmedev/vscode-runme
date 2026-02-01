import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import tls from 'node:tls'
import { pathToFileURL } from 'node:url'

import { ChannelCredentials } from '@grpc/grpc-js'
import { GrpcTransport } from '@protobuf-ts/grpc-transport'
import { Disposable, Uri, EventEmitter, Event, env } from 'vscode'

import getLogger from '../logger'
import { HealthCheckRequest, HealthCheckResponse_ServingStatus } from '../grpc/healthTypes'
import { SERVER_ADDRESS } from '../../constants'
import {
  ServerTransportType,
  enableServerLogs,
  getBinaryPath,
  getCustomServerAddress,
  getPortNumber,
  getServerConfigurationValue,
  getTLSDir,
  getTLSEnabled,
} from '../../utils/configuration'
import { EnvProps, isPortAvailable, isTelemetryEnabled } from '../utils'
import { HealthClient } from '../grpc/tcpClient'
import {
  ConnectTransport,
  GrpcTransportOptions,
  ConnectTransportOptions,
  createGrpcHttpTransport,
  createConnectTransport,
  createGrpcUdsTransport,
} from '../grpc/parser/connect/client'

import KernelServerError from './kernelServerError'

export interface IServerConfig {
  assignPortDynamically?: boolean
  retryOnFailure?: boolean
  maxNumberOfIntents: number
  acceptsConnection?: {
    intents: number
    interval: number
  }
}

const log = getLogger('KernelServer')

export interface IServer extends Disposable {
  transportType: ServerTransportType

  onTransportReady: Event<{ transport: GrpcTransport; address?: string }>
  onConnectTransportReady: Event<{ transport: ConnectTransport; address?: string }>
  onClose: Event<{
    code: number | null
  }>

  launch(): Promise<string>
  address(): string
  transport(): Promise<GrpcTransport>
  connectTransport(): Promise<ConnectTransport>
}

class KernelServer implements IServer {
  #port: number
  #socketId?: string
  #process: ChildProcessWithoutNullStreams | undefined
  #binaryPath: Uri
  #retryOnFailure: boolean
  #maxNumberOfIntents: number
  #loggingEnabled: boolean
  #acceptsIntents: number
  #acceptsInterval: number
  #disposables: Disposable[] = []
  #transport?: GrpcTransport
  #connectTransport?: ConnectTransport
  #serverDisposables: Disposable[] = []
  #forceExternalServer: boolean

  readonly #onClose = this.register(new EventEmitter<{ code: number | null }>())
  readonly #onTransportReady = this.register(
    new EventEmitter<{ transport: GrpcTransport; address?: string }>(),
  )
  readonly #onConnectTransportReady = this.register(
    new EventEmitter<{ transport: ConnectTransport; address?: string }>(),
  )

  readonly transportType: ServerTransportType
  readonly onClose = this.#onClose.event
  readonly onTransportReady = this.#onTransportReady.event
  readonly onConnectTransportReady = this.#onConnectTransportReady.event

  static readonly transportTypeDefault: ServerTransportType = 'TCP'

  constructor(
    protected readonly extBasePath: Uri,
    protected envProps: EnvProps,
    options: IServerConfig,
    externalServer: boolean,
    protected readonly enableRunner = false,
  ) {
    this.transportType = getServerConfigurationValue<ServerTransportType>(
      'transportType',
      KernelServer.transportTypeDefault,
    )
    this.#port = getPortNumber()
    this.#loggingEnabled = enableServerLogs()
    this.#binaryPath = getBinaryPath(extBasePath)
    this.#retryOnFailure = options.retryOnFailure || false
    this.#maxNumberOfIntents = options.maxNumberOfIntents
    this.#acceptsIntents = options.acceptsConnection?.intents || 50
    this.#acceptsInterval = options.acceptsConnection?.interval || 200
    this.#forceExternalServer = externalServer

    env.onDidChangeTelemetryEnabled(() => {
      this.kill()
    })
  }

  dispose() {
    this.#disposables.forEach((d) => d.dispose())
    this.disposeProcess()
  }

  private disposeProcess(process?: ChildProcessWithoutNullStreams) {
    process ??= this.#process

    if (process === this.#process) {
      this.#process = undefined
      this.clearServerDisposables()
    }

    process?.removeAllListeners()
    process?.kill()
  }

  protected async isRunning(): Promise<boolean> {
    const client = new HealthClient(await this.transport())

    try {
      const { response } = await client.check(HealthCheckRequest.create())

      if (response.status === HealthCheckResponse_ServingStatus.SERVING) {
        return true
      }
    } catch (err: any) {
      if (err?.code === 'UNAVAILABLE') {
        return false
      }
      throw err
    }

    return false
  }

  protected kill(): boolean {
    return this.#process?.kill() ?? false
  }

  address(): string {
    const customAddress = getCustomServerAddress()
    if (customAddress) {
      return customAddress
    }

    if (this.transportType === KernelServer.transportTypeDefault) {
      const host = `${SERVER_ADDRESS}:${this.#port}`
      return host
    }

    // only do this once and only if required
    if (!this.#socketId) {
      const rndBytes = crypto.randomBytes(4)
      this.#socketId = rndBytes.toString('hex')
    }

    const sockPath = path.normalize(path.join(this.getRuntimeDir(), `runme-${this.#socketId}.sock`))
    const encodedPath = pathToFileURL(sockPath).pathname
    return `unix://${encodedPath}`
  }

  protected getRuntimeDir(): string {
    return process.env.XDG_RUNTIME_DIR || os.tmpdir()
  }

  private get externalServer(): boolean {
    return !!(getCustomServerAddress() || this.#forceExternalServer)
  }

  private static async getTLS(tlsDir: string) {
    try {
      const certPEM = await fs.readFile(path.join(tlsDir, 'cert.pem'))
      const privKeyPEM = await fs.readFile(path.join(tlsDir, 'key.pem'))

      return { certPEM, privKeyPEM }
    } catch (e: any) {
      throw new KernelServerError('Unable to read TLS files', e)
    }
  }

  protected getTLSDir(): string {
    return getTLSDir(this.extBasePath)
  }

  protected async channelCredentials(): Promise<ChannelCredentials> {
    if (!getTLSEnabled()) {
      return ChannelCredentials.createInsecure()
    }

    const { certPEM, privKeyPEM } = await KernelServer.getTLS(this.getTLSDir())

    return ChannelCredentials.createSsl(certPEM, privKeyPEM, certPEM)
  }

  protected closeTransport() {
    this.#transport?.close()
    this.#transport = undefined
  }

  async transport() {
    this.#transport = new GrpcTransport({
      host: this.address(),
      channelCredentials: await this.channelCredentials(),
    })

    return this.#transport
  }

  async connectTransport(protocol: 'grpc' | 'connect' = 'grpc'): Promise<ConnectTransport> {
    const address = this.connectAddress()

    const transportOptions: GrpcTransportOptions | ConnectTransportOptions = {
      baseUrl: address,
      httpVersion: '2',
    }

    if (getTLSEnabled()) {
      const pems = await KernelServer.getTLS(this.getTLSDir())
      const nodeSecureContextOptions: tls.SecureContextOptions = {
        key: pems.privKeyPEM,
        cert: pems.certPEM,
        ca: pems.certPEM,
      }
      transportOptions.nodeOptions = {
        ...transportOptions.nodeOptions,
        ...nodeSecureContextOptions,
      }
    }

    let createTransport
    if (protocol === 'connect') {
      createTransport = createConnectTransport
    } else if (address.startsWith('unix:/')) {
      createTransport = createGrpcUdsTransport
    } else {
      createTransport = createGrpcHttpTransport
    }
    this.#connectTransport = createTransport(transportOptions)
    return this.#connectTransport
  }

  connectAddress(): string {
    let endpoint: URL
    try {
      endpoint = new URL(this.address())
    } catch (e) {
      if ((e as TypeError).message !== 'Invalid URL') {
        throw new KernelServerError('Invalid server address')
      }
      endpoint = new URL(`https://${this.address()}`)
    }

    if (
      endpoint.protocol !== 'http:' &&
      endpoint.protocol !== 'https:' &&
      endpoint.protocol !== 'unix:'
    ) {
      endpoint = new URL(`https://${this.address()}`)
    }

    if (getTLSEnabled()) {
      endpoint.protocol = 'https:'
    } else {
      endpoint.protocol = 'http:'
    }
    return endpoint.toString()
  }

  protected async start(): Promise<string> {
    const binaryLocation = this.#binaryPath.fsPath

    const binaryExists = await fs.access(binaryLocation).then(
      () => true,
      () => false,
    )

    const isFile = await fs.stat(binaryLocation).then(
      (result) => {
        return result.isFile()
      },
      () => false,
    )

    if (!binaryExists || !isFile) {
      throw new KernelServerError('Cannot find server binary file')
    }

    this.#port = getPortNumber()
    while (!(await isPortAvailable(this.#port))) {
      this.#port++
    }

    const address = this.address()
    const args = ['server', '--address', address]

    if (this.enableRunner) {
      args.push('--runner')
    }

    if (getTLSEnabled()) {
      args.push('--tls', this.getTLSDir())
    } else {
      args.push('--insecure')
    }

    const env = this.getConfiguredEnv()
    const child = spawn(binaryLocation, args, { env })

    child.on('close', (code) => {
      if (this.#loggingEnabled) {
        log.info(`Server process #${this.#process?.pid} closed with code ${code}`)
      }
      this.#onClose.fire({ code })

      this.disposeProcess(child)
    })

    child.stderr.once('data', () => {
      log.info(`Server process #${this.#process?.pid} started at ${address}`)
    })

    child.stderr.on('data', (data) => {
      if (this.#loggingEnabled) {
        log.info(data.toString())
      }
    })

    this.#process = child

    return Promise.race([
      new Promise<string>((resolve, reject) => {
        const cb = (data: any) => {
          const msg: string = data.toString()
          try {
            for (const line of msg.split('\n')) {
              if (!line) {
                continue
              }

              let log: any

              try {
                log = JSON.parse(line)
              } catch (_e) {
                continue
              }

              if (log.addr) {
                child.stderr.off('data', cb)
                return resolve(log.addr)
              }
            }
          } catch (err: any) {
            reject(new KernelServerError(`Server failed, reason: ${(err as Error).message}`))
          }
        }

        child.stderr.on('data', cb)
      }),
      new Promise<never>((_, reject) => {
        const { dispose } = this.#onClose.event(() => {
          dispose()
          reject(new Error('Server closed prematurely!'))
        })
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timed out listening for server ready message')), 10000),
      ),
    ])
  }

  protected getConfiguredEnv(): NodeJS.ProcessEnv {
    const penv: NodeJS.ProcessEnv = Object.assign(process.env)

    const noTelemetry = !isTelemetryEnabled()
    if (!env.isTelemetryEnabled || noTelemetry) {
      penv['DO_NOT_TRACK'] = 'true'
      return penv
    }

    Object.entries(this.envProps).forEach(([k, v]) => {
      penv[`TELEMETRY_${k.toUpperCase()}`] = v
    })

    return penv
  }

  protected async acceptsConnection(): Promise<void> {
    const INTERVAL = this.#acceptsInterval
    const INTENTS = this.#acceptsIntents
    let iter = 0
    let isRunning = false

    while (iter < INTENTS) {
      isRunning = await this.isRunning()
      if (isRunning) {
        return
      }

      await new Promise((r) => setInterval(r, INTERVAL))

      iter++
    }

    const intervalSecs = ((iter * INTERVAL) / 1000).toFixed(1)
    throw new KernelServerError(`Server did not accept connections after ${intervalSecs}s`)
  }

  /**
   * Tries to launch server, retrying if needed
   *
   * If `externalServer` is set, then this only attempts to connect to the
   * server address
   *
   * @returns Address of server or error
   */
  async launch(intent = 0): Promise<string> {
    this.disposeProcess()

    if (this.externalServer) {
      await this.connect()
      return this.address()
    }

    let addr
    try {
      addr = await this.start()
    } catch (e) {
      if (this.#retryOnFailure && this.#maxNumberOfIntents > intent) {
        console.error(`Failed to start kernel server, retrying. Error: ${(e as Error).message}`)
        return this.launch(intent + 1)
      }
      throw new KernelServerError(`Cannot start server. Error: ${(e as Error).message}`)
    }

    await this.connect()

    // relaunch on close
    this.registerServerDisposable(
      this.#onClose.event(() => {
        this.launch()
        this.#serverDisposables.forEach(({ dispose }) => dispose())
      }),
    )

    return addr
  }

  protected async connect(): Promise<void> {
    this.closeTransport()
    await this.acceptsConnection()

    this.#onTransportReady.fire({ transport: await this.transport(), address: this.address() })
    this.#onConnectTransportReady.fire({
      transport: await this.connectTransport(),
      address: this.connectAddress(),
    })
  }

  private _port() {
    return this.#port
  }

  protected register<T extends Disposable>(disposable: T): T {
    this.#disposables.push(disposable)
    return disposable
  }

  private registerServerDisposable<T extends Disposable>(d: T) {
    this.#serverDisposables.push(d)
  }

  private clearServerDisposables() {
    this.#serverDisposables.forEach(({ dispose }) => dispose())
    this.#serverDisposables = []
  }
}

export default KernelServer
