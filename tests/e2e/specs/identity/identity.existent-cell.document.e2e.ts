import { Key } from 'webdriverio'

import { RunmeNotebook } from '../../pageobjects/notebook.page.js'
import {
  assertDocumentContains,
  revertChanges,
  updateLifecycleIdentitySetting,
} from '../../helpers/index.js'

async function reloadWindow() {
  const workbench = await browser.getWorkbench()
  await workbench.executeCommand('Developer: Reload Window')
}

async function removeAllNotifications() {
  const workbench = await browser.getWorkbench()
  const notifications = await workbench.getNotifications()
  await Promise.all(notifications.map((notification) => notification.dismiss()))
}

describe('Test suite: Cell with existent identity and setting document only (2)', async () => {
  before(async () => {
    await removeAllNotifications()
  })

  const notebook = new RunmeNotebook()
  it('open identity markdown file', async () => {
    await browser.executeWorkbench(async (vscode) => {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(`${vscode.workspace.rootPath}/examples/identity/existent-cell-id.md`),
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
    }, '/examples/identity/existent-cell-id.md')

    await updateLifecycleIdentitySetting(2)
    await reloadWindow()
    await notebook.focusDocument()
    const workbench = await browser.getWorkbench()
    await workbench.executeCommand('Notebook: Focus First Cell')
    await browser.keys([Key.Enter])
    const cell = await notebook.getCell('console.log("Hello from JS")')
    await cell.focus()
    await browser.keys([Key.Control, 's'])

    await assertDocumentContains(
      absDocPath,
      `
      ---
      runme:
        id: 01HEXJ9KWG7BYSFYCNKSRE4JZR
        version: v2.0
      ---

      ## Existent ID
      Example file used as part of the end to end suite

      ## Scenario

      \`\`\`js {"id":"01HER3GA0RQKJETKK5X5PPRTB4"}
      console.log("Hello from JS")

      \`\`\`

      `,
    )
  })

  after(() => {
    //revert changes we made during the test
    revertChanges('existent-cell-id.md')
  })
})
