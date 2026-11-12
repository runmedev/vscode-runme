import { Key } from 'webdriverio'
import { InputBox } from 'wdio-vscode-service'

import { getTerminalText, killAllTerminals } from '../helpers/index.js'

describe('Runme Codelense Support', async () => {
  before('should not prompt if promptEnv is false', async () => {
    return browser.executeWorkbench(async (vscode) => {
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(`${vscode.workspace.rootPath}/examples/test.md`),
      )
      return vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Active,
      })
    })
  })

  afterEach(() => {
    return browser.keys([Key.Escape])
  })

  it('should allow to run a cell', async () => {
    await browser.waitUntil(() => $$('.codelens-decoration').then((elems) => elems.length > 1))
    await $('.codelens-decoration a').click()
    await browser.pause(1000)

    const workbench = await browser.getWorkbench()
    const text = await getTerminalText(workbench)
    expect(text).toContain('Hello World!\n\n *')
    await killAllTerminals(workbench)
  })

  it('should allow to paste into terminal', async () => {
    await browser.waitUntil(
      () =>
        $$('.codelens-decoration').then((elems) => {
          return elems.length > 1
        }),
      { timeoutMsg: 'Codelens not found', timeout: 30 * 1000 },
    )
    const lense = (await $$('.codelens-decoration a'))[2]
    await lense.click()
    await browser.pause(1000)

    const workbench = await browser.getWorkbench()
    const text = await getTerminalText(workbench)
    expect(text).toContain('echo "Hello World!"')
    await killAllTerminals(workbench)
  })

  it('should not prompt a user if promptEnv is false', async () => {
    await browser.waitUntil(() => $$('.codelens-decoration').then((elems) => elems.length > 1))
    await $$('.codelens-decoration')[1].$('a').click()
    const workbench = await browser.getWorkbench()
    const inputBox = new InputBox(workbench.locatorMap)
    await expect(inputBox.elem).not.toBeDisplayed()
  })

  it('should allow to open file in notebook', async () => {
    await browser.waitUntil(() => $$('.codelens-decoration').then((elems) => elems.length > 1), {
      timeoutMsg: 'Codelens not found',
      timeout: 30 * 1000,
    })
    await $$('.codelens-decoration a')[1].click()
    await browser.pause(1000)

    const workbench = await browser.getWorkbench()
    await browser.waitUntil(async () => (await workbench.getAllWebviews()).length > 0, {
      timeoutMsg: "Notebook document didn't load",
    })
    const webview = (await workbench.getAllWebviews())[0]
    await webview.open()
    await expect($('body')).toHaveText(expect.stringContaining('Runme Examples'))
    await webview.close()
  })
})
