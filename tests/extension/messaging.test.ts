import { expect, vi, test, suite, beforeEach } from 'vitest'
import { FileType, workspace, window, Uri, ExtensionContext } from 'vscode'
import { TelemetryReporter } from 'vscode-telemetry'

import { RecommendedExtension } from '../../src/extension/recommendation'

vi.mock('vscode', async () => {
  const vscode = await import('../../__mocks__/vscode')
  return {
    default: vscode,
    ...vscode,
    workspace: {
      ...vscode.workspace,
      openTextDocument: vi.fn().mockReturnValue({
        getText: vi.fn().mockReturnValue(
          JSON.stringify({
            recommendations: ['stateful.runme'],
          }),
        ),
      }),
    },
  }
})

vi.mock('vscode')

vi.mock('vscode-telemetry')

vi.mock('../../src/extension/grpc/tcpClient', () => ({}))
vi.mock('../../../src/extension/grpc/runner/v1', () => ({
  ResolveProgramRequest_Mode: vi.fn(),
}))

const contextMock: ExtensionContext = {
  globalState: {
    get: vi.fn().mockReturnValue(true),
    update: vi.fn().mockResolvedValue({}),
  },
} as any

suite('RecommendedExtension', () => {
  beforeEach(() => {
    vi.mocked(window.showInformationMessage).mockClear()
    vi.mocked(workspace.fs.writeFile).mockClear()
  })

  test('It should not prompt the user to install the extension when already added', async () => {
    const recommendExtension = new RecommendedExtension(contextMock)
    vi.mocked(workspace.fs.stat).mockResolvedValue({ type: FileType.File } as any)
    await recommendExtension.add()
    expect(window.showInformationMessage).toHaveBeenCalledTimes(0)
    expect(workspace.fs.writeFile).toHaveBeenCalledTimes(0)
  })

  test('It should add the extension', async () => {
    const recommendExtension = new RecommendedExtension(contextMock)
    vi.mocked(workspace.fs.stat).mockResolvedValue({ type: FileType.File } as any)
    vi.mocked(workspace.openTextDocument as any).mockResolvedValue({
      getText: vi.fn().mockReturnValue(
        JSON.stringify({
          recommendations: ['microsoft.docker'],
        }),
      ),
    })
    await recommendExtension.add()
    expect(workspace.fs.writeFile).toBeCalledTimes(1)
    expect(TelemetryReporter.sendTelemetryEvent).toBeCalledWith('runme.recommendExtension', {
      added: 'true',
      error: 'false',
    })
  })

  test('It should create a .vscode folder when needed', async () => {
    const recommendExtension = new RecommendedExtension(contextMock)
    vi.mocked(workspace.fs.stat).mockResolvedValue(false as any)
    vi.mocked(workspace.openTextDocument as any).mockResolvedValue({
      getText: vi.fn().mockReturnValue(
        JSON.stringify({
          recommendations: ['microsoft.docker'],
        }),
      ),
    })
    await recommendExtension.add()
    expect(workspace.fs.createDirectory).toBeCalledTimes(1)
    expect(workspace.fs.createDirectory).toHaveBeenCalledWith(Uri.parse('/runme/workspace/.vscode'))
    expect(workspace.fs.writeFile).toBeCalledTimes(1)
    expect(TelemetryReporter.sendTelemetryEvent).toBeCalledWith('runme.recommendExtension', {
      added: 'true',
      error: 'false',
    })
  })

  test('It should create a .vscode/extensions.json file when needed', async () => {
    const recommendExtension = new RecommendedExtension(contextMock)
    vi.mocked(workspace.fs.stat).mockImplementation(async (param: Uri) => {
      return param.path === '/runme/workspace/.vscode/extensions.json'
        ? { type: FileType.Unknown }
        : ({ type: FileType.Directory } as any)
    })
    vi.mocked(workspace.openTextDocument as any).mockResolvedValue({
      getText: vi.fn().mockReturnValue(
        JSON.stringify(
          {
            recommendations: ['microsoft.docker'],
          },
          null,
          2,
        ),
      ),
    })
    await recommendExtension.add()
    const writeFileCalls = vi.mocked(workspace.fs.writeFile).mock.calls[0]
    expect(workspace.fs.writeFile).toHaveBeenCalledOnce()
    expect((writeFileCalls[0] as Uri).path).toStrictEqual(
      '/runme/workspace/.vscode/extensions.json',
    )
    expect((writeFileCalls[1] as Buffer).toString('utf-8')).toStrictEqual(
      '{\n\t"recommendations": [\n\t\t"stateful.runme"\n\t]\n}',
    )
    expect(TelemetryReporter.sendTelemetryEvent).toBeCalledWith('runme.recommendExtension', {
      added: 'true',
      error: 'false',
    })
  })

  test('It should report on failure and add a message', async () => {
    const recommendExtension = new RecommendedExtension(contextMock)
    vi.mocked(workspace.openTextDocument as any).mockResolvedValue({
      getText: vi.fn().mockImplementation(new Error('Failure') as any),
    })
    await recommendExtension.add()
    expect(TelemetryReporter.sendTelemetryEvent).toBeCalledWith('runme.recommendExtension', {
      added: 'false',
      error: 'true',
    })
  })

  test('Should not prompt for multi-root workspaces when using the command palette', async () => {
    const recommendExtension = new RecommendedExtension(contextMock, {
      'runme.recommendExtension': true,
    })
    // @ts-expect-error
    workspace.workspaceFolders = [
      { uri: Uri.file('/Users/user/Projects/project1') },
      { uri: Uri.file('/Users/user/Projects/project2') },
    ]
    await recommendExtension.add()
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'Multi-root workspace are not supported',
    )
  })

  test('Should not proceed for multi-root workspaces', async () => {
    const recommendExtension = new RecommendedExtension(contextMock)
    // @ts-expect-error
    workspace.workspaceFolders = [
      { uri: Uri.file('/Users/user/Projects/project1') },
      { uri: Uri.file('/Users/user/Projects/project2') },
    ]
    await recommendExtension.add()
    expect(workspace.fs.writeFile).toHaveBeenCalledTimes(0)
  })
})
