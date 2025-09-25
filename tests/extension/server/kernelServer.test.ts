/* eslint-disable quotes */
import fs from 'node:fs/promises'

import { suite, test, expect, vi, beforeEach } from 'vitest'
import { Uri, workspace, env } from 'vscode'
// eslint-disable-next-line max-len
import { HealthCheckResponse_ServingStatus } from '@buf/grpc_grpc.community_timostamm-protobuf-ts/grpc/health/v1/health_pb'

// eslint-disable-next-line import/order
import { isPortAvailable } from '../../../src/extension/utils'

import Server, { IServerConfig } from '../../../src/extension/server/kernelServer'
import KernelServerError from '../../../src/extension/server/kernelServerError'
import { testCertPEM, testPrivKeyPEM } from '../../testTLSCert'
import {
  createConnectTransport,
  createGrpcHttpTransport,
  createGrpcUdsTransport,
} from '../../../src/extension/grpc/parser/connect/client'

const configValues: Record<string, any> = {
  binaryPath: 'bin/runme',
}

const healthCheck = vi.fn()

vi.mock('vscode')
vi.mock('../../../src/extension/grpc/parser/connect/client', () => ({
  createConnectTransport: vi.fn(),
  createGrpcHttpTransport: vi.fn(),
  createGrpcUdsTransport: vi.fn(),
}))
vi.mock('../../../src/extension/grpc/tcpClient', () => ({
  initParserClient: vi.fn(),
  HealthClient: class {
    check = healthCheck
  },
}))

vi.mock('../../../src/extension/utils', () => ({
  isTelemetryEnabled: vi.fn().mockReturnValue(true),
  isPortAvailable: vi.fn(async () => true),
  isWindows: vi.fn().mockReturnValue(false),
}))

vi.mock('node:fs/promises', async () => ({
  default: {
    access: vi.fn().mockResolvedValue(false),
    stat: vi.fn().mockResolvedValue({
      isFile: vi.fn().mockReturnValue(false),
    }),
    readFile: vi.fn().mockImplementation((filePath) => {
      if (filePath.toString().endsWith('cert.pem')) {
        return testCertPEM
      }

      if (filePath.toString().endsWith('key.pem')) {
        return testPrivKeyPEM
      }

      return Buffer.from('')
    }),
  },
}))

vi.mock('crypto', async () => ({
  default: {
    randomBytes: vi.fn().mockReturnValue('abcdefgh'),
  },
}))

vi.mock('node:child_process', async () => ({
  spawn: vi.fn(),
}))

suite('health check', () => {
  test('passes if serving', async () => {
    const server = createServer()
    healthCheck.mockResolvedValueOnce({
      response: { status: HealthCheckResponse_ServingStatus.SERVING },
    })

    expect(await server['isRunning']()).toBe(true)
  })

  test('fails if not serving', async () => {
    const server = createServer()
    healthCheck.mockResolvedValueOnce({
      response: { status: HealthCheckResponse_ServingStatus.NOT_SERVING },
    })

    expect(await server['isRunning']()).toBe(false)
  })

  test('fails if error', async () => {
    const server = createServer()
    healthCheck.mockRejectedValueOnce({ code: 'UNAVAILABLE' })

    expect(await server['isRunning']()).toBe(false)
  })
})

suite('Kernel server spawn process', () => {
  vi.mocked(workspace.getConfiguration).mockReturnValue({
    get: vi.fn().mockImplementation((config: string) => configValues[config]),
  } as any)

  test('Should try twice before failing', async () => {
    configValues.enableTLS = true

    const server = createServer({
      retryOnFailure: true,
      maxNumberOfIntents: 2,
    })

    const serverLaunchSpy = vi.spyOn(server, 'launch')
    await expect(server.launch()).rejects.toBeInstanceOf(KernelServerError)
    expect(serverLaunchSpy).toBeCalledTimes(3)
  })

  test('Should increment until port is available', async () => {
    configValues.enableTLS = true

    const server = createServer({
      retryOnFailure: true,
      maxNumberOfIntents: 2,
    })

    vi.mocked(fs.access).mockResolvedValueOnce()
    vi.mocked(fs.stat).mockResolvedValueOnce({
      isFile: vi.fn().mockReturnValue(true),
    } as any)

    vi.mocked(isPortAvailable).mockResolvedValueOnce(false)
    const port = server['_port']()
    await expect(server.launch()).rejects.toBeInstanceOf(KernelServerError)

    expect(server['_port']()).toStrictEqual(port + 1)
  })

  test('Should respect telemetry choice', async () => {
    configValues.enableTLS = true

    const server = createServer({
      retryOnFailure: true,
      maxNumberOfIntents: 2,
    })

    vi.mocked(env).isTelemetryEnabled = false
    expect(server['getConfiguredEnv']()['DO_NOT_TRACK']).toBe('true')
  })
})

suite('Kernel server GRPC transport', () => {
  test('proper credentials without tls', async () => {
    configValues.enableTLS = false

    const server = new Server(
      Uri.file('/Users/user/.vscode/extension/stateful.runme'),
      <any>{},
      {
        retryOnFailure: true,
        maxNumberOfIntents: 2,
      },
      false,
    )

    const creds = await server['channelCredentials']()
    expect(creds._isSecure()).toBe(false)
  })

  test('proper credentials with tls', async () => {
    configValues.enableTLS = true

    const server = new Server(
      Uri.file('/Users/user/.vscode/extension/stateful.runme'),
      <any>{},
      {
        retryOnFailure: true,
        maxNumberOfIntents: 2,
      },
      false,
    )

    const creds = await server['channelCredentials']()
    expect(creds._isSecure()).toBe(true)
  })

  test('uses UDS instead of TCP socket', async () => {
    configValues.transportType = 'UDS'

    const server = new Server(
      Uri.file('/Users/user/.vscode/extension/stateful.runme'),
      <any>{},
      {
        retryOnFailure: true,
        maxNumberOfIntents: 2,
      },
      false,
    )

    const runtimeDirSpy = vi
      .spyOn(server as any, 'getRuntimeDir')
      .mockReturnValue('/run/user/runme-test')
    const address = server['address']()
    runtimeDirSpy.mockRestore()
    expect(address).toStrictEqual('unix:///run/user/runme-test/runme-abcdefgh.sock')
  })

  test('uses TCP socket by default', async () => {
    configValues.transportType = undefined

    const server = new Server(
      Uri.file('/Users/user/.vscode/extension/stateful.runme'),
      <any>{},
      {
        retryOnFailure: true,
        maxNumberOfIntents: 2,
      },
      false,
    )

    const address = server['address']()
    expect(address).toStrictEqual('localhost:7863')
  })

  test('#connectAddress with non-UDS returns valid URL', async () => {
    configValues.transportType = 'TCP'

    const server = new Server(
      Uri.file('/Users/user/.vscode/extension/stateful.runme'),
      <any>{},
      {
        retryOnFailure: true,
        maxNumberOfIntents: 2,
      },
      false,
    )

    const url = new URL(server['connectAddress']())

    expect(url.protocol).toStrictEqual('https:')
    expect(url.hostname).toStrictEqual('localhost')
    expect(url.port).toStrictEqual('7863')
  })

  test('#connectAddress with UDS returns socket FQDN', async () => {
    configValues.transportType = 'UDS'

    const server = new Server(
      Uri.file('/Users/user/.vscode/extension/stateful.runme'),
      <any>{},
      {
        retryOnFailure: true,
        maxNumberOfIntents: 2,
      },
      false,
    )

    const runtimeDirSpy = vi
      .spyOn(server as any, 'getRuntimeDir')
      .mockReturnValue('/run/user/runme-test')
    const url = new URL(server['connectAddress']())
    runtimeDirSpy.mockRestore()

    expect(url.protocol).toStrictEqual('unix:')
    expect(url.pathname).toStrictEqual('/run/user/runme-test/runme-abcdefgh.sock')
  })

  test('#connectTransport returns non-UDS transport matching protocols', async () => {
    configValues.enableTLS = false // avoid TSL creds mocking
    configValues.transportType = undefined

    const server = new Server(
      Uri.file('/Users/user/.vscode/extension/stateful.runme'),
      <any>{},
      {
        retryOnFailure: true,
        maxNumberOfIntents: 2,
      },
      false,
    )

    await server['connectTransport']('connect')
    expect(createConnectTransport).toBeCalledWith({
      baseUrl: 'http://localhost:7863/',
      httpVersion: '2',
    })

    await server['connectTransport']('grpc')
    expect(createGrpcHttpTransport).toBeCalledWith({
      baseUrl: 'http://localhost:7863/',
      httpVersion: '2',
    })
  })

  test('#connectTransport returns UDS transport matching user settings', async () => {
    configValues.enableTLS = false // avoid TSL creds mocking
    configValues.transportType = 'UDS'

    let server = new Server(
      Uri.file('/Users/user/.vscode/extension/stateful.runme'),
      <any>{},
      {
        retryOnFailure: true,
        maxNumberOfIntents: 2,
      },
      false,
    )

    const firstRuntimeDirSpy = vi
      .spyOn(server as any, 'getRuntimeDir')
      .mockReturnValue('/run/user/runme-test')
    // transport type is set in constuctor
    server = new Server(
      Uri.file('/Users/user/.vscode/extension/stateful.runme'),
      <any>{},
      {
        retryOnFailure: true,
        maxNumberOfIntents: 2,
      },
      false,
    )

    const runtimeDirSpy = vi
      .spyOn(server as any, 'getRuntimeDir')
      .mockReturnValue('/run/user/runme-test')
    await server['connectTransport']('grpc')
    expect(createGrpcUdsTransport).toBeCalledWith({
      baseUrl: 'unix:///run/user/runme-test/runme-abcdefgh.sock',
      httpVersion: '2',
    })
    firstRuntimeDirSpy.mockRestore()
    runtimeDirSpy.mockRestore()
  })
})

suite('Kernel server accept connections', () => {
  let server: Server
  beforeEach(() => {
    server = createServer({
      retryOnFailure: false,
      maxNumberOfIntents: 2,
      acceptsConnection: {
        intents: 4,
        interval: 50,
      },
    })
  })

  test('Should wait until server accepts connection', async () => {
    ;(server as any).start = vi.fn().mockResolvedValue('localhost:8080')
    ;(server as any).isRunning = vi.fn().mockResolvedValue(true)

    await expect(server.launch()).resolves.toBe('localhost:8080')
  })

  test('Should wait throw error when server never accepts connection', async () => {
    ;(server as any).start = vi.fn().mockResolvedValue('localhost:8080')
    ;(server as any).isRunning = vi.fn().mockResolvedValue(false)

    await expect(server.launch()).rejects.toThrowErrorMatchingInlineSnapshot(
      `[KernelServerError: Server did not accept connections after 0.2s]`,
    )
  })
})

function createServer(
  config: IServerConfig = {
    retryOnFailure: true,
    maxNumberOfIntents: 2,
  },
  externalServer = false,
) {
  return new Server(
    Uri.file('/Users/user/.vscode/extension/stateful.runme'),
    <any>{},
    config,
    externalServer,
  )
}
