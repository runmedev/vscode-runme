import {
  NotebookCellOutputItem,
  NotebookCellOutput,
  Task,
  TaskScope,
  CustomExecution,
  TaskRevealKind,
  TaskPanelKind,
  tasks,
  TextDocument,
} from 'vscode'
import { Subject, debounceTime } from 'rxjs'

import getLogger from '../logger'
import { ClientMessages } from '../../constants'
import { ClientMessage } from '../../types'
import { PLATFORM_OS } from '../constants'
import { IRunner, IRunnerProgramSession, RunProgramExecution } from '../runner'
import { IRunnerEnvironment } from '../runner/environment'
import { getAnnotations, getCellRunmeId, getTerminalByCell, getWorkspaceEnvs } from '../utils'
import { postClientMessage } from '../../utils/messaging'
import { isNotebookTerminalEnabledForCell } from '../../utils/configuration'
import { ITerminalState } from '../terminal/terminalState'
import { toggleTerminal } from '../commands'
import { CommandMode } from '../grpc/runnerTypes'

import { closeTerminalByEnvID } from './task'
import {
  parseCommandSeq,
  getCellCwd,
  getCellProgram,
  getNotebookSkipPromptEnvSetting,
  getCmdShellSeq,
} from './utils'
import { handleVercelDeployOutput, isVercelDeployScript } from './vercel'

import type { IKernelExecutorOptions } from '.'

const log = getLogger('executeRunner')
const LABEL_LIMIT = 15
const BACKGROUND_TASK_HIDE_TIMEOUT = 2000
const MIME_TYPES_WITH_CUSTOM_RENDERERS = ['text/plain']

interface IKernelRunnerOptions extends IKernelExecutorOptions {
  runner: IRunner
  runningCell: TextDocument
  cellId: string
  execKey: string
  runnerEnv?: IRunnerEnvironment
}

type IKernelRunner = (executor: IKernelRunnerOptions) => Promise<boolean>

export const executeRunner: IKernelRunner = async ({
  kernel,
  context,
  runner,
  exec,
  runningCell,
  messaging,
  cellId,
  execKey,
  outputs,
  runnerEnv,
  envMgr,
}: IKernelRunnerOptions) => {
  const annotations = getAnnotations(exec.cell)
  const { interactive, mimeType, background, closeTerminalOnSuccess, promptEnv } = annotations
  // Document level settings
  const skipPromptEnvDocumentLevel = getNotebookSkipPromptEnvSetting(exec.cell.notebook)
  // enforce background tasks as singleton instanes
  // to do this,
  if (background) {
    const terminal = getTerminalByCell(exec.cell)

    if (terminal && terminal.runnerSession) {
      if (!terminal.runnerSession.hasExited()) {
        await toggleTerminal(kernel, true, true)(exec.cell)
        return true
      } else {
        terminal.dispose()
      }
    }
  }

  const { programName, commandMode } = getCellProgram(exec.cell, exec.cell.notebook, execKey)

  const RUNME_ID = getCellRunmeId(exec.cell)
  const envs: Record<string, string> = {
    RUNME_ID,
    ...(await getWorkspaceEnvs(runningCell.uri)),
  }

  const cellText = exec.cell.document.getText()

  const promptForEnv = skipPromptEnvDocumentLevel === false ? promptEnv : false
  const envKeys = new Set([...(runnerEnv?.initialEnvs() ?? []), ...Object.keys(envs)])

  let execution: RunProgramExecution
  try {
    execution = await resolveRunProgramExecution(
      cellText,
      execKey, // same as languageId
      commandMode,
      promptForEnv,
      envKeys,
    )
  } catch (err) {
    if (err instanceof Error) {
      log.error(err.message)
    }
    return false
  }

  const cwd = await getCellCwd(exec.cell, exec.cell.notebook, runningCell.uri)
  const program = await runner.createProgramSession({
    background,
    commandMode,
    convertEol: !mimeType || mimeType === 'text/plain',
    cwd,
    runnerEnv,
    envs: Object.entries(envs).map(([k, v]) => `${k}=${v}`),
    exec: execution!,
    languageId: exec.cell.document.languageId,
    programName,
    storeLastOutput: true,
    tty: interactive,
  })

  context.subscriptions.push(program)

  let terminalState: ITerminalState | undefined

  const writeToTerminalStdout = (data: string | Uint8Array) => {
    postClientMessage(messaging, ClientMessages.terminalStdout, {
      'runme.dev/id': cellId,
      data,
    })

    terminalState?.write(data)
  }

  program.onDidErr((data) =>
    postClientMessage(messaging, ClientMessages.terminalStderr, {
      'runme.dev/id': cellId,
      data,
    }),
  )

  messaging.onDidReceiveMessage(({ message }: { message: ClientMessage<ClientMessages> }) => {
    const { type, output } = message

    if (typeof output === 'object' && 'runme.dev/id' in output) {
      const id = output['runme.dev/id']
      if (id !== cellId) {
        return
      }
    }

    switch (type) {
      case ClientMessages.terminalStdin:
        {
          const { input } = output

          program.handleInput(input)
          terminalState?.input(input, true)
        }
        break

      case ClientMessages.terminalFocus:
        {
          program.setActiveTerminalWindow('notebook')
        }
        break

      case ClientMessages.terminalResize:
        {
          const { terminalDimensions } = output
          program.setDimensions(terminalDimensions, 'notebook')
        }
        break

      case ClientMessages.terminalOpen:
        {
          const { terminalDimensions } = output
          program.open(terminalDimensions, 'notebook')
        }
        break
    }
  })

  program.onDidClose((code) => {
    postClientMessage(messaging, ClientMessages.onProgramClose, {
      'runme.dev/id': cellId,
    })
    if (!background) {
      return
    }

    const parts = ['Program exited']

    if (code !== undefined) {
      parts.push(`with code ${code}`)
    }

    const text = parts.join(' ') + '.'

    writeToTerminalStdout(`\x1B[7m * \x1B[0m ${text}`)
  })

  if (interactive) {
    program.registerTerminalWindow('vscode')
    await program.setActiveTerminalWindow('vscode')
  }

  let revealNotebookTerminal = isNotebookTerminalEnabledForCell(exec.cell)

  const mime = mimeType || ('text/plain' as const)

  terminalState = await kernel.registerCellTerminalState(
    exec.cell,
    revealNotebookTerminal ? 'xterm' : 'local',
  )

  const scriptVercel = getCmdShellSeq(cellText, PLATFORM_OS)
  if (MIME_TYPES_WITH_CUSTOM_RENDERERS.includes(mime) && !isVercelDeployScript(scriptVercel)) {
    if (revealNotebookTerminal) {
      program.registerTerminalWindow('notebook')
      await program.setActiveTerminalWindow('notebook')
    }

    program.onDidWrite(writeToTerminalStdout)

    await outputs.showTerminal()
  } else {
    const output: Buffer[] = []
    const outputItems$ = new Subject<NotebookCellOutputItem>()

    // adapted from `shellExecutor` in `shell.ts`
    const _handleOutput = async (data: Uint8Array) => {
      output.push(Buffer.from(data))

      let item: NotebookCellOutputItem | undefined = new NotebookCellOutputItem(
        Buffer.concat(output),
        mime,
      )

      // hacky for now, maybe inheritence is a fitting pattern
      const isVercelProd = process.env['vercelProd'] === 'true'
      if (isVercelDeployScript(scriptVercel)) {
        await handleVercelDeployOutput(
          exec.cell,
          outputs,
          output,
          exec.cell.index,
          isVercelProd,
          envMgr,
        )

        item = undefined
      } else if (MIME_TYPES_WITH_CUSTOM_RENDERERS.includes(mime)) {
        await outputs.showTerminal()
        item = undefined
      }

      if (item) {
        outputItems$.next(item)
      }
    }

    // debounce by 0.5s because human preception likely isn't as fast
    const sub = outputItems$
      .pipe(debounceTime(500))
      .subscribe((item) => outputs.replaceOutputs([new NotebookCellOutput([item])]))

    context.subscriptions.push({ dispose: () => sub.unsubscribe() })

    program.onStdoutRaw(_handleOutput)
    program.onStderrRaw(_handleOutput)
    program.onDidClose(() => outputItems$.complete())
  }

  if (!interactive) {
    exec.token.onCancellationRequested(() => {
      program.close()
    })
  } else {
    await outputs.replaceOutputs([])

    const taskExecution = new Task(
      { type: 'shell', name: `Runme Task (${RUNME_ID})` },
      TaskScope.Workspace,
      (cellText.length > LABEL_LIMIT ? `${cellText.slice(0, LABEL_LIMIT)}...` : cellText) +
        ` (RUNME_ID: ${RUNME_ID})`,
      'exec',
      new CustomExecution(async () => program),
    )

    taskExecution.isBackground = background
    taskExecution.presentationOptions = {
      focus: revealNotebookTerminal ? false : true,
      reveal: revealNotebookTerminal
        ? TaskRevealKind.Never
        : background
          ? TaskRevealKind.Never
          : TaskRevealKind.Always,
      panel: background ? TaskPanelKind.Dedicated : TaskPanelKind.Shared,
    }

    const execution = await tasks.executeTask(taskExecution)

    context.subscriptions.push({
      dispose: () => execution.terminate(),
    })

    exec.token.onCancellationRequested(() => {
      try {
        // runs `program.close()` implicitly
        execution.terminate()
      } catch (err: any) {
        log.error(`Failed to terminate task: ${(err as Error).message}`)
        throw new Error(err)
      }
    })

    tasks.onDidStartTaskProcess((e) => {
      const taskId = (e.execution as any)['_id']
      const executionId = (execution as any)['_id']

      if (taskId !== executionId) {
        return
      }

      const terminal = getTerminalByCell(exec.cell)
      if (!terminal) {
        return
      }

      terminal.runnerSession = program
      kernel.registerTerminal(terminal, executionId, RUNME_ID)

      // proxy pid value
      Object.defineProperty(terminal, 'processId', {
        get: function () {
          return program.pid
        },
      })
    })

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
        typeof e.exitCode === 'undefined'
      ) {
        return
      }

      /**
       * only close terminal if execution passed and desired by user
       */
      if (e.exitCode === 0 && closeTerminalOnSuccess && !background) {
        closeTerminalByEnvID(RUNME_ID)
      }
    })
  }

  if (program.numTerminalWindows === 0) {
    await program.run()
  }

  return await new Promise<boolean>(async (resolve, reject) => {
    const terminalState = outputs.getCellTerminalState()
    program.onDidClose(async (code) => {
      const pid = await program.pid
      updateProcessInfo(program, terminalState, pid)
      resolve(code === 0)
    })

    program.onInternalErr((e) => {
      const pid = undefined
      updateProcessInfo(program, terminalState, pid)
      reject(e)
    })

    const exitReason = program.hasExited()

    // unexpected early return, likely an error
    if (exitReason) {
      const pid = undefined
      updateProcessInfo(program, terminalState, pid)
      switch (exitReason.type) {
        case 'error':
          {
            reject(exitReason.error)
          }
          break

        case 'exit':
          {
            resolve(exitReason.code === 0)
          }
          break

        default: {
          resolve(false)
        }
      }
    }

    if (background && interactive) {
      setTimeout(() => {
        resolve(true)
      }, BACKGROUND_TASK_HIDE_TIMEOUT)
    }
  })
}

/**
 * Prompts for vars that are exported as necessary
 */
export async function resolveRunProgramExecution(
  script: string,
  languageId: string,
  commandMode: CommandMode,
  promptForEnv: boolean,
  skipEnvs?: Set<string>,
): Promise<RunProgramExecution> {
  const isVercel = isVercelDeployScript(script)

  if (isVercel) {
    const scriptVercel = getCmdShellSeq(script, PLATFORM_OS)
    const isVercelProd = process.env['vercelProd'] === 'true'
    const parts = [scriptVercel]
    if (isVercelProd) {
      parts.push('--prod')
    }

    const commands = [parts.join(' ')]

    return {
      type: 'commands',
      commands,
    }
  }

  if (commandMode === CommandMode.INLINE_SHELL) {
    const commands = await parseCommandSeq(script, languageId, promptForEnv, skipEnvs)

    if (!commands) {
      throw new Error('Cannot run cell due to canceled prompt')
    }

    if (commands.length === 0) {
      commands.push('')
    }

    return {
      type: 'commands',
      commands,
    }
  }

  return {
    type: 'script',
    script,
  }
}

function updateProcessInfo(
  program: IRunnerProgramSession,
  terminalState: ITerminalState | undefined,
  pid: number | undefined,
) {
  const exitReason = program.hasExited()
  if (!terminalState || !exitReason) {
    return
  }

  terminalState.setProcessInfo({
    exitReason,
    pid,
  })
}
