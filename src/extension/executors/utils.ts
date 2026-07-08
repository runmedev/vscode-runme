import cp from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

import {
  NotebookCellOutput,
  NotebookCellOutputItem,
  window,
  NotebookData,
  NotebookCell,
  NotebookCellData,
  Uri,
  NotebookDocument,
  workspace,
  WorkspaceFolder,
  NotebookCellExecution,
} from 'vscode'

import { DEFAULT_PROMPT_ENV, OutputType, RUNME_FRONTMATTER_PARSED } from '../../constants'
import type { CellOutputPayload, Serializer, ShellType } from '../../types'
import { NotebookCellOutputManager } from '../cell'
import { getAnnotations, getWorkspaceFolder, isDaggerShell } from '../utils'
import { CommandMode, CommandModeEnum } from '../grpc/runner/types'
import { StatefulFsScheme } from '../provider/statefulFs'
import { ENV_STORE } from '../constants'

const HASH_PREFIX_REGEXP = /^\s*\#\s*/g
const ENV_VAR_REGEXP = /(\$\w+)/g
/**
 * for understanding post into https://jex.im/regulex/
 */
const EXPORT_EXTRACT_REGEX = /(\n*)export \w+=(("[^"]*")|('[^']*')|(.+(?=(\n|;))))/gim

export function renderError(outputs: NotebookCellOutputManager, output: string) {
  return outputs.replaceOutputs(
    new NotebookCellOutput([
      NotebookCellOutputItem.json(
        <CellOutputPayload<OutputType.error>>{
          type: OutputType.error,
          output,
        },
        OutputType.error,
      ),
    ]),
  )
}

export function populateEnvVar(value: string, env = process.env) {
  for (const m of value.match(ENV_VAR_REGEXP) || []) {
    const envVar = m.slice(1) // slice out '$'
    value = value.replace(m, env[envVar] || '')
  }

  return value
}

export interface CommandExportExtractMatch {
  type: 'exec' | 'prompt' | 'direct'
  key: string
  value: string
  match: string
  regexpMatch?: RegExpExecArray
  hasStringValue: boolean
  isPassword?: boolean
}

export async function promptUserForVariable(
  key: string,
  placeHolder: string,
  hasStringValue: boolean,
  password: boolean,
): Promise<string | undefined> {
  return await window.showInputBox({
    title: `Set Environment Variable "${key}"`,
    ignoreFocusOut: true,
    placeHolder,
    password,
    prompt: 'Your shell script wants to set some environment variables, please enter them here.',
    ...(hasStringValue ? { value: placeHolder } : {}),
  })
}

export function getCommandExportExtractMatches(
  rawText: string,
  supportsDirect = true,
  supportsPrompt = DEFAULT_PROMPT_ENV,
): CommandExportExtractMatch[] {
  const test = new RegExp(EXPORT_EXTRACT_REGEX)

  const matchStr = rawText.endsWith('\n') ? rawText : `${rawText}\n`

  let match: RegExpExecArray | null

  const result: CommandExportExtractMatch[] = []

  while ((match = test.exec(matchStr)) !== null) {
    const e = match[0]

    const [key, ph] = e.trim().slice('export '.length).split('=')
    const hasStringValue = ph.startsWith('"') || ph.startsWith("'")
    const placeHolder = hasStringValue ? ph.slice(1, -1) : ph

    let matchType: CommandExportExtractMatch['type']
    let value = placeHolder

    if (placeHolder.startsWith('$(') && placeHolder.endsWith(')')) {
      matchType = 'exec'
      value = placeHolder.slice(2, -1)
    } else if (!placeHolder.includes('\n') && supportsPrompt) {
      matchType = 'prompt'
    } else if (supportsDirect) {
      matchType = 'direct'
    } else {
      continue
    }

    result.push({
      type: matchType,
      regexpMatch: match,
      key,
      value,
      match: e,
      hasStringValue,
    })
  }

  return result
}

/**
 * Try to get shell path from environment (`$SHELL`)
 *
 * @param execKey Used as fallback in case `$SHELL` is not present
 */
export function getSystemShellPath(): string | undefined
export function getSystemShellPath(execKey: string): string
export function getSystemShellPath(execKey?: string): string | undefined
export function getSystemShellPath(execKey?: string): string | undefined {
  return process.env.SHELL ?? execKey
}

export function getNotebookSkipPromptEnvSetting(
  notebook: NotebookData | Serializer.Notebook | NotebookDocument,
): boolean {
  const notebookMetadata = notebook.metadata as Serializer.Metadata | undefined
  const frontmatter = notebookMetadata?.[RUNME_FRONTMATTER_PARSED]
  return frontmatter?.skipPrompts || false
}

export function getCellShellPath(
  cell: NotebookCell | NotebookCellData | Serializer.Cell,
  notebook: NotebookData | Serializer.Notebook | NotebookDocument,
  execKey?: string,
): string | undefined {
  const { interpreter: cellInterpreter } = getAnnotations(cell.metadata)
  const notebookMetadata = notebook.metadata as Serializer.Metadata | undefined

  const frontmatter = notebookMetadata?.[RUNME_FRONTMATTER_PARSED]
  const cellBeatsFrontmatter = cellInterpreter || frontmatter?.shell

  if (cellBeatsFrontmatter) {
    return cellBeatsFrontmatter
  }

  if (
    !execKey &&
    'document' in cell &&
    (cell.document.languageId === 'sh' || cell.document.languageId === 'bash')
  ) {
    return getSystemShellPath(cell.document.languageId)
  }

  return getSystemShellPath(execKey)
}

export function isShellLanguage(languageId: string): ShellType | undefined {
  switch (languageId.toLowerCase()) {
    case 'daggercall':
    case 'daggershell':
      return 'sh'
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'ksh':
    case 'shell':
    case 'shellscript':
      return 'sh'

    case 'bat':
    case 'cmd':
      return 'cmd'

    case 'powershell':
    case 'pwsh':
      return 'powershell'

    case 'fish':
      return 'fish'

    default:
      return undefined
  }
}

export function getCellProgram(
  cell: NotebookCell | NotebookCellData | Serializer.Cell,
  notebook: NotebookData | Serializer.Notebook | NotebookDocument,
  execKey: string,
): { programName: string; commandMode: CommandMode } {
  const { INLINE_SHELL, TEMP_FILE, DAGGER } = CommandModeEnum()

  if (isShellLanguage(execKey)) {
    const shellPath = getCellShellPath(cell, notebook, execKey) ?? execKey

    const isDagger = isDaggerShell(shellPath)
    return {
      programName: shellPath,
      commandMode: isDagger ? DAGGER : INLINE_SHELL,
    }
  }

  const { interpreter: cellInterpreter } = getAnnotations(cell.metadata)
  const parsedFrontmatterShell = notebook.metadata?.[RUNME_FRONTMATTER_PARSED]?.shell
  const cellBeatsFrontmatter: string | undefined = cellInterpreter || parsedFrontmatterShell

  // TODO(sebastian): make empty case configurable?
  return {
    programName: cellBeatsFrontmatter ?? '',
    commandMode: TEMP_FILE,
  }
}

export async function getCellCwd(
  cell: NotebookCell | NotebookCellData | Serializer.Cell,
  notebook?: NotebookData | NotebookDocument | Serializer.Notebook,
  notebookFile?: Uri,
): Promise<string | undefined> {
  let res: string | undefined

  const getParent = (p?: string) => (p ? path.dirname(p) : undefined)

  const candidates = [
    getWorkspaceFolder(notebookFile)?.uri.fsPath,
    getParent(notebookFile?.fsPath),
    // TODO: support windows here
    (notebook?.metadata as Serializer.Metadata | undefined)?.[RUNME_FRONTMATTER_PARSED]?.cwd,
    getAnnotations(cell.metadata as Serializer.Metadata | undefined).cwd,
  ].filter(Boolean)

  if (notebook && 'uri' in notebook && notebook.uri.scheme === StatefulFsScheme) {
    const folders: readonly WorkspaceFolder[] = workspace.workspaceFolders || []
    if (folders.length > 0) {
      candidates.push(...folders.map((f) => f.uri.fsPath))
    } else {
      const fallbackCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'runme-fallback-cwd-'))
      candidates.push(fallbackCwd)
    }
  }

  for (let candidate of candidates) {
    if (!candidate) {
      continue
    }
    candidate = resolveOrAbsolute(res, candidate)

    if (candidate) {
      const folderExists = await fs.stat(candidate).then(
        (f) => f.isDirectory(),
        () => false,
      )

      if (!folderExists) {
        continue
      }

      res = candidate
    }
  }

  return res
}

function resolveOrAbsolute(parent?: string, child?: string): string | undefined {
  if (!child) {
    return parent
  }

  if (path.isAbsolute(child)) {
    return child
  }

  if (parent) {
    return path.join(parent, child)
  }

  return child
}

/**
 * treat cells like a series of individual commands
 * which need to be executed in sequence
 */
export function getCmdSeq(cellText: string): string[] {
  return cellText
    .trimStart()
    .split('\\\n')
    .map((l) => l.trim())
    .join(' ')
    .split('\n')
    .map((l) => {
      const hashPos = l.indexOf('#')
      if (hashPos > -1) {
        return l.substring(0, hashPos).trim()
      }
      const stripped = l.trim()

      if (stripped.startsWith('$')) {
        return stripped.slice(1).trim()
      } else {
        return stripped
      }
    })
    .filter((l) => {
      const hasPrefix = (l.match(HASH_PREFIX_REGEXP) || []).length > 0
      return l !== '' && !hasPrefix
    })
}

/**
 * treat cells like like a series of individual commands
 * which need to be executed in sequence
 *
 * packages command sequence into single callable script
 */
export function getCmdShellSeq(cellText: string, os: string): string {
  const trimmed = getCmdSeq(cellText).join('; ')

  if (['darwin'].find((entry) => entry === os)) {
    return `set -e -o pipefail; ${trimmed}`
  } else if (os.toLocaleLowerCase().startsWith('win')) {
    return trimmed
  }

  return `set -e; ${trimmed}`
}

/**
 * Helper method to parse the shell code and runs the following operations:
 *   - fetches environment variable exports and puts them into ENV_STORE
 *   - runs embedded shell scripts for exports, e.g. `exports=$(echo "foobar")`
 *
 * @param exec NotebookCellExecution
 * @returns cell text if all operation to retrieve the cell text could be executed, undefined otherwise
 */
export async function retrieveShellCommand(
  exec: NotebookCellExecution,
  promptForEnv = DEFAULT_PROMPT_ENV,
) {
  let cellText = exec.cell.document.getText()
  const cwd = path.dirname(exec.cell.document.uri.fsPath)
  const rawText = exec.cell.document.getText()

  const exportMatches = getCommandExportExtractMatches(rawText, true, promptForEnv)

  const stateEnv = Object.fromEntries(ENV_STORE)

  for (const { hasStringValue, key, match, type, value } of exportMatches) {
    if (type === 'exec') {
      /**
       * evaluate expression
       */
      const expressionProcess = cp.spawn(value, {
        cwd,
        env: { ...process.env, ...stateEnv },
        shell: true,
      })
      const [isError, data] = await new Promise<[number, string]>((resolve) => {
        let data = ''
        expressionProcess.stdout.on('data', (payload) => {
          data += payload.toString()
        })
        expressionProcess.stderr.on('data', (payload) => {
          data += payload.toString()
        })
        expressionProcess.on('close', (code) => {
          data = data.trim()
          if (code && code > 0) {
            return resolve([code, data])
          }

          return resolve([0, data])
        })
      })

      if (isError) {
        window.showErrorMessage(`Failed to evaluate expression "${value}": ${data}`)
        return undefined
      }

      stateEnv[key] = data
    } else if (type === 'prompt') {
      /**
       * ask user for value only if placeholder has no new line as this would be absorbed by
       * VS Code, see https://github.com/microsoft/vscode/issues/98098
       */
      stateEnv[key] = populateEnvVar(
        (await promptUserForVariable(key, value, hasStringValue, false)) ?? '',
        { ...process.env, ...stateEnv },
      )
    } else {
      stateEnv[key] = populateEnvVar(value)
    }

    /**
     * we don't want to run these exports anymore as we already stored
     * them in our extension state
     */
    cellText = cellText.replace(match, '')

    /**
     * persist env variable in memory
     */
    ENV_STORE.set(key, stateEnv[key])
  }
  return cellText
}
