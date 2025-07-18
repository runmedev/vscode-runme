import {
  Disposable,
  workspace,
  notebooks,
  commands,
  ExtensionContext,
  tasks,
  window,
  env,
  Uri,
  NotebookCell,
} from 'vscode'
import { TelemetryReporter } from 'vscode-telemetry'
import Channel from 'tangle/webviews'

import { NotebookUiEvent, Serializer, SyncSchema, FeatureName, EnvVarMode } from '../types'
import {
  getDocsUrlFor,
  getForceNewWindowConfig,
  getServerRunnerVersion,
  getSessionOutputs,
  getServerLifecycleIdentity,
  getServerConfigurationValue,
  ServerTransportType,
  getEnvVarMode,
} from '../utils/configuration'
import {
  AuthenticationProviders,
  NOTEBOOK_LIFECYCLE_ID,
  NOTEBOOK_PREVIEW_OUTPUTS,
  NOTEBOOK_ENV_VAR_MODE,
  TELEMETRY_EVENTS,
  WebViews,
} from '../constants'

import { Kernel } from './kernel'
import KernelServer from './server/kernelServer'
import KernelServerError from './server/kernelServerError'
import {
  ToggleTerminalProvider,
  BackgroundTaskProvider,
  StopBackgroundTaskProvider,
} from './provider/background'
import { getDefaultWorkspace, bootFile, resetNotebookSettings } from './utils'
import { RunmeTaskProvider } from './provider/runmeTask'
import {
  toggleTerminal,
  runCLICommand,
  copyCellToClipboard,
  openAsRunmeNotebook,
  openSplitViewAsMarkdownText,
  stopBackgroundTask,
  createNewRunmeNotebook,
  welcome,
  tryIt,
  openFileInRunme,
  openIntegratedTerminal,
  authenticateWithGitHub,
  displayCategoriesSelector,
  runCellsByCategory,
  addToRecommendedExtension,
  openRunmeSettings,
  toggleAutosave,
  askNewRunnerSession,
  runCellWithPrompts,
  toggleMasking,
  createGistCommand,
  toggleAuthorMode,
  createCellGistCommand,
  runForkCommand,
  selectEnvironment,
  notebookSessionOutputs,
  togglePreviewOutputs,
  askChangeVarMode,
} from './commands'
import { ConnectSerializer, ISerializer } from './serializer'
import { RunmeLauncherProvider, RunmeTreeProvider } from './provider/launcher'
import { RunmeLauncherProvider as RunmeLauncherProviderBeta } from './provider/launcherBeta'
import { RunmeUriHandler } from './handler/uri'
import GrpcRunner, { IRunner } from './runner'
import * as survey from './survey'
import { RunmeCodeLensProvider } from './provider/codelens'
import CloudPanel from './panels/cloud'
import { createBootFileRunnerForActiveNotebook, createBootFileRunnerWatcher } from './handler/utils'
import { GithubAuthProvider } from './provider/githubAuth'
import { StatefulAuthProvider } from './provider/statefulAuth'
import { IPanel } from './panels/base'
import { EnvStorePanel } from './panels/notebook'
import { NotebookCellStatusBarProvider } from './provider/cellStatusBar/notebook'
import { SessionOutputCellStatusBarProvider } from './provider/cellStatusBar/sessionOutput'
import { GrpcReporter } from './reporter'
import * as manager from './ai/manager'
import getLogger from './logger'
import { EnvironmentManager } from './environment/manager'
import ContextState from './contextState'
import { RunmeIdentity } from './grpc/parser/tcp/types'
import * as features from './features'
import AuthSessionChangeHandler from './authSessionChangeHandler'
import { CloudNotebooks } from './provider/cloudNotebooks'
import StatefulFS, { StatefulFsScheme } from './provider/statefulFs'

export class RunmeExtension {
  protected serializer?: ISerializer

  async initialize(context: ExtensionContext) {
    const kernel = new Kernel(context)
    const grpcServer = kernel.hasExperimentEnabled('grpcServer')
    const grpcRunner = kernel.hasExperimentEnabled('grpcRunner')

    await ContextState.addKey(FeatureName.RemoteNotebooks, false)
    if (features.isOnInContextState(FeatureName.RemoteNotebooks)) {
      await ContextState.addKey(FeatureName.RemoteNotebooks, true)
      const statefulFs = new StatefulFS()
      context.subscriptions.push(
        workspace.registerFileSystemProvider(StatefulFsScheme, statefulFs, {
          isReadonly: false,
        }),
        commands.registerCommand('runme.addRemoteNotebooks', (_) => {
          workspace.updateWorkspaceFolders(0, 0, {
            uri: statefulFs.root,
            name: 'Workspace Notebooks',
          })
        }),
        window.registerTreeDataProvider('runme.remoteNotebooks', new CloudNotebooks()),
      )
    }

    const server = new KernelServer(
      context.extensionUri,
      kernel.envProps,
      {
        retryOnFailure: true,
        maxNumberOfIntents: 10,
      },
      !grpcServer,
      grpcRunner,
    )

    let runner: IRunner | undefined
    if (grpcRunner) {
      runner = new GrpcRunner(server)
      kernel.useRunner(runner)
    }

    // register ahead of attempting to server launch for error handling
    context.subscriptions.push(
      RunmeExtension.registerCommand('runme.openSettings', openRunmeSettings),
    )

    const reporter = new GrpcReporter(context, server)
    this.serializer = new ConnectSerializer(context, server, kernel)
    kernel.setSerializer(this.serializer)
    kernel.setReporter(reporter)

    let treeViewer: RunmeTreeProvider

    if (true || kernel.isFeatureOn(FeatureName.NewTreeProvider)) {
      await commands.executeCommand('setContext', 'runme.launcher.isExpanded', false)
      await commands.executeCommand('setContext', 'runme.launcher.includeUnnamed', false)
      treeViewer = new RunmeLauncherProviderBeta(kernel, this.serializer)

      if (treeViewer.openNotebook) {
        context.subscriptions.push(
          RunmeExtension.registerCommand(
            'runme.openNotebook',
            treeViewer.openNotebook.bind(treeViewer),
          ),
        )
      }

      if (treeViewer.runCell) {
        context.subscriptions.push(
          RunmeExtension.registerCommand(
            'runme.runSelectedCell',
            treeViewer.runCell.bind(treeViewer),
          ),
        )
      }
      if (treeViewer.openCell) {
        RunmeExtension.registerCommand(
          'runme.openSelectedCell',
          treeViewer.openCell.bind(treeViewer),
        )
      }
      if (treeViewer.refreshTasks) {
        RunmeExtension.registerCommand(
          'runme.refreshTasks',
          treeViewer.refreshTasks.bind(treeViewer),
        )
      }
    } else {
      treeViewer = new RunmeLauncherProvider(getDefaultWorkspace())
    }

    const runmeTaskProvider = tasks.registerTaskProvider(
      RunmeTaskProvider.id,
      new RunmeTaskProvider(context, treeViewer, this.serializer, kernel, server, runner),
    )

    /**
     * Start the Kernel server
     */
    try {
      await server.launch()
    } catch (e) {
      // Unrecoverable error happened
      if (e instanceof KernelServerError) {
        TelemetryReporter.sendTelemetryErrorEvent('extension.server', { data: e.message })
        if (server.transportType === KernelServer.transportTypeDefault) {
          return window
            .showErrorMessage(
              `Failed to start Kernel server (reason: ${e.message}).` +
                ' Consider switching from TCP to Unix Domain Socket in Settings.',
              'Open Settings',
            )
            .then((action) => {
              if (!action) {
                return
              }
              return commands.executeCommand('runme.openSettings', 'runme.server.transportType')
            })
        }
        return window
          .showErrorMessage(`Failed to start Kernel server. Reason: ${e.message}`)
          .then((action) => {
            if (!action) {
              return
            }
          })
      }
      TelemetryReporter.sendTelemetryErrorEvent('extension.server', { data: (e as Error).message })
      return window.showErrorMessage(
        'Failed to start Kernel server, please try to reload the window. ' +
          `Reason: ${(e as any).message}`,
      )
    }

    // Start the AIManager. This will enable the AI services if the user has enabled them.
    const aiManager = new manager.AIManager(kernel)
    // We need to hang onto a reference to the AIManager so it doesn't get garbage collected until the
    // extension is deactivated.
    context.subscriptions.push(aiManager)

    const winCodeLensRunSurvey = new survey.SurveyWinCodeLensRun(context)
    const surveys: Disposable[] = [
      winCodeLensRunSurvey,
      new survey.SurveyAddExtensionToRepo(context),
      new survey.SurveyFeedbackButton(context),
    ]
    const stopBackgroundTaskProvider = new StopBackgroundTaskProvider()

    const runCLI = runCLICommand(kernel, context.extensionUri, !!grpcRunner)
    const runFork = runForkCommand(kernel, context.extensionUri, !!grpcRunner)

    const codeLensProvider = new RunmeCodeLensProvider(
      context.extensionUri,
      this.serializer,
      runCLI,
      winCodeLensRunSurvey,
      runner,
      kernel,
      server,
    )
    const environment = new EnvironmentManager(context)

    await resetNotebookSettings()

    const transientOutputs = !getSessionOutputs()

    await ContextState.addKey(NOTEBOOK_PREVIEW_OUTPUTS, false)
    await ContextState.addKey(NOTEBOOK_ENV_VAR_MODE, getEnvVarMode())

    const omitKeys: Serializer.Metadata = {
      ['runme.dev/name']: undefined,
      ['runme.dev/nameGenerated']: undefined,
      ['runme.dev/id']: undefined,
      ['runme.dev/textRange']: undefined,
    }
    const transientCellMetadata = Object.fromEntries(Object.keys(omitKeys).map((k) => [k, true]))

    context.subscriptions.push(
      kernel,
      this.serializer,
      server,
      treeViewer,
      StatefulAuthProvider.instance,
      AuthSessionChangeHandler.instance,
      ...this.registerPanels(kernel, context),
      ...surveys,
      workspace.registerNotebookSerializer(Kernel.type, this.serializer, {
        transientCellMetadata,
        transientOutputs,
      }),

      notebooks.registerNotebookCellStatusBarItemProvider(
        Kernel.type,
        new ToggleTerminalProvider(kernel),
      ),
      notebooks.registerNotebookCellStatusBarItemProvider(
        Kernel.type,
        new BackgroundTaskProvider(),
      ),
      notebooks.registerNotebookCellStatusBarItemProvider(Kernel.type, stopBackgroundTaskProvider),
      notebooks.registerNotebookCellStatusBarItemProvider(
        Kernel.type,
        new NotebookCellStatusBarProvider(kernel),
      ),
      notebooks.registerNotebookCellStatusBarItemProvider(
        Kernel.type,
        new SessionOutputCellStatusBarProvider(kernel),
      ),
      stopBackgroundTaskProvider,

      codeLensProvider,

      RunmeExtension.registerCommand('runme.resetRunnerSession', () => askNewRunnerSession(kernel)),
      RunmeExtension.registerCommand('runme.openIntegratedTerminal', openIntegratedTerminal),
      RunmeExtension.registerCommand('runme.toggleTerminal', toggleTerminal(kernel, !!grpcRunner)),
      RunmeExtension.registerCommand('runme.runCliCommand', runCLI),
      RunmeExtension.registerCommand('runme.runForkCommand', runFork),
      RunmeExtension.registerCommand('runme.copyCellToClipboard', copyCellToClipboard),
      RunmeExtension.registerCommand('runme.stopBackgroundTask', stopBackgroundTask),
      RunmeExtension.registerCommand(
        'runme.openSplitViewAsMarkdownText',
        openSplitViewAsMarkdownText,
      ),
      RunmeExtension.registerCommand('runme.openAsRunmeNotebook', openAsRunmeNotebook),
      RunmeExtension.registerCommand('runme.runCategory', (notebook) => {
        return displayCategoriesSelector({ context, kernel, notebookToolbarCommand: notebook })
      }),
      RunmeExtension.registerCommand('runme.runCellCategory', (cell) =>
        runCellsByCategory(cell, kernel),
      ),
      RunmeExtension.registerCommand('runme.new', createNewRunmeNotebook),
      RunmeExtension.registerCommand('runme.welcome', welcome),
      RunmeExtension.registerCommand('runme.try', () => tryIt(context)),
      RunmeExtension.registerCommand('runme.openRunmeFile', treeViewer.openFile.bind(treeViewer)),
      RunmeExtension.registerCommand('runme.openRemoteRunmeFile', (uri: Uri) => {
        return commands.executeCommand('vscode.openWith', uri, Kernel.type)
      }),
      RunmeExtension.registerCommand('runme.keybinding.noop', () => {}),
      RunmeExtension.registerCommand('runme.file.openInRunme', openFileInRunme),
      RunmeExtension.registerCommand('runme.runWithPrompts', (cell) =>
        runCellWithPrompts(cell, kernel),
      ),
      runmeTaskProvider,

      /**
       * tree viewer items
       */
      window.registerTreeDataProvider('runme.launcher', treeViewer),

      RunmeExtension.registerCommand(
        'runme.collapseTreeView',
        treeViewer.collapseAll.bind(treeViewer),
      ),
      RunmeExtension.registerCommand('runme.expandTreeView', treeViewer.expandAll.bind(treeViewer)),
      RunmeExtension.registerCommand(
        'runme.tasksIncludeUnnamed',
        treeViewer.includeUnnamed.bind(treeViewer),
      ),
      RunmeExtension.registerCommand(
        'runme.tasksExcludeUnnamed',
        treeViewer.excludeUnnamed.bind(treeViewer),
      ),
      RunmeExtension.registerCommand('runme.authenticateWithGitHub', authenticateWithGitHub),
      RunmeExtension.registerCommand('runme.authenticateWithStateful', () => {
        StatefulAuthProvider.instance.newSession()
      }),
      RunmeExtension.registerCommand('runme.unauthenticateWithStateful', async () => {
        const session = await StatefulAuthProvider.instance.currentSession()
        if (session) {
          await StatefulAuthProvider.instance.removeSession(session.id)
        }
      }),
      /**
       * Uri handler
       */
      window.registerUriHandler(new RunmeUriHandler(context, kernel, getForceNewWindowConfig())),

      /**
       * Runme Message Display commands
       */
      RunmeExtension.registerCommand('runme.addToRecommendedExtensions', () =>
        addToRecommendedExtension(context),
      ),
      createBootFileRunnerForActiveNotebook(context, kernel),
      createBootFileRunnerWatcher(context, kernel),
      RunmeExtension.registerCommand(
        'runme.notebookOutputsMasked',
        this.handleMasking(kernel, true).bind(this),
      ),
      RunmeExtension.registerCommand(
        'runme.notebookOutputsUnmasked',
        this.handleMasking(kernel, false).bind(this),
      ),
      RunmeExtension.registerCommand('runme.notebookGistShare', (event: NotebookUiEvent) =>
        createGistCommand(event, context),
      ),
      RunmeExtension.registerCommand('runme.cellGistShare', (cell: NotebookCell) =>
        createCellGistCommand(cell, context),
      ),
      RunmeExtension.registerCommand('runme.notebookAutoSaveOn', () => toggleAutosave(false)),
      RunmeExtension.registerCommand('runme.notebookAutoSaveOff', () => toggleAutosave(true)),
      RunmeExtension.registerCommand('runme.envVarModeDocs', () =>
        askChangeVarMode(EnvVarMode.Shell, kernel),
      ),
      RunmeExtension.registerCommand('runme.envVarModeShell', () =>
        askChangeVarMode(EnvVarMode.Docs, kernel),
      ),
      RunmeExtension.registerCommand('runme.environments', () => selectEnvironment(environment)),
      RunmeExtension.registerCommand('runme.notebookAuthorMode', () =>
        toggleAuthorMode(false, kernel),
      ),
      RunmeExtension.registerCommand('runme.notebookExplorerMode', () =>
        toggleAuthorMode(true, kernel),
      ),
      RunmeExtension.registerCommand(
        'runme.notebookSessionOutputs',
        notebookSessionOutputs(kernel, this.serializer),
      ),

      RunmeExtension.registerCommand('runme.lifecycleIdentityNone', () =>
        commands.executeCommand('runme.lifecycleIdentitySelection', RunmeIdentity.UNSPECIFIED),
      ),

      RunmeExtension.registerCommand('runme.lifecycleIdentityAll', () =>
        commands.executeCommand('runme.lifecycleIdentitySelection', RunmeIdentity.ALL),
      ),

      RunmeExtension.registerCommand('runme.lifecycleIdentityDoc', () =>
        commands.executeCommand('runme.lifecycleIdentitySelection', RunmeIdentity.DOCUMENT),
      ),

      RunmeExtension.registerCommand('runme.lifecycleIdentityCell', () =>
        commands.executeCommand('runme.lifecycleIdentitySelection', RunmeIdentity.CELL),
      ),

      commands.registerCommand(
        'runme.lifecycleIdentitySelection',
        async (identity?: RunmeIdentity) => {
          if (identity === undefined) {
            window.showErrorMessage('Cannot run command without identity selection')
            return
          }

          // skip if lifecycle identity selection didn't change
          const current = ContextState.getKey(NOTEBOOK_LIFECYCLE_ID)
          if (current === identity) {
            return
          }

          TelemetryReporter.sendTelemetryEvent('extension.command', {
            command: 'runme.lifecycleIdentitySelection',
          })

          await ContextState.addKey(NOTEBOOK_LIFECYCLE_ID, identity)

          await Promise.all(
            workspace.notebookDocuments.map((doc) =>
              this.serializer?.switchLifecycleIdentity(doc, Number(identity)),
            ),
          )
        },
      ),
      RunmeExtension.registerCommand('runme.openCloudPanel', () =>
        commands.executeCommand('workbench.view.extension.runme'),
      ),
      // Register a command to generate completions using foyle
      RunmeExtension.registerCommand(
        'runme.aiGenerate',
        aiManager.completionGenerator.generateCompletion,
      ),
    )

    const transportType = getServerConfigurationValue<ServerTransportType>(
      'transportType',
      KernelServer.transportTypeDefault,
    )
    TelemetryReporter.sendTelemetryEvent('config', {
      runnerVersion: getServerRunnerVersion(),
      transportType,
    })

    await bootFile(context, kernel)

    if (
      kernel.hasExperimentEnabled('shellWarning', false) &&
      context.globalState.get<boolean>(TELEMETRY_EVENTS.ShellWarning, true)
    ) {
      const showUnsupportedShellMessage = async () => {
        const learnMore = 'Learn more'
        const dontAskAgain = "Don't ask again"

        TelemetryReporter.sendTelemetryEvent(TELEMETRY_EVENTS.ShellWarning)

        const answer = await window.showWarningMessage(
          'Your current shell has limited or no support.' +
            ' Please consider switching to sh, bash, or zsh.' +
            ' Click "Learn more" for additional resources.',
          learnMore,
          dontAskAgain,
        )
        if (answer === learnMore) {
          const url = getDocsUrlFor('/r/extension/unsupported-shell')
          env.openExternal(Uri.parse(url))
        } else if (answer === dontAskAgain) {
          await context.globalState.update(TELEMETRY_EVENTS.ShellWarning, false)
        }
      }

      const logger = getLogger('runme.experiments.shellWarning')

      kernel
        .runProgram('echo $SHELL')
        .then((output) => {
          if (output === undefined) {
            return
          }

          const supportedShells = ['bash', 'zsh']
          const isSupported = supportedShells.some((sh) => output?.includes(sh))
          logger.info(`Shell: ${output}`)

          if (!isSupported) {
            showUnsupportedShellMessage()
          }
        })
        .catch((e) => {
          logger.error(e)
          showUnsupportedShellMessage()
        })
    }

    if (kernel.isFeatureOn(FeatureName.RequireStatefulAuth)) {
      const logger = getLogger(FeatureName.RequireStatefulAuth)
      try {
        const session = await StatefulAuthProvider.instance.ensureSession()
        const nunmeIdentity = session ? RunmeIdentity.ALL : getServerLifecycleIdentity()
        await commands.executeCommand('runme.lifecycleIdentitySelection', nunmeIdentity)
        kernel.updateFeatureContext('statefulAuth', !!session)
      } catch (error) {
        let message
        if (error instanceof Error) {
          message = error.message
        } else {
          message = JSON.stringify(error)
        }

        logger.error(message)
      }
    }

    if (kernel.isFeatureOn(FeatureName.Gist)) {
      context.subscriptions.push(new GithubAuthProvider(context, kernel))
    }

    AuthSessionChangeHandler.instance.addListener((e) => {
      if (
        StatefulAuthProvider.instance &&
        kernel.isFeatureOn(FeatureName.RequireStatefulAuth) &&
        e.provider.id === AuthenticationProviders.Stateful
      ) {
        StatefulAuthProvider.instance.currentSession().then(async (session) => {
          if (session) {
            await commands.executeCommand('runme.lifecycleIdentitySelection', RunmeIdentity.ALL)
            kernel.emitPanelEvent('runme.cloud', 'onCommand', {
              name: 'signIn',
              panelId: 'runme.cloud',
            })
          } else {
            const settingsDefault = getServerLifecycleIdentity()
            await commands.executeCommand('runme.lifecycleIdentitySelection', settingsDefault)
            kernel.emitPanelEvent('runme.cloud', 'onCommand', {
              name: 'signOut',
              panelId: 'runme.cloud',
            })
          }
          kernel.updateFeatureContext('statefulAuth', !!session)
        })
      }
    })

    // only ever enabled in hosted playground
    if (features.isOnInContextState(FeatureName.HostedPlayground)) {
      await features.addTrustedDomains()
    }

    if (features.isOnInContextState(FeatureName.OpenTerminalOnStartup)) {
      await features.autoOpenTerminal()
    }
  }

  protected handleMasking(kernel: Kernel, maskingIsOn: boolean): (e: NotebookUiEvent) => void {
    const showSessionExpiryErrMessage = () => {
      return window.showErrorMessage(
        'Cannot toggle masking of outputs for expired sessions. Consider re-running the original notebook',
        { modal: true },
      )
    }

    return async (e: NotebookUiEvent) => {
      if (!e.ui) {
        return
      }
      const uri = e.notebookEditor.notebookUri
      const runnerEnv = kernel.getRunnerEnvironment()
      const sessionId = runnerEnv?.getSessionId()

      if (!sessionId || !uri.fsPath.includes(sessionId)) {
        await showSessionExpiryErrMessage()
        return
      }

      await toggleMasking(maskingIsOn)
      await togglePreviewOutputs(true)
      const written = (await this.serializer?.saveNotebookOutputs(uri)) ?? -1
      if (written > -1) {
        // success early return
        return
      }
      await toggleMasking(!maskingIsOn)
      await showSessionExpiryErrMessage()
    }
  }

  protected registerPanels(kernel: Kernel, context: ExtensionContext): Disposable[] {
    const register = (channel: Channel<SyncSchema>, factory: (pid: string) => IPanel) => {
      return (id: string): Disposable[] => {
        const p = factory(id)
        const bus$ = channel.register([p.webview])
        p.registerBus(bus$)
        const webviewProvider = window.registerWebviewViewProvider(id, p)
        kernel.registerWebview(id, p, webviewProvider)
        return [webviewProvider]
      }
    }

    const appChannel = new Channel<SyncSchema>('app')
    const runmePanelIds: string[] = [
      WebViews.RunmeCloud as const,
      WebViews.RunmeChat as const,
      WebViews.RunmeSearch as const,
    ]

    const notebookChannel = new Channel<SyncSchema>('notebooks')
    const notebookPanelIds: string[] = [WebViews.NotebookEnvStore as const]

    return [
      ...runmePanelIds.map(register(appChannel, (id) => new CloudPanel(context, id))),
      ...notebookPanelIds.map(
        register(notebookChannel, (id) => new EnvStorePanel(context, id, kernel.useMonitor())),
      ),
    ].flat()
  }

  static registerCommand(command: string, callback: (...args: any[]) => any, thisArg?: any) {
    return commands.registerCommand(
      command,
      (...wrappedArgs: any[]) => {
        TelemetryReporter.sendTelemetryEvent('extension.command', { command })
        return callback(...wrappedArgs, thisArg)
      },
      thisArg,
    )
  }

  static getExtensionIdentifier(context: ExtensionContext) {
    const publisher = context.extension.packageJSON.publisher
    const name = context.extension.packageJSON.name
    return `${publisher}.${name}`
  }
}
