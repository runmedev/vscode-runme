import url from 'node:url'
import path from 'node:path'
import cp from 'node:child_process'

import { Key } from 'webdriverio'

import { RunmeNotebook } from '../../pageobjects/notebook.page.js'
import { assertDocumentContains, saveFile, updateSettings } from '../../helpers/index.js'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

async function reloadWindow() {
  const workbench = await browser.getWorkbench()
  await workbench.executeCommand('Developer: Reload Window')
}

async function removeAllNotifications() {
  const workbench = await browser.getWorkbench()
  const notifications = await workbench.getNotifications()
  await Promise.all(notifications.map((notification) => notification.dismiss()))
}

describe('Test suite: Document with existent identity and setting Document only (2)', async () => {
  before(async () => {
    await removeAllNotifications()
  })

  const notebook = new RunmeNotebook()
  it('open identity markdown file', async () => {
    await browser.executeWorkbench(async (vscode) => {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(`${vscode.workspace.rootPath}/examples/identity/existent-doc-id.md`),
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
    }, '/examples/identity/existent-doc-id.md')

    await updateSettings({ setting: 'runme.server.lifecycleIdentity', value: 2 })
    await reloadWindow()
    await notebook.focusDocument()
    const workbench = await browser.getWorkbench()
    await workbench.executeCommand('Notebook: Focus First Cell')
    await browser.keys([Key.Enter])
    const cell = await notebook.getCell('console.log("Always bet on JS!")')
    await cell.focus()
    await saveFile(browser)

    await assertDocumentContains(
      absDocPath,
      `---
      foo:
        bar: baz
      runme:
        id: 01HEJKW175Z0SYY4SJCA86J0TF
        version: v2.0
      ---

      ## Document with id

      Example file used as part of the end to end suite

      ## Scenario

      \`\`\`js {"name":"foo"}
      console.log("Always bet on JS!")

      \`\`\`


      `,
    )
  })

  after(() => {
    //revert changes we made during the test
    const mdPath = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'examples',
      'identity',
      'existent-doc-id.md',
    )
    cp.execSync(`git checkout -- ${mdPath}`)
  })
})
