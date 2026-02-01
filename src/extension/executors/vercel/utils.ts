import os from 'node:os'
import fs from 'node:fs/promises'
import path from 'node:path'

import vscode from 'vscode'

import { VERCEL_DIR } from './constants'

export async function quickPick<T>(
  title: string,
  items: string[],
  onSelect?: (selection: readonly vscode.QuickPickItem[]) => any,
): Promise<T> {
  let madeSelection = false
  const quickPickLink = await vscode.window.createQuickPick()
  quickPickLink.title = title
  quickPickLink.items = items.map((item) => ({ label: item }))

  return new Promise((resolve, reject) => {
    quickPickLink.onDidChangeSelection((selection) => {
      madeSelection = true
      resolve(onSelect ? onSelect(selection) : selection[0].label)
      quickPickLink.hide()
    })
    quickPickLink.onDidHide(() => {
      quickPickLink.dispose()
      if (!madeSelection) {
        return reject(new Error(`No selection made for "${title}"`))
      }
    })
    quickPickLink.show()
  })
}

/**
 * update gitignore
 */
export async function updateGitIgnore(cwd: string, orgSlug: string, projectName: string) {
  let isGitIgnoreUpdated = false
  try {
    const gitIgnorePath = path.join(cwd, '.gitignore')
    let gitIgnore = (await fs.readFile(gitIgnorePath, 'utf8').catch(() => null)) ?? ''
    const EOL = gitIgnore.includes('\r\n') ? '\r\n' : os.EOL
    let contentModified = false

    if (!gitIgnore.split(EOL).includes(VERCEL_DIR)) {
      gitIgnore += `${
        gitIgnore.endsWith(EOL) || gitIgnore.length === 0 ? '' : EOL
      }${VERCEL_DIR}${EOL}`
      contentModified = true
    }

    if (contentModified) {
      await fs.writeFile(gitIgnorePath, gitIgnore)
      isGitIgnoreUpdated = true
    }

    vscode.window.showInformationMessage(
      `Linked to ${orgSlug}/${projectName} ` +
        `(created ${VERCEL_DIR}${isGitIgnoreUpdated ? ' and added it to .gitignore' : ''})`,
    )
  } catch (_error) {
    // ignore errors since this is non-critical
  }
}

/**
 * create Vercel project file
 */
export async function createVercelFile(cwd: string, orgId: string, projectId: string) {
  const vercelConfigPath = path.resolve(cwd, VERCEL_DIR, 'project.json')
  await fs.mkdir(path.dirname(vercelConfigPath)).catch(() => {
    /* ignore */
  })
  await fs.writeFile(vercelConfigPath, JSON.stringify({ projectId, orgId }))
}
