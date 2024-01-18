import { Key } from 'webdriverio'

import { RunmeNotebook } from '../../pageobjects/notebook.page.js'
import {
  assertDocumentContainsSpinner,
  revertChanges,
  saveFile,
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

describe('Test suite: Shebang with setting Cell only (3)', async () => {
  before(async () => {
    await removeAllNotifications()
  })

  const notebook = new RunmeNotebook()
  it('open identity markdown file', async () => {
    await browser.executeWorkbench(async (vscode) => {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(`${vscode.workspace.rootPath}/examples/identity/shebang.md`),
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

  it('should add identity to cell only', async () => {
    const absDocPath = await browser.executeWorkbench(async (vscode, documentPath) => {
      return `${vscode.workspace.rootPath}${documentPath}`
    }, '/examples/identity/shebang.md')

    await updateLifecycleIdentitySetting(3)
    await reloadWindow()
    await notebook.focusDocument()
    const workbench = await browser.getWorkbench()
    await workbench.executeCommand('Notebook: Focus First Cell')
    await browser.keys([Key.Enter])
    const cell = await notebook.getCell('console.log("Always bet on JS!")')
    await cell.focus()
    await saveFile(browser)

    await assertDocumentContainsSpinner(
      absDocPath,
      `
      ## Shebang
      Example file used as part of the end to end suite

      ## Scenario

      \`\`\`js { name=foo id=01HEXJ9KWG7BYSFYCNKVF0VWR6 }
      console.log("Always bet on JS!")

      \`\`\`

      `,
    )
  })

  after(() => {
    //revert changes we made during the test
    revertChanges('shebang.md')
  })
})
