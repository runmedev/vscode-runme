import cp from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

import { NotebookCellOutput, NotebookCellExecution, NotebookCellOutputItem, window } from 'vscode'

import { ENV_STORE } from '../constants'
import { OutputType } from '../../constants'
import type { CellOutputPayload } from '../../types'
import { replaceOutput, getCmdSeq } from '../utils'

const ENV_VAR_REGEXP = /(\$\w+)/g
/**
 * for understanding post into https://jex.im/regulex/
 */
const EXPORT_EXTRACT_REGEX = /(\n*)export \w+=(("[^"]*")|('[^']*')|(.+(?=(\n|;))))/gim

export function renderError (exec: NotebookCellExecution, output: string) {
  return replaceOutput(exec, new NotebookCellOutput([
    NotebookCellOutputItem.json(
      <CellOutputPayload<OutputType.error>>{
        type: OutputType.error,
        output
      },
      OutputType.error
    )
  ]))
}

export function populateEnvVar (value: string, env = process.env) {
  for (const m of value.match(ENV_VAR_REGEXP) || []) {
    const envVar = m.slice(1) // slice out '$'
    value = value.replace(m, env[envVar] || '')
  }

  return value
}

export interface CommandExportExtractMatch {
  type: 'exec'|'prompt'|'direct'
  key: string
  value: string
  match: string
  regexpMatch: RegExpExecArray
  hasStringValue: boolean
}

export async function promptUserForVariable(
  key: string,
  placeHolder: string,
  hasStringValue: boolean,
): Promise<string | undefined> {
  return await window.showInputBox({
    title: `Set Environment Variable "${key}"`,
    ignoreFocusOut: true,
    placeHolder,
    prompt: 'Your shell script wants to set some environment variables, please enter them here.',
    ...(hasStringValue ? { value: placeHolder } : {})
  })
}

export function getCommandExportExtractMatches(
  rawText: string
): CommandExportExtractMatch[] {
  const test = new RegExp(EXPORT_EXTRACT_REGEX)

  const matchStr = (rawText.endsWith('\n') ? rawText : `${rawText}\n`)

  let match: RegExpExecArray | null

  const result: CommandExportExtractMatch[] = []

  while ((match = test.exec(matchStr)) !== null) {
    const e = match[0]

    const [key, ph] = e.trim().slice('export '.length).split('=')
    const hasStringValue = ph.startsWith('"') || ph.startsWith('\'')
    const placeHolder = hasStringValue ? ph.slice(1, -1) : ph

    let matchType: CommandExportExtractMatch['type']
    let value = placeHolder

    if (placeHolder.startsWith('$(') && placeHolder.endsWith(')')) {
      matchType = 'exec'
      value = placeHolder.slice(2, -1)
    } else if (!placeHolder.includes('\n')) {
      matchType = 'prompt'
    } else {
      matchType = 'direct'
    }

    result.push({
      type: matchType,
      regexpMatch: match,
      key, value, match: e, hasStringValue,
    })
  }

  return result
}

/**
 * Helper method to parse the shell code and runs the following operations:
 *   - fetches environment variable exports and puts them into ENV_STORE
 *   - runs embedded shell scripts for exports, e.g. `exports=$(echo "foobar")`
 *
 * @param exec NotebookCellExecution
 * @returns cell text if all operation to retrieve the cell text could be executed, undefined otherwise
 */
export async function retrieveShellCommand (exec: NotebookCellExecution) {
  let cellText = exec.cell.document.getText()
  const cwd = path.dirname(exec.cell.document.uri.fsPath)
  const rawText = exec.cell.document.getText()

  const exportMatches = getCommandExportExtractMatches(rawText)

  const stateEnv = Object.fromEntries(ENV_STORE)

  for (const { hasStringValue, key, match, type, value } of exportMatches) {
    if (type === 'exec') {
      /**
       * evaluate expression
       */
      const expressionProcess = cp.spawn(value, {
        cwd,
        env: {...process.env, ...stateEnv },
        shell: true
      })
      const [isError, data] = await new Promise<[number, string]>((resolve) => {
        let data = ''
        expressionProcess.stdout.on('data', (payload) => { data += payload.toString() })
        expressionProcess.stderr.on('data', (payload) => { data += payload.toString() })
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
        await promptUserForVariable(key, value, hasStringValue) ?? '',
        {...process.env, ...stateEnv }
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

/**
 * Try to get shell path from environment (`$SHELL`)
 *
 * @param execKey Used as fallback in case `$SHELL` is not present
 */
export function getShellPath(): string|undefined
export function getShellPath(execKey: 'bash'|'sh'): string
export function getShellPath(execKey?: string): string|undefined {
  return process.env.SHELL ?? execKey
}

/**
 * Parse set of commands, requiring user input for prompted environment
 * variables, and supporting multiline strings
 *
 * Returns `undefined` when a user cancels on prompt
 */
export async function parseCommandSeq(
  cellText: string
): Promise<string[]|undefined> {
  const exportMatches = getCommandExportExtractMatches(cellText)

  type CommandBlock =
    |{
      type: 'block'
      content: string
    }
    |{
      type: 'single'
      content: string
    }

  const parsedCommandBlocks: CommandBlock[] = []

  let offset = 0

  for (const { hasStringValue, key, match, type, value, regexpMatch } of exportMatches) {
    let userValue: string

    switch(type) {
      case 'prompt': {
        const userInput = await promptUserForVariable(key, value, hasStringValue)

        if(userInput === undefined) {
          return undefined
        }

        userValue = userInput
      } break

      case 'direct': {
        userValue = value
      } break

      default: {
        continue
      }
    }

    const prior = cellText.slice(offset, regexpMatch.index)
    parsedCommandBlocks.push({ type: 'block', content: prior })

    parsedCommandBlocks.push({ type: 'single', content: `export ${key}="${userValue}"` })

    offset = regexpMatch.index + match.length
  }

  parsedCommandBlocks.push({ type: 'block', content: cellText.slice(offset) })

  return parsedCommandBlocks
    .flatMap(({ type, content }) => type === 'block' ? getCmdSeq(content) : [content])
}

export function isWindows(): boolean {
  return os.platform().startsWith('win')
}
