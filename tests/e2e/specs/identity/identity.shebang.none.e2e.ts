import { Key } from 'webdriverio'

import { RunmeNotebook } from '../../pageobjects/notebook.page.js'
import {
  assertDocumentContainsSpinner,
  revertChanges,
  saveFile,
  switchLifecycleIdentity,
} from '../../helpers/index.js'
import { removeAllNotifications } from '../notifications.js'

describe('Test suite: Shebang with setting None (0)', async () => {
  before(async () => {
    await removeAllNotifications()
  })

  const notebook = new RunmeNotebook()
  it('open identity markdown file', async () => {
    const workbench = await browser.getWorkbench()
    await switchLifecycleIdentity(workbench, 'None')

    await browser.executeWorkbench(async (vscode) => {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(`${vscode.workspace.rootPath}/tests/fixtures/identity/shebang.md`),
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

  it('should not add identity to front matter and cell', async () => {
    const absDocPath = await browser.executeWorkbench(async (vscode, documentPath) => {
      return `${vscode.workspace.rootPath}${documentPath}`
    }, '/tests/fixtures/identity/shebang.md')

    await notebook.focusDocument()
    const workbench = await browser.getWorkbench()
    await workbench.executeCommand('Notebook: Focus First Cell')
    await browser.keys([Key.Enter])
    const cell = await notebook.getCell('console.log("Scenario 1: Run scripts via Shebang!")')
    await cell.focus()
    await saveFile(browser)

    await assertDocumentContainsSpinner(
      absDocPath,
      `
      ## Shebang
      Example file used as part of the end to end suite

      ## Scenario 1

      \`\`\`js {"name":"foo"}
      console.log("Scenario 1: Run scripts via Shebang!")

      \`\`\`

      ## Scenario 2

      \`\`\`js {"id":"01HY444G8B44DF0DSGVRQ299QV"}
      console.log("Scenario 2: Run scripts via Shebang!")

      \`\`\`

      ## Scenario 3

      \`\`\`js
      console.log("Scenario 3: Run scripts via Shebang!")

      \`\`\`
      `,
      true,
    )
  })

  after(async () => {
    //revert changes we made during the test
    await revertChanges('shebang.md')
  })
})
