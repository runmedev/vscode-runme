import path from 'node:path'

import {
  Task, TextDocument, NotebookCellExecution, TaskScope, tasks,
  window, TerminalOptions, TaskRevealKind, TaskPanelKind,
  // CustomExecution,
  // Pseudoterminal,
  ShellExecution
} from 'vscode'

// import { ExperimentalTerminal } from "../terminal"
import { populateEnvVar, getExecutionProperty, getCmdShellSeq, } from '../utils'
import { ENV_STORE, PLATFORM_OS } from '../constants'
import type { Kernel } from '../kernel'

import { sh as inlineSh } from './shell'

const BACKGROUND_TASK_HIDE_TIMEOUT = 2000
const LABEL_LIMIT = 15
const EXPORT_REGEX = /(\n*)export \w+=("*)(.+?)(?=(\n|"))/g

export function closeTerminalByEnvID (id: string) {
  const terminal = window.terminals.find((t) => (
    t.creationOptions as TerminalOptions).env?.RUNME_ID === id)
  console.log('CLOSE IT?', !!terminal)

  if (terminal) {
    terminal.hide()
  }
}

async function taskExecutor(
  this: Kernel,
  exec: NotebookCellExecution,
  doc: TextDocument
): Promise<boolean> {
  let cellText = doc.getText()

  /**
   * find export commands
   */
  const exportMatches = (doc.getText().match(EXPORT_REGEX) || [])
    .map((m) => m.trim())
  const stateEnv = Object.fromEntries(ENV_STORE)
  for (const e of exportMatches) {
    const [key, ph] = e.slice('export '.length).split('=')
    const hasStringValue = ph.startsWith('"')
    const placeHolder = hasStringValue ? ph.slice(1) : ph
    stateEnv[key] = populateEnvVar(await window.showInputBox({
      title: `Set Environment Variable "${key}"`,
      ignoreFocusOut: true,
      placeHolder,
      prompt: 'Your shell script wants to set some environment variables, please enter them here.',
      ...(hasStringValue ? { value: placeHolder } : {})
    }) || '', {...process.env, ...stateEnv })

    /**
     * we don't want to run these exports anymore as we already stored
     * them in our extension state
     */
    cellText = cellText.replace(
      /**
       * In case of `export foo="bar", our match includes the preceeding '"' but not
       * the ending one. To properly cut out the line from the script we need to add
       * it back again.
       */
      e + (hasStringValue ? '"' : ''),
      ''
    )

    /**
     * persist env variable in memory
     */
    ENV_STORE.set(key, stateEnv[key])
  }

  const cwd = path.dirname(doc.uri.fsPath)
  const RUNME_ID = `${doc.fileName}:${exec.cell.index}`
  const env = {
    ...process.env,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    RUNME_TASK: 'true',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    RUNME_ID,
    ...stateEnv
  }

  // skip empty scripts, eg env exports
  if (cellText.trim().length === 0) {
    return Promise.resolve(true)
  }

  const cmdLine = getCmdShellSeq(cellText, PLATFORM_OS)
  /**
   * run as non interactive shell script if set as configuration or annotated
   * in markdown section
   */
  const isInteractive = getExecutionProperty('interactive', exec.cell)
  if (!isInteractive) {
    return inlineSh.call(this, exec, cmdLine, cwd, env)
  }

  const taskExecution = new Task(
    { type: 'runme', name: `Runme Task (${RUNME_ID})` },
    TaskScope.Workspace,
    cellText.length > LABEL_LIMIT
      ? `${cellText.slice(0, LABEL_LIMIT)}...`
      : cellText,
    'exec',
    new ShellExecution(cmdLine, { cwd, env })
    // experimental only
    // new CustomExecution(async (): Promise<Pseudoterminal> => {
    //   return new ExperimentalTerminal(scriptFile.fsPath, { cwd, env })
    // })
  )
  const isBackground = exec.cell.metadata.attributes?.['background'] === 'true'
  const closeTerminalOnSuccess = getExecutionProperty('closeTerminalOnSuccess', exec.cell)
  taskExecution.isBackground = isBackground
  taskExecution.presentationOptions = {
    focus: true,
    // why doesn't this work with Slient?
    reveal: isBackground ? TaskRevealKind.Never : TaskRevealKind.Always,
    panel: isBackground ? TaskPanelKind.Dedicated : TaskPanelKind.Shared
  }
  const execution = await tasks.executeTask(taskExecution)

  const p = new Promise<number>((resolve) => {
    this.context.subscriptions.push(exec.token.onCancellationRequested(() => {
      try {
        execution.terminate()
        closeTerminalByEnvID(RUNME_ID)
        resolve(0)
      } catch (err: any) {
        console.error(`[Runme] Failed to terminate task: ${(err as Error).message}`)
        resolve(1)
      }
    }))

    tasks.onDidEndTaskProcess((e) => {
      const taskId = (e.execution as any)['_id']
      const executionId = (execution as any)['_id']

      /**
       * ignore if
       */
      if (
        /**
         * VS Code is running a different task
         */
        taskId !== executionId ||
        /**
         * we don't have an exit code
         */
        typeof e.exitCode === 'undefined') {
        return
      }

      /**
       * only close terminal if execution passed and desired by user
       */
      if (e.exitCode === 0 && closeTerminalOnSuccess) {
        closeTerminalByEnvID(RUNME_ID)
      }

      return resolve(e.exitCode)
    })
  })

  if (isBackground) {
    const giveItTime = new Promise<boolean>(
      (resolve) => setTimeout(() => {
        closeTerminalByEnvID(RUNME_ID)
        return resolve(true)
      }, BACKGROUND_TASK_HIDE_TIMEOUT))

    return Promise.race([
      p.then((exitCode) => exitCode === 0),
      giveItTime,
    ])
  }

  /**
   * push task as disposable to context so that it is being closed
   * when extension terminates
   */
  this.context.subscriptions.push({
    dispose: () => execution.terminate()
  })

  return !Boolean(await p)
}

export const sh = taskExecutor
export const bash = taskExecutor
