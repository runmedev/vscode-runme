import { Key } from 'webdriverio'

import { RunmeNotebook } from '../pageobjects/notebook.page.js'
import { removeAllNotifications } from '../specs/notifications.js'

import {
  assertDocumentContainsSpinner,
  revertChanges,
  saveFile,
  switchLifecycleIdentity,
  type RunmeLifecycleIdentity,
} from './index.js'

interface IdentityTestSuiteConfig {
  suiteName: string
  lifecycleSetting: RunmeLifecycleIdentity
  fixtureFile: string
  cellSelector?: string
  expectedOutput: string
  revertFile: string
  assertOptions?: {
    strict?: boolean
  }
}

export function runIdentityTestSuite({
  suiteName,
  lifecycleSetting,
  fixtureFile,
  cellSelector,
  expectedOutput,
  revertFile,
  assertOptions = {},
}: IdentityTestSuiteConfig) {
  describe(suiteName, async () => {
    before(async () => {
      await removeAllNotifications()
    })

    const notebook = new RunmeNotebook()
    it('open identity markdown file', async () => {
      const workbench = await browser.getWorkbench()
      await switchLifecycleIdentity(workbench, lifecycleSetting)
      await browser.executeWorkbench(async (vscode) => {
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(`${vscode.workspace.rootPath}${fixtureFile}`),
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

    it('should validate output', async () => {
      const absDocPath = await browser.executeWorkbench(async (vscode, documentPath) => {
        return `${vscode.workspace.rootPath}${documentPath}`
      }, fixtureFile)

      if (cellSelector) {
        await notebook.focusDocument()
        const workbench = await browser.getWorkbench()
        await workbench.executeCommand('Notebook: Focus First Cell')
        await browser.keys([Key.Enter])
        const cell = await notebook.getCell(cellSelector)
        await cell.focus()
      }
      await saveFile(browser)
      await assertDocumentContainsSpinner(
        absDocPath,
        expectedOutput,
        assertOptions && assertOptions.strict,
      )
    })

    after(async () => {
      await revertChanges(revertFile)
    })
  })
}
