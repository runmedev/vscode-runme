import path from 'node:path'
import { mkdirSync, readFileSync, unlinkSync } from 'node:fs'

import {
  Disposable,
  NotebookDocument,
  workspace,
  window,
  ExtensionContext,
  Task,
  TaskScope,
  ShellExecution,
  TaskRevealKind,
  TaskPanelKind,
  tasks,
  Uri,
  commands,
} from 'vscode'
import { TelemetryReporter } from 'vscode-telemetry'

import { Kernel } from './kernel'
import { isWindows } from './utils'

export class WinDefaultShell implements Disposable {
  static readonly #id: string = 'runme.surveyWinDefaultShell'
  readonly #tempDir: Uri
  readonly #context: ExtensionContext
  readonly #disposables: Disposable[] = []

  constructor(context: ExtensionContext) {
    commands.registerCommand(WinDefaultShell.#id, this.#prompt.bind(this))

    this.#tempDir = context.globalStorageUri
    this.#context = context

    // Only prompt on Windows
    if (!isWindows()) {
      return
    }

    this.#disposables.push(
      workspace.onDidOpenNotebookDocument(this.#handleOpenNotebook.bind(this))
    )
  }

  async #handleOpenNotebook({ notebookType }: NotebookDocument) {
    if (
      notebookType !== Kernel.type ||
      this.#context.globalState.get<boolean>(
        WinDefaultShell.#id,
        false
      )
    ) {
      return
    }

    await new Promise<void>(resolve => setTimeout(resolve, 2000))
    await commands.executeCommand(WinDefaultShell.#id, false)
  }

  async #prompt(runDirect = true) {
    // reset done when run from command palette
    if (runDirect) {
      await this.#undo()
    }

    const option = await window.showInformationMessage(
      'Please help us improve Runme on Windows: Click OK to share what default shell you are using.',
      'OK',
      'Don\'t ask again',
      'Dismiss'
    )
    if (option === 'Dismiss') {
      return
    } else if (option !== 'OK') {
      await this.#done()
      return
    }

    mkdirSync(this.#tempDir.fsPath, { recursive: true })

    const name = 'Runme Windows Shell'
    const tmpfile = path.join(this.#tempDir.fsPath, 'defaultShell')
    try {
      unlinkSync(tmpfile)
    } catch (err) {
      if (err instanceof Error) {
        console.log(err.message)
      }
    }
    // eslint-disable-next-line max-len
    const cmdline = `echo $SHELL > "${tmpfile}"; echo $PSVersionTable | Out-File -Encoding utf8 "${tmpfile}"`
    const taskExecution = new Task(
      { type: 'shell', name },
      TaskScope.Workspace,
      name,
      'exec',
      new ShellExecution(cmdline)
    )

    taskExecution.isBackground = true
    taskExecution.presentationOptions = {
      focus: false,
      reveal: TaskRevealKind.Never,
      panel: TaskPanelKind.Dedicated
    }

    const exitCode = await new Promise<number>((resolve) => {
      tasks.executeTask(taskExecution).then((execution) => {
        this.#disposables.push(tasks.onDidEndTaskProcess((e) => {
          const taskId = (e.execution as any)['_id']
          const executionId = (execution as any)['_id']

          if (
            taskId !== executionId ||
            typeof e.exitCode === 'undefined'
          ) {
            return
          }

          // non-zero exit code does not mean failure
          resolve(e.exitCode)
        }))
      })
    })

    try {
      const output = readFileSync(tmpfile, { encoding: 'utf-8' }).trim()
      TelemetryReporter.sendTelemetryEvent('survey.WinDefaultShell', { output, exitCode: exitCode.toString() })
      await this.#done()
      unlinkSync(tmpfile)
    } catch (err) {
      if (err instanceof Error) {
        console.log(err.message)
      }
    }
  }

  async #undo() {
    await this.#context.globalState.update(WinDefaultShell.#id, false)
  }

  async #done() {
    await this.#context.globalState.update(WinDefaultShell.#id, true)
  }

  dispose() {
    this.#disposables.forEach(d => d.dispose())
  }
}
