import { suite, test, expect, vi, afterEach, beforeEach } from 'vitest'
import { Uri, type ExtensionContext, type WebviewView } from 'vscode'

import Panel from '../../../src/extension/panels/panel'

vi.mock('vscode')
vi.mock('vscode-telemetry')

vi.mock('../../../src/extension/grpc/client', () => ({}))
vi.mock('../../../src/extension/runner', () => ({}))

const SETTINGS_MOCK:
    {
        baseDomain: string | undefined
    } = {
    baseDomain: undefined,
}

beforeEach(() => {
  vi.mock('vscode', async () => {
    const mocked = await import('../../../__mocks__/vscode')

    return ({
      ...mocked,
      workspace: {
        getConfiguration: vi.fn().mockReturnValue({
          get: (configurationName) => {
            return SETTINGS_MOCK[configurationName]
          }
        }),
      },
      Uri: mocked.Uri,
    })
  })
})

afterEach(() => {
    Object.keys(SETTINGS_MOCK).forEach(key => {
          SETTINGS_MOCK[key] = undefined
    })
})

vi.mock('../../../src/extension/utils', () => {
  return {
    fetchStaticHtml: vi.fn().mockResolvedValue({
      text: vi
        .fn()
        .mockResolvedValue(
          '<script id="appAuthToken">window.APP_STATE = JSON.parse(\'{ "appToken": null }\');</script>'
        ),
    }),
  }
})

suite('Panel', () => {
  const staticHtml =
    '<script id="appAuthToken">window.APP_STATE = JSON.parse(\'{ "appToken": null }\');</script>'
  const contextMock: ExtensionContext = {
    extensionUri: Uri.parse('file:///Users/fakeUser/projects/vscode-runme'),
  } as any
  const view: WebviewView = { webview: { html: '' } } as any

  test('hydrates HTML', () => {
    const p = new Panel(contextMock, 'testing')
    const hydrated = p.hydrateHtml(staticHtml, {
      appToken: 'a.b.c',
      ide: 'code',
      panelId: 'main',
      defaultUx: 'panels',
    })

    expect(hydrated).toContain('<base href="https://app.runme.dev/">')
    expect(hydrated).toContain(
      '{"appToken":"a.b.c","ide":"code","panelId":"main","defaultUx":"panels"}'
    )
  })

  test('resovles authed', async () => {
    const p = new Panel(contextMock, 'testing')
    p.getAppToken = vi.fn().mockResolvedValue({ token: 'webview.auth.token' })

    await p.resolveWebviewTelemetryView(view)

    expect(view.webview.html).toContain('<base href="https://app.runme.dev/">')
    expect(view.webview.html).toContain(
      '{"ide":"code","panelId":"testing","appToken":"webview.auth.token","defaultUx":"panels"}'
    )
  })

  test('resovles unauthed', async () => {
    const p = new Panel(contextMock, 'testing')
    p.getAppToken = vi.fn().mockResolvedValue(null)

    await p.resolveWebviewTelemetryView(view)

    expect(view.webview.html).toContain('<base href="https://app.runme.dev/">')
    expect(view.webview.html).toContain(
      '{"ide":"code","panelId":"testing","appToken":"EMPTY","defaultUx":"panels"}'
    )
  })

  test('resovles authed localhost', async () => {
    SETTINGS_MOCK.baseDomain = 'localhost'
    const p = new Panel(contextMock, 'testing')
    p.getAppToken = vi.fn().mockResolvedValue({ token: 'webview.auth.token' })

    await p.resolveWebviewTelemetryView(view)

    expect(view.webview.html).toContain('<base href="http://localhost:4001/">')
    expect(view.webview.html).toContain(
      '{"ide":"code","panelId":"testing","appToken":"webview.auth.token","defaultUx":"panels"}'
    )
  })

  test('resovles unauthed localhost', async () => {
    SETTINGS_MOCK.baseDomain = 'localhost'
    const p = new Panel(contextMock, 'testing')
    p.getAppToken = vi.fn().mockResolvedValue(null)

    await p.resolveWebviewTelemetryView(view)

    expect(view.webview.html).toContain('<base href="http://localhost:4001/">')
    expect(view.webview.html).toContain(
      '{"ide":"code","panelId":"testing","appToken":"EMPTY","defaultUx":"panels"}'
    )
  })
})
