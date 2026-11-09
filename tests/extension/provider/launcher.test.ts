import { vi, describe, it, expect, beforeEach } from 'vitest'
import { commands, Uri, workspace } from 'vscode'

import {
  GLOB_PATTERN,
  RunmeFile,
  RunmeLauncherProvider,
} from '../../../src/extension/provider/launcher'
import { getDefaultWorkspace } from '../../../src/extension/utils'

vi.mock('../../../src/extension/grpc/tcpClient', () => ({}))
vi.mock('../../../src/extension/grpc/runner/v1', () => ({}))

vi.mock('vscode')
vi.mock('vscode-telemetry')

vi.mock('../../../src/extension/utils', () => ({
  getPathType: vi.fn().mockResolvedValue(1),
  getDefaultWorkspace: vi.fn().mockReturnValue('runme/workspace/src'),
  mapGitIgnoreToGlobFolders: vi
    .fn()
    .mockReturnValue([
      '**/modules/**',
      '**/out/**',
      '**/node_modules/**',
      '**/.vscode-test/**',
      '**/wasm/**',
      '**/coverage/**',
      '**/tests/e2e/logs/**',
      '**/tests/e2e/screenshots/**',
      '**/coverage/config/**',
      '**/abc/**/**',
      '**/a/**/b/**',
      '**/jspm_packages/**',
    ]),
}))

beforeEach(() => {
  vi.mocked(commands.executeCommand).mockClear()
  vi.mocked(workspace.createFileSystemWatcher).mockClear()
})

describe('Runme Notebooks', () => {
  it('returns an empty tree for empty workspace', async () => {
    const launchProvider = new RunmeLauncherProvider()
    const treeItems = await launchProvider.getChildren()
    expect(treeItems).toStrictEqual([])
  })

  describe('when opening in a workspace', () => {
    const launchProvider = new RunmeLauncherProvider(getDefaultWorkspace())
    it('should return the items for the root folder', async () => {
      const treeItems = await launchProvider.getChildren()
      expect(treeItems.length).toStrictEqual(2)
    })

    it('should return the items for the selected folder', async () => {
      // space after "src" is important here, see name tweaker var in launcher
      const element = new RunmeFile('runme/workspace/src ', {
        collapsibleState: 0,
        tooltip: 'Click to open runme file',
        lightIcon: 'icon.png',
        darkIcon: 'icon.png',
        contextValue: 'markdown-file',
        onSelectedCommand: {
          arguments: [{ file: 'README.md', folderPath: 'runme/workspace/src' }],
          command: 'runme.openRunmeFile',
          title: 'README.md',
        },
      })
      const treeItems = await launchProvider.getChildren(element)
      expect(treeItems.length).toStrictEqual(3)
      expect(launchProvider.getTreeItem(element)).toStrictEqual(element)
    })

    it('should open a file using runme renderer', () => {
      vi.mocked(Uri.file).mockImplementation((p) => p as any)
      const launchProvider = new RunmeLauncherProvider()
      launchProvider.openFile({ file: 'README.md', folderPath: 'runme/workspace/src' })
      expect(commands.executeCommand).toBeCalledTimes(1)
      expect(commands.executeCommand).toBeCalledWith(
        'vscode.openWith',
        'runme/workspace/src/README.md',
        'runme',
      )
    })
  })

  it('has a expandAll method', async () => {
    const launchProvider = new RunmeLauncherProvider()
    launchProvider.refresh = vi.fn()
    await launchProvider.collapseAll()
    expect(commands.executeCommand).toBeCalledWith('setContext', 'runme.launcher.isExpanded', false)
    expect(launchProvider.refresh).toBeCalledTimes(1)
  })

  it('has a expandAll method', async () => {
    const launchProvider = new RunmeLauncherProvider()
    launchProvider.refresh = vi.fn()
    await launchProvider.expandAll()
    expect(commands.executeCommand).toBeCalledWith('setContext', 'runme.launcher.isExpanded', true)
    expect(launchProvider.refresh).toBeCalledTimes(1)
  })

  it('adds files to list', async () => {
    const handler = vi.fn()
    vi.mocked(workspace.createFileSystemWatcher).mockReturnValue({
      onDidCreate: handler,
      onDidDelete: handler,
    } as any)
    const launchProvider = new RunmeLauncherProvider()
    launchProvider.refresh = vi.fn()
    launchProvider['_onDidChangeTreeData'] = { fire: vi.fn() } as any
    expect(workspace.createFileSystemWatcher).toBeCalledWith(GLOB_PATTERN, false, true, false)
    handler.mock.calls[0][0]({ path: '/foo/bar' }, true)
    expect([...launchProvider['filesTree'].entries()]).toEqual([
      ['foo ', { files: ['bar'], folderPath: '/foo' }],
    ])
    handler.mock.calls[1][0]({ path: '/foo/bar' })
    expect(launchProvider.refresh).toBeCalledTimes(1)
  })
})
