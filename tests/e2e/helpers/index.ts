import fs from 'node:fs/promises'
import path from 'node:path'
import cp from 'node:child_process'
import url from 'node:url'

import * as jsonc from 'comment-json'
import clipboard from 'clipboardy'
import { sleep, type Workbench } from 'wdio-vscode-service'
import { Key } from 'webdriverio'

/**
 * TODO: cannot get text, this is a bug in wdio integration...
 *
 * Replacement for:
 *
 * ```typescript
 * const text = await terminalView.getText()
 * ```
 */
export async function getTerminalText(workbench: Workbench) {
  await workbench.executeCommand('Terminal: Focus on Terminal View')
  await workbench.executeCommand('Terminal: Select All')
  await workbench.executeCommand('Copy')
  const text = await clipboard.read()
  await clipboard.write('')
  return text
}

export function killAllTerminals(workbench: Workbench) {
  return workbench.executeCommand('Terminal: Kill All Terminals')
}

export async function tryExecuteCommand(workbench: Workbench, command: string) {
  const cmds = await workbench.openCommandPrompt()

  await cmds.setText(`>${command}`)

  const items = await cmds.getQuickPicks()

  if (items.length > 0 && (await items[0].getLabel()) !== 'No matching commands') {
    await cmds.confirm()
  } else {
    await cmds.cancel()
  }
}

// export async function getInputBox(workbench: Workbench) {
//   if ((await browser.getVSCodeChannel() === 'vscode' && await browser.getVSCodeVersion() >= '1.44.0')
//     || await browser.getVSCodeVersion() === 'insiders') {
//     return new InputBox(workbench.locatorMap)
//   }
//   return new QuickOpenBox(workbench.locatorMap)
// }

// export async function waitForInputBox(workbench: Workbench) {
//   return (await getInputBox(workbench)).wait()
// }

export async function clearAllOutputs(workbench: Workbench) {
  await tryExecuteCommand(workbench, 'Notebook: Clear All Outputs')
  await tryExecuteCommand(workbench, 'Notebook: Clear Cell Outputs')
}

export async function updateSettings({
  setting,
  value,
}: {
  setting: string
  value: string | boolean | number
}) {
  const documentPath = '/.vscode/settings.json'
  const absDocPath = await browser.executeWorkbench(async (vscode, documentPath) => {
    return `${vscode.workspace.rootPath}${documentPath}`
  }, documentPath)
  const source = await fs.readFile(absDocPath, 'utf-8')
  const settings = jsonc.parse(source) as any
  settings[setting] = value
  await fs.writeFile(absDocPath, jsonc.stringify(settings, null, 2))
}

export async function updateLifecycleIdentitySetting(value: number) {
  return updateSettings({ setting: 'runme.server.lifecycleIdentity', value: value })
}

function sanitizeOutput(output: string) {
  return output.trim().replace(/^\s+/gm, '')
}

async function assertDocumentContains(absDocPath: string, matcher: string, exact: boolean = false) {
  const source = await fs.readFile(absDocPath, 'utf-8')
  const savedContent = sanitizeOutput(source.toString()).split('\n')
  const matcherParts = sanitizeOutput(matcher).split('\n')
  const maxContentLines = Math.min(matcherParts.length, savedContent.length)

  for (let index = 0; index < maxContentLines; index++) {
    if (exact) {
      await expect(savedContent[index].trim()).toMatch(matcherParts[index].trim())
    }

    if (savedContent[index].includes('"id":')) {
      await expect(savedContent[index]).toMatch(JSON_ULID)
    } else if (savedContent[index].includes('id:')) {
      await expect(savedContent[index]).toMatch(FRONT_MATTER_ULID)
    } else {
      await expect(savedContent[index]).toMatch(matcherParts[index])
    }
  }
}

export async function assertDocumentContainsSpinner(
  absDocPath: string,
  matcher: string,
  exact: boolean = false,
  retries: number = 10,
  interval: number = 1000,
) {
  try {
    await assertDocumentContains(absDocPath, matcher, exact)
  } catch (err: any) {
    if (retries <= 0) {
      console.warn(`Retrying assertDocumentContainsSpinner: ${err.message}`)
      throw err
    }
    await sleep(interval)
    await assertDocumentContainsSpinner(absDocPath, matcher, exact, retries - 1, interval)
  }
}

export function revertChanges(fileName: string) {
  //revert changes we made during the test
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
  const mdPath = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'tests',
    'fixtures',
    'identity',
    fileName,
  )
  const settingsPath = path.resolve(__dirname, '..', '..', '..', '.vscode', 'settings.json')
  cp.execSync(`git checkout -- ${mdPath} ${settingsPath}`)
}

const osPlatform = process.platform.toString()

export function saveFile(browser: WebdriverIO.Browser): Promise<void> {
  if (osPlatform.indexOf('darwin') > -1) {
    browser.keys([Key.Command, 's'])
  } else {
  }
  return browser.keys([Key.Control, 's'])
}

export const FRONT_MATTER_ULID = /id[:=] ([0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26})\s*/
export const JSON_ULID = /\"id\":\"([0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26})\"/

export async function getRepoBasename(): Promise<string> {
  const filePath = new URL('../../..', import.meta.url)
  return path.basename(filePath.pathname)
}
