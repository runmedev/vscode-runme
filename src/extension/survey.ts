import path from 'node:path'
import { mkdirSync, readFileSync, unlinkSync } from 'node:fs'

import vscode from 'vscode'
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

import { FeatureName } from '../types'

import * as features from './features'
import { Kernel } from './kernel'
import { getNamespacedMid, isWindows } from './utils'
import getLogger from './logger'
import { RecommendedExtension } from './recommendation'

const log = getLogger('WinDefaultShell')

abstract class Survey implements Disposable {
  private readonly id: string
  protected readonly tempDir: Uri
  protected readonly context: ExtensionContext
  protected readonly disposables: Disposable[] = []

  constructor(context: ExtensionContext, id: string) {
    this.id = id
    this.tempDir = context.globalStorageUri
    this.context = context
  }

  open() {
    commands.executeCommand(this.id)
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose())
  }

  protected async undo() {
    await this.context.globalState.update(this.id, false)
  }

  protected async done() {
    await this.context.globalState.update(this.id, true)
  }

  abstract prompt(runDirect: boolean): Promise<void>
}

export class WinDefaultShell extends Survey {
  static readonly #id: string = 'runme.surveyWinDefaultShell'

  constructor(context: ExtensionContext) {
    super(context, WinDefaultShell.#id)
    commands.registerCommand(WinDefaultShell.#id, this.prompt.bind(this))

    // Only prompt on Windows
    if (!isWindows()) {
      return
    }

    this.disposables.push(workspace.onDidOpenNotebookDocument(this.#handleOpenNotebook.bind(this)))
  }

  async #handleOpenNotebook({ notebookType }: NotebookDocument) {
    if (
      notebookType !== Kernel.type ||
      this.context.globalState.get<boolean>(WinDefaultShell.#id, false)
    ) {
      return
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 2000))
    await commands.executeCommand(WinDefaultShell.#id, false)
  }

  async prompt(runDirect = true) {
    // reset done when run from command palette
    if (runDirect) {
      await this.undo()
    }

    const option = await window.showInformationMessage(
      'Please help us improve Runme on Windows: Click OK to share what default shell you are using.',
      'OK',
      "Don't ask again",
      'Dismiss',
    )
    if (option === 'Dismiss' || option === undefined) {
      return
    } else if (option !== 'OK') {
      await this.done()
      return
    }

    mkdirSync(this.tempDir.fsPath, { recursive: true })

    const name = 'Runme Windows Shell'
    const tmpfile = path.join(this.tempDir.fsPath, 'defaultShell')
    try {
      unlinkSync(tmpfile)
    } catch (err) {
      if (err instanceof Error) {
        log.error(`Failed to remove temporary default shell: ${err.message}`)
      }
    }
    // eslint-disable-next-line max-len
    const cmdline = `echo $SHELL > "${tmpfile}"; echo $PSVersionTable | Out-File -Encoding utf8 "${tmpfile}"`
    const taskExecution = new Task(
      { type: 'shell', name },
      TaskScope.Workspace,
      name,
      'exec',
      new ShellExecution(cmdline),
    )

    taskExecution.isBackground = true
    taskExecution.presentationOptions = {
      focus: false,
      reveal: TaskRevealKind.Never,
      panel: TaskPanelKind.Dedicated,
    }

    const exitCode = await new Promise<number>((resolve) => {
      tasks.executeTask(taskExecution).then((execution) => {
        this.disposables.push(
          tasks.onDidEndTaskProcess((e) => {
            const taskId = (e.execution as any)['_id']
            const executionId = (execution as any)['_id']

            if (taskId !== executionId || typeof e.exitCode === 'undefined') {
              return
            }

            // non-zero exit code does not mean failure
            resolve(e.exitCode)
          }),
        )
      })
    })

    try {
      const output = readFileSync(tmpfile, { encoding: 'utf-8' }).trim()
      TelemetryReporter.sendTelemetryEvent('survey.WinDefaultShell', {
        output,
        exitCode: exitCode.toString(),
      })
      await this.done()
      unlinkSync(tmpfile)
    } catch (err) {
      if (err instanceof Error) {
        log.error(`Failed to remove temporary default shell: ${err.message}`)
      }
    }
  }
}

export class SurveyWinCodeLensRun implements Disposable {
  static readonly #id: string = 'runme.surveyWinCodeLensRun'

  constructor(protected context: ExtensionContext) {}

  shouldPrompt() {
    return isWindows()
  }

  async prompt(): Promise<void> {
    if (
      this.context.globalState.get<boolean>(SurveyWinCodeLensRun.#id, false) ||
      !this.shouldPrompt()
    ) {
      return
    }

    const option = await window.showInformationMessage(
      // eslint-disable-next-line max-len
      'Support for running scripts directly from markdown is currently not supported on Windows.\nPlease help us improve Runme on Windows: Click OK to share your interest in this feature.',
      'OK',
      "Don't ask again",
      'Dismiss',
    )

    switch (option) {
      case 'OK':
        {
          TelemetryReporter.sendTelemetryEvent('survey.WinCodeLensRun', {})
        }
        break

      case 'Dismiss': {
        return
      }
    }

    await this.#done()
  }

  async #done() {
    await this.context.globalState.update(SurveyWinCodeLensRun.#id, true)
  }

  dispose() {}
}

export class SurveyActiveUserFeedback extends Survey {
  static readonly #id: string = 'runme.surveyActiveUserFeedback'
  readonly #mid: string
  #displayed: boolean = false

  constructor(protected context: ExtensionContext) {
    super(context, SurveyActiveUserFeedback.#id)
    this.#mid = getNamespacedMid(SurveyActiveUserFeedback.#id)

    commands.registerCommand(SurveyActiveUserFeedback.#id, this.prompt.bind(this))

    this.disposables.push(workspace.onDidOpenNotebookDocument(this.#handleOpenNotebook.bind(this)))
  }

  async #handleOpenNotebook({ notebookType }: NotebookDocument) {
    if (
      notebookType !== Kernel.type ||
      this.context.globalState.get<boolean>(SurveyActiveUserFeedback.#id, false) ||
      // display only once per session
      this.#displayed
    ) {
      return
    }

    try {
      const response = await fetch(
        `https://runme.dev/api/survey?name=feedback&mid=${vscode.env.machineId}`,
      )
      if (response.status === 404) {
        // no match, try again next session
        this.#displayed = true
        return
      } else if (response.status !== 200) {
        throw new Error(`http status ${response.status}: ${response.statusText}`)
      }
    } catch (err) {
      this.#displayed = true // try again next session
      if (err instanceof Error) {
        log.error(`Failed to fetch survey route: ${err.message}`)
      }
      return
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 2000))
    await commands.executeCommand(SurveyActiveUserFeedback.#id, false)
  }

  async prompt(runDirect = true) {
    // reset done when run from command palette
    if (runDirect) {
      this.#displayed = false
      await this.undo()
    }

    const option = await window.showInformationMessage(
      "We'd love to hear how we can improve Runme for you. Please click OK to open the feedback form. Takes <1min.",
      'OK',
      "Don't ask again",
      'Dismiss',
    )
    this.#displayed = true
    if (option === 'Dismiss' || option === undefined) {
      return
    } else if (option !== 'OK') {
      TelemetryReporter.sendTelemetryEvent('survey.ActiveUserFeedback', { never: 'true' })
      await this.done()
      return
    }

    TelemetryReporter.sendTelemetryEvent('survey.ActiveUserFeedback', { never: 'false' })
    await commands.executeCommand(
      'vscode.open',
      Uri.parse(`https://wfoq097ak2p.typeform.com/runme#mid=${this.#mid}`),
    )
    await this.done()
  }
}

export class SurveyShebangComingSoon extends Survey {
  static readonly #id: string = 'runme.surveyShebangComingSoon'

  constructor(protected context: ExtensionContext) {
    super(context, SurveyShebangComingSoon.#id)

    commands.registerCommand(SurveyShebangComingSoon.#id, this.prompt.bind(this))
  }

  async prompt(): Promise<void> {
    const option = await window.showWarningMessage(
      'Not every language is executable... yet! Coming soon: Mix and match languages in Runme.',
      'Learn more',
      'Dismiss',
    )
    if (option === 'Dismiss' || option === undefined) {
      return
    }

    TelemetryReporter.sendTelemetryEvent('survey.ShebangComingSoon', { never: 'false' })
    await commands.executeCommand(
      'vscode.open',
      Uri.parse('https://runme.dev/spotlight/shebang-support'),
    )
  }
}

export class SurveyFeedbackButton extends Survey {
  static readonly #id: string = 'runme.surveyFeedbackButton'
  readonly #mid: string

  constructor(protected context: ExtensionContext) {
    super(context, SurveyFeedbackButton.#id)
    this.#mid = getNamespacedMid(SurveyFeedbackButton.#id)

    commands.registerCommand(SurveyFeedbackButton.#id, this.prompt.bind(this))
  }

  async prompt(): Promise<void> {
    TelemetryReporter.sendTelemetryEvent('survey.FeedbackButton', { never: 'false' })
    return commands.executeCommand(
      'vscode.open',
      Uri.parse(
        'https://docs.google.com/forms/d/e/1FAIpQLScYDkaZJeqJg6dFoEopapzOVv8Dt76EXR4AJH2MYCOqyHbghg/viewform?usp=dialog',
      ),
    )
  }
}

export class SurveyNotifyV2 extends Survey {
  static readonly #id: string = 'runme.surveyNotifyV2'

  private prompted = false

  constructor(protected context: ExtensionContext) {
    super(context, SurveyNotifyV2.#id)
    this.disposables.push(
      // decommission auto-open for now
      // workspace.onDidOpenNotebookDocument(this.#handleOpenNotebook.bind(this)),
      commands.registerCommand(SurveyNotifyV2.#id, this.prompt.bind(this)),
    )
  }

  shouldPrompt() {
    return !this.prompted
  }

  async #handleOpenNotebook({ notebookType }: NotebookDocument) {
    if (
      notebookType !== Kernel.type ||
      this.context.globalState.get<boolean>(SurveyNotifyV2.#id, false)
    ) {
      return
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 2000))
    await commands.executeCommand(SurveyNotifyV2.#id, false)
  }

  async prompt(runDirect = true) {
    if (runDirect) {
      this.prompted = false
      await this.undo()
    }

    if (this.context.globalState.get<boolean>(SurveyNotifyV2.#id, false) || !this.shouldPrompt()) {
      return
    }

    this.prompted = true
    const option = await window.showInformationMessage(
      // eslint-disable-next-line max-len
      "Find out what's changing in Runme v2.0 and learn more about its powerful shebang support which executes non-shell languages in your notebooks.",
      'Learn more',
      "Don't show again",
    )

    switch (option) {
      case undefined: {
        return
      }
      case 'Learn more':
        {
          TelemetryReporter.sendTelemetryEvent('survey.NotifyV2', {})
          commands.executeCommand('vscode.open', Uri.parse('https://runme.dev/redirect/notifyV2'))
        }
        break
    }

    await this.#done()
  }

  async #done() {
    await this.context.globalState.update(SurveyNotifyV2.#id, true)
  }

  dispose() {}
}

export class SurveyAddExtensionToRepo extends Survey {
  static readonly #id: string = 'runme.surveyAddExtensionToRepo'
  readonly #recommender: RecommendedExtension

  #displayed: boolean = false
  #repoKey: string | undefined

  constructor(protected context: ExtensionContext) {
    super(context, SurveyAddExtensionToRepo.#id)
    this.#recommender = new RecommendedExtension(context)

    const folders = workspace.workspaceFolders?.length ?? 0
    if (folders === 0 || folders > 1) {
      this.#displayed = true
    }

    if (workspace.workspaceFolders?.[0]) {
      const folderUri = workspace.workspaceFolders[0].uri
      this.#repoKey = `${SurveyAddExtensionToRepo.#id}-${folderUri.toString()}`
    }

    commands.registerCommand(SurveyAddExtensionToRepo.#id, this.prompt.bind(this))

    this.disposables.push(workspace.onDidOpenNotebookDocument(this.#handleOpenNotebook.bind(this)))
  }

  async #seenRepoBefore(): Promise<boolean> {
    const recommended = await this.#recommender.isRecommended()
    if (!this.#repoKey || recommended) {
      return true
    }

    return this.context.globalState.get<boolean>(this.#repoKey, false)
  }

  async #markRepoSeen(): Promise<boolean> {
    if (!this.#repoKey) {
      return false
    }

    await this.context.globalState.update(this.#repoKey, true)
    return true
  }

  async #markRepoUnseen(): Promise<boolean> {
    if (!this.#repoKey) {
      return false
    }

    await this.context.globalState.update(this.#repoKey, false)
    return true
  }

  async #handleOpenNotebook({ notebookType }: NotebookDocument) {
    const featureOn = features.isOnInContextState(FeatureName.RecommendExtension)
    const seenRepoBefore = await this.#seenRepoBefore()
    if (
      notebookType !== Kernel.type ||
      !featureOn ||
      seenRepoBefore ||
      this.context.globalState.get<boolean>(SurveyAddExtensionToRepo.#id, false) ||
      // display only once per session
      this.#displayed
    ) {
      return
    }

    try {
      const response = await fetch(
        `https://runme.dev/api/survey?name=recommend&mid=${vscode.env.machineId}`,
      )
      if (response.status === 404) {
        // no match, try again next session
        this.#displayed = true
        return
      } else if (response.status !== 200) {
        throw new Error(`http status ${response.status}: ${response.statusText}`)
      }
    } catch (err) {
      this.#displayed = true // try again next session
      if (err instanceof Error) {
        log.error(`Failed to fetch survey route: ${err.message}`)
      }
      return
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 2000))
    await commands.executeCommand(SurveyAddExtensionToRepo.#id, false)
  }

  async prompt(runDirect = true) {
    // reset done when run from command palette
    if (runDirect) {
      this.#displayed = false
      await this.#markRepoUnseen()
      await this.undo()
    }

    const option = await window.showInformationMessage(
      "Would you like to add Runme to your repository's recommended extensions?",
      'Yes',
      'No',
      "Don't ask again",
    )
    this.#displayed = true
    if (option === 'No') {
      await this.#markRepoSeen()
      return
    } else if (option === undefined) {
      return
    } else if (option === "Don't ask again") {
      await this.done()
      return
    }

    await commands.executeCommand('runme.addToRecommendedExtensions')
    await this.#markRepoSeen()
  }
}
