import { Key } from 'webdriverio'

import { RunmeNotebook } from '../../pageobjects/notebook.page.js'
import { assertDocumentContainsSpinner, revertChanges, saveFile } from '../../helpers/index.js'
import { removeAllNotifications } from '../notifications.js'

describe('Test suite: Document with existent identity and setting Cell only (3)', async () => {
  before(async () => {
    await removeAllNotifications()
  })

  const notebook = new RunmeNotebook()
  it('open identity markdown file', async () => {
    const workbench = await browser.getWorkbench()
    await workbench.executeCommand('Runme: Lifecycle Identity - Cell')

    await browser.executeWorkbench(async (vscode) => {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(`${vscode.workspace.rootPath}/tests/fixtures/identity/existent-doc-id.md`),
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
    }, '/tests/fixtures/identity/existent-doc-id.md')

    await notebook.focusDocument()
    const workbench = await browser.getWorkbench()
    await workbench.executeCommand('Notebook: Focus First Cell')
    await browser.keys([Key.Enter])
    const cell = await notebook.getCell('console.log("Run scripts via Shebang!")')
    await cell.focus()
    await saveFile(browser)

    await assertDocumentContainsSpinner(
      absDocPath,
      `---
      foo:
        bar: baz
      runme:
        id: 01HEJKW175Z0SYY4SJCA86J0TF
        version: v3
      ---

      ## Document with id

      Example file used as part of the end to end suite

      ## Scenario

      \`\`\`js {"name":"foo"}
      console.log("Run scripts via Shebang!")

      \`\`\`


      `,
    )
  })

  after(async () => {
    //revert changes we made during the test
    await revertChanges('existent-doc-id.md')
  })
})
