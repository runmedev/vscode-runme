import fs from 'node:fs/promises'

import { suite, test, expect, vi, beforeEach } from 'vitest'
import { Uri, workspace } from 'vscode'

// eslint-disable-next-line import/order
import { isPortAvailable } from '../../../src/extension/utils'

vi.mock('vscode')
vi.mock('../../../src/extension/grpc/client', () => ({ initParserClient: vi.fn() }))

vi.mock('../../../src/extension/utils', () => ({
  isPortAvailable: vi.fn(async () => true),
}))

vi.mock('node:fs/promises', async () => ({
  default: {
      access: vi.fn().mockResolvedValue(false),
      stat: vi.fn().mockResolvedValue({
          isFile: vi.fn().mockReturnValue(false)
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
  }
}))

vi.mock('node:child_process', async () => ({
  spawn: vi.fn(),
}))

import Server from '../../../src/extension/server/runmeServer'
import RunmeServerError from '../../../src/extension/server/runmeServerError'
import { testCertPEM, testPrivKeyPEM } from '../../testTLSCert'

suite('Runme server spawn process', () => {
    const configValues: Record<string, any> = {
        binaryPath: 'bin/runme'
    }
    vi.mocked(workspace.getConfiguration).mockReturnValue({
        get: vi.fn().mockImplementation((config: string) => configValues[config])
    } as any)

    test('proper credentials without tls', async () => {
      configValues.enableTLS = false

      const server = new Server(
        Uri.file('/Users/user/.vscode/extension/stateful.runme'),
        {
          retryOnFailure: true,
          maxNumberOfIntents: 2,
        },
        false
      )

      const creds = await server['channelCredentials']()
      expect(creds._isSecure()).toBe(false)
  })

  test('proper credentials with tls', async () => {
    configValues.enableTLS = true

    const server = new Server(
      Uri.file('/Users/user/.vscode/extension/stateful.runme'),
      {
        retryOnFailure: true,
        maxNumberOfIntents: 2,
      },
      false
    )

    const creds = await server['channelCredentials']()
    expect(creds._isSecure()).toBe(true)
})

    test('Should try 2 times before failing', async () => {
      configValues.enableTLS = true

      const server = new Server(
        Uri.file('/Users/user/.vscode/extension/stateful.runme'),
        {
          retryOnFailure: true,
          maxNumberOfIntents: 2,
        },
        false
      )
      const serverLaunchSpy = vi.spyOn(server, 'launch')
      await expect(server.launch()).rejects.toBeInstanceOf(RunmeServerError)
      expect(serverLaunchSpy).toBeCalledTimes(3)
    })

    test('Should increment until port is available', async () => {
      configValues.enableTLS = true

      const server = new Server(
        Uri.file('/Users/user/.vscode/extension/stateful.runme'),
        {
          retryOnFailure: true,
          maxNumberOfIntents: 2,
        },
        false
      )

      vi.mocked(fs.access).mockResolvedValueOnce()
      vi.mocked(fs.stat).mockResolvedValueOnce({
        isFile: vi.fn().mockReturnValue(true)
      } as any)

      vi.mocked(isPortAvailable).mockResolvedValueOnce(false)
      const port = server['_port']()
      await expect(server.launch()).rejects.toBeInstanceOf(RunmeServerError)

      expect(server['_port']()).toStrictEqual(port + 1)
    })
})

suite('Runme server accept connections', () => {
    let server: Server
    beforeEach(() => {
        server = new Server(
          Uri.file('/Users/user/.vscode/extension/stateful.runme'),
          {
            retryOnFailure: false,
            maxNumberOfIntents: 2,
            acceptsConnection: {
              intents: 4,
              interval: 1,
            }
          },
          false
        )
    })

    test('Should wait until server accepts connection', async () => {
        server.start = vi.fn().mockResolvedValue('localhost:8080')
        server.isRunning = vi.fn().mockResolvedValue(true)

        await expect(
          server.launch()
        ).resolves.toBe('localhost:8080')
    })

    test('Should wait throw error when server never accepts connection', async () => {
        server.start = vi.fn().mockResolvedValue('localhost:8080')
        server.isRunning = vi.fn().mockResolvedValue(false)

        await expect(
          server.launch()
        ).rejects.toThrowErrorMatchingInlineSnapshot(
          '"Server did not accept connections after 4ms"'
        )
    })
})

test('Runme server clears server disposables', () => {
  const server = new Server(
    Uri.file('/Users/user/.vscode/extension/stateful.runme'),
    {
      retryOnFailure: false,
      maxNumberOfIntents: 2,
      acceptsConnection: {
        intents: 4,
        interval: 1,
      }
    },
    false
  )

  const dispose = vi.fn()

  server['registerServerDisposable']({ dispose })
  server['clearServerDisposables']()

  expect(dispose).toHaveBeenCalledTimes(1)
})
