import { Key } from 'webdriverio'

import {
  assertDocumentContainsSpinner,
  revertChanges,
  saveFile,
  switchLifecycleIdentity,
} from '../../helpers/index.js'
import { removeAllNotifications } from '../notifications.js'

describe('Test suite: Empty file with setting Cell (3)', async () => {
  before(async () => {
    await removeAllNotifications()
  })
  it('open identity markdown file', async () => {
    const workbench = await browser.getWorkbench()
    await switchLifecycleIdentity(workbench, 'Cell')

    await browser.executeWorkbench(async (vscode) => {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(`${vscode.workspace.rootPath}/tests/fixtures/identity/empty-file.md`),
      )
      return vscode.window.showNotebookDocument(doc, {
        viewColumn: vscode.ViewColumn.Active,
      })
    })
  })

  it('selects Runme kernel', async () => {
    const workbench = await browser.getWorkbench()
    await workbench.executeCommand('Select Notebook Kernel')
    await browser.keys([Key.Enter])
  })

  it('should not remove the front matter with the identity', async () => {
    const absDocPath = await browser.executeWorkbench(async (vscode, documentPath) => {
      return `${vscode.workspace.rootPath}${documentPath}`
    }, '/tests/fixtures/identity/empty-file.md')

    await saveFile(browser)
    await assertDocumentContainsSpinner(absDocPath, '')
  })

  after(async () => {
    //revert changes we made during the test
    await revertChanges('empty-file.md')
  })
})
