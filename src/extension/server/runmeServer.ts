import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

import { ChannelCredentials } from '@grpc/grpc-js'
import { GrpcTransport } from '@protobuf-ts/grpc-transport'
import { Disposable, Uri, EventEmitter } from 'vscode'

import getLogger from '../logger'
import {
  HealthCheckRequest,
  HealthCheckResponse_ServingStatus
} from '../grpc/healthTypes'
import { SERVER_ADDRESS } from '../../constants'
import {
  enableServerLogs,
  getBinaryPath,
  getCustomServerAddress,
  getPortNumber,
  getTLSDir,
  getTLSEnabled
} from '../../utils/configuration'
import { isPortAvailable } from '../utils'
import { HealthClient } from '../grpc/client'

import RunmeServerError from './runmeServerError'

export interface IServerConfig {
    assignPortDynamically?: boolean
    retryOnFailure?: boolean
    maxNumberOfIntents: number
    acceptsConnection?: {
      intents: number
      interval: number
    }
}

const log = getLogger('RunmeServer')

class RunmeServer implements Disposable {
    #port: number
    #process: ChildProcessWithoutNullStreams | undefined
    #binaryPath: Uri
    #retryOnFailure: boolean
    #maxNumberOfIntents: number
    #loggingEnabled: boolean
    #acceptsIntents: number
    #acceptsInterval: number
    #disposables: Disposable[] = []
    #transport?: GrpcTransport
    #serverDisposables: Disposable[] = []
    #forceExternalServer: boolean

    readonly #onClose = this.register(new EventEmitter<{ code: number|null }>())
    readonly #onTransportReady = this.register(new EventEmitter<{ transport: GrpcTransport }>())

    readonly onClose = this.#onClose.event
    readonly onTransportReady = this.#onTransportReady.event

    constructor(
      extBasePath: Uri,
      options: IServerConfig,
      externalServer: boolean,
      protected readonly enableRunner = false
    ) {
      this.#port = getPortNumber()
      this.#loggingEnabled = enableServerLogs()
      this.#binaryPath = getBinaryPath(extBasePath, process.platform)
      this.#retryOnFailure = options.retryOnFailure || false
      this.#maxNumberOfIntents = options.maxNumberOfIntents
      this.#acceptsIntents = options.acceptsConnection?.intents || 50
      this.#acceptsInterval = options.acceptsConnection?.interval || 200
      this.#forceExternalServer = externalServer
    }

    dispose() {
      this.#disposables.forEach(d => d.dispose())
      this.disposeProcess()
    }

    private disposeProcess(process?: ChildProcessWithoutNullStreams) {
      process ??= this.#process

      if(process === this.#process) {
        this.#process = undefined
        this.clearServerDisposables()
      }

      process?.removeAllListeners()
      process?.kill()
    }

    async isRunning(): Promise<boolean> {
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

    address() {
      return getCustomServerAddress() || `${SERVER_ADDRESS}:${this.#port}`
    }

    private get externalServer(): boolean {
      return !!(getCustomServerAddress() || this.#forceExternalServer)
    }

    private static async getTLS(tlsDir: string) {
      try {
        const certPEM = await fs.readFile(path.join(tlsDir, 'cert.pem'))
        const privKeyPEM = await fs.readFile(path.join(tlsDir, 'key.pem'))

        return { certPEM, privKeyPEM }
      } catch(e: any) {
        throw new RunmeServerError('Unable to read TLS files', e)
      }
    }

    protected async channelCredentials(): Promise<ChannelCredentials> {
      if (!getTLSEnabled()) {
        return ChannelCredentials.createInsecure()
      }

      const { certPEM, privKeyPEM } = await RunmeServer.getTLS(getTLSDir())

      return ChannelCredentials.createSsl(
        certPEM,
        privKeyPEM,
        certPEM,
      )
    }

    protected closeTransport() {
      this.#transport?.close()
      this.#transport = undefined
    }

    async transport() {
      if(this.#transport) { return this.#transport }

      this.#transport = new GrpcTransport({
        host: this.address(),
        channelCredentials: await this.channelCredentials(),
      })

      return this.#transport
    }

    async start(): Promise<string> {
        const binaryLocation = this.#binaryPath.fsPath

        const binaryExists = await fs.access(binaryLocation)
            .then(() => true, () => false)

        const isFile = await fs.stat(binaryLocation)
            .then((result) => {
                return result.isFile()
            }, () => false)

        if (!binaryExists || !isFile) {
            throw new RunmeServerError('Cannot find server binary file')
        }

        this.#port = getPortNumber()
        while (!(await isPortAvailable(this.#port))) {
          this.#port++
        }

        const args = [
          'server',
          '--address',
          this.address(),
        ]

        if(this.enableRunner) {
          args.push('--runner')
        }

        if(getTLSEnabled()) {
          args.push('--tls', getTLSDir())
        } else {
          args.push('--insecure')
        }

        const process = spawn(binaryLocation, args)

        process.on('close', (code) => {
            if (this.#loggingEnabled) {
                log.info(`Server process #${this.#process?.pid} closed with code ${code}`)
            }
            this.#onClose.fire({ code })

            this.disposeProcess(process)
        })


        process.stderr.once('data', () => {
            log.info(`Server process #${this.#process?.pid} started on port ${this.#port}`)
        })

        process.stderr.on('data', (data) => {
            if (this.#loggingEnabled) {
                log.info(data.toString())
            }
        })

        this.#process = process

        return Promise.race(
          [
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
                    } catch(e) {
                      continue
                    }

                    if (log.addr) {
                      process.stderr.off('data', cb)
                      return resolve(log.addr)
                    }
                  }
                } catch (err: any) {
                    reject(new RunmeServerError(`Server failed, reason: ${(err as Error).message}`))
                }
              }

              process.stderr.on('data', cb)
            }),
            new Promise<never>((_, reject) => {
              const { dispose } = this.#onClose.event(() => {
                dispose()
                reject(new Error('Server closed prematurely!'))
              })
            }),
            new Promise<never>((_, reject) => setTimeout(
              () => reject(new Error('Timed out listening for server ready message')),
              10000
            )),
          ]
        )
    }

    async acceptsConnection(): Promise<void> {
        const INTERVAL = this.#acceptsInterval
        const INTENTS = this.#acceptsIntents
        let iter = 0
        let isRunning = false

        while (iter < INTENTS) {
          isRunning = await this.isRunning()
          if (isRunning) {
            return
          }

          await new Promise(r => setInterval(r, INTERVAL))

          iter++
        }

        throw new RunmeServerError(`Server did not accept connections after ${iter*INTERVAL}ms`)
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
            console.error(`Failed to start runme server, retrying. Error: ${(e as Error).message}`)
            return this.launch(intent + 1)
          }
          throw new RunmeServerError(`Cannot start server. Error: ${(e as Error).message}`)
      }

      await this.connect()

      // relaunch on close
      this.registerServerDisposable(
        this.#onClose.event(() => {
          this.launch()
          this.#serverDisposables.forEach(({ dispose }) => dispose())
        })
      )

      return addr
    }

    protected async connect(): Promise<void> {
      this.closeTransport()
      await this.acceptsConnection()

      this.#onTransportReady.fire({ transport: await this.transport() })
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

export default RunmeServer
