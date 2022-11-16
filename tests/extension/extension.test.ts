import { test, expect, vi } from 'vitest'
import { notebooks, workspace, commands } from 'vscode'

import { RunmeExtension } from '../../src/extension/extension'

vi.mock('vscode')


test('initialises all providers', async () => {
  const context: any = { subscriptions: [], extensionUri: { fsPath: '/foo/bar' } }
  const ext = new RunmeExtension()
  await ext.initialise(context)
  expect(notebooks.registerNotebookCellStatusBarItemProvider).toBeCalledTimes(5)
  expect(workspace.registerNotebookSerializer).toBeCalledTimes(1)
  expect(commands.registerCommand).toBeCalledTimes(7)
})
