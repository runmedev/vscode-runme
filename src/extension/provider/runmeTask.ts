import {
  ExtensionContext,
  ProviderResult,
  Task,
  TaskProvider,
  Uri,
  workspace,
  TaskScope,
  TaskRevealKind,
  TaskPanelKind,
  CancellationToken,
  CustomExecution,
  NotebookCell,
  NotebookCellData,
  NotebookData,
  Disposable,
} from 'vscode'
import { ServerStreamingCall } from '@protobuf-ts/runtime-rpc'
import { GrpcTransport } from '@protobuf-ts/grpc-transport'
import {
  Observable,
  of,
  from,
  scan,
  map,
  takeLast,
  firstValueFrom,
  lastValueFrom,
  isObservable,
} from 'rxjs'

import getLogger from '../logger'
import { asWorkspaceRelativePath, getAnnotations, getWorkspaceEnvs } from '../utils'
import { Serializer, RunmeTaskDefinition } from '../../types'
import { SerializerBase } from '../serializer'
import type { IRunner, RunProgramExecution, RunProgramOptions } from '../runner'
import { IRunnerEnvironment } from '../runner/environment'
import { getCellCwd, getCellProgram, getNotebookSkipPromptEnvSetting } from '../executors/utils'
import { Kernel } from '../kernel'
import RunmeServer from '../server/runmeServer'
import { ProjectServiceClient, initProjectClient, type ReadyPromise } from '../grpc/client'
import { LoadEventFoundTask, LoadRequest, LoadResponse } from '../grpc/projectTypes'
import { RunmeIdentity } from '../grpc/serializerTypes'
import { resolveRunProgramExecution } from '../executors/runner'
import { CommandMode } from '../grpc/runnerTypes'

import { RunmeLauncherProvider } from './launcher'

type TaskOptions = Pick<RunmeTaskDefinition, 'closeTerminalOnSuccess' | 'isBackground' | 'cwd'>
const log = getLogger('RunmeTaskProvider')

export interface RunmeTask extends Task {
  definition: Required<RunmeTaskDefinition>
}

type LoadStream = ServerStreamingCall<LoadRequest, LoadResponse>

type ProjectTask = LoadEventFoundTask

type TaskNotebook = NotebookData | Serializer.Notebook

type TaskCell = NotebookCell | NotebookCellData | Serializer.Cell

export class RunmeTaskProvider implements TaskProvider {
  static execCount = 0
  static id = 'runme'

  private ready: ReadyPromise
  private tasks: Promise<ProjectTask[]>
  private client: ProjectServiceClient | undefined
  private serverReadyListener: Disposable | undefined

  constructor(
    private context: ExtensionContext,
    private treeView: RunmeLauncherProvider,
    private serializer: SerializerBase,
    private kernel: Kernel,
    private server: RunmeServer,
    private runner?: IRunner,
  ) {
    this.serverReadyListener = this.server.onTransportReady(({ transport }) =>
      this.initProjectClient(transport),
    )

    this.ready = new Promise((resolve) => {
      const disposable = server.onTransportReady(() => {
        disposable.dispose()
        resolve()
      })
    })

    this.tasks = lastValueFrom(this.loadProjectTasks().pipe(takeLast(1)))
  }

  private async initProjectClient(transport?: GrpcTransport) {
    this.client = initProjectClient(transport ?? (await this.server.transport()))
  }

  protected loadProjectTasks(): Observable<ProjectTask[]> {
    if (!workspace.workspaceFolders?.length) {
      return of([])
    }

    const separator = workspace.workspaceFolders[0].uri.fsPath.indexOf('/') > -1 ? '/' : '\\'

    const requests = (workspace.workspaceFolders ?? []).map((folder) => {
      return <LoadRequest>{
        kind: {
          oneofKind: 'directory',
          directory: {
            path: workspace.asRelativePath(folder.uri),
            skipGitignore: false,
            ignoreFilePatterns: [],
            skipRepoLookupUpward: false,
          },
        },
        identity: RunmeIdentity.ALL,
      }
    })

    log.info(`Walking ${requests.length} directories/repos...`)

    const task$ = new Observable<ProjectTask>((observer) => {
      this.ready.then(() =>
        Promise.all(
          requests.map((request) => {
            const session: LoadStream = this.client!.load(request)
            session.responses.onMessage((msg) => {
              if (msg.data.oneofKind !== 'foundTask') {
                return
              }
              observer.next(msg.data.foundTask)
            })
            return session
          }),
        ).then(() => {
          log.info('Finished walk.')
          observer.complete()
        }),
      )
    })

    const dirProx = (pt: ProjectTask) => {
      const { relativePath, outside } = asWorkspaceRelativePath(pt.documentPath)
      const len = relativePath.split(separator).length
      if (outside) {
        return 100 * len
      }
      return len
    }

    return task$.pipe(
      scan((acc, one) => {
        acc.push(one)
        acc.sort((a, b) => dirProx(a) - dirProx(b))
        return acc
      }, new Array<ProjectTask>()),
    )
  }

  public async provideTasks(token: CancellationToken): Promise<Task[]> {
    if (!this.runner) {
      log.error('Tasks only supported with gRPC runner enabled')
      return []
    }

    const runnerEnv = this.kernel?.getRunnerEnvironment()
    const all = await this.tasks
    const includeAllTasks = this.treeView.includeAllTasks

    try {
      const filtered = all.filter((prjTask) => {
        if (includeAllTasks) {
          return true
        }
        const { outside } = asWorkspaceRelativePath(prjTask.documentPath)
        return !prjTask.isNameGenerated && !outside
      })
      // show all if there isn't a single named task
      const listed = filtered.length > 0 ? filtered : all
      const runmeTasks = listed.map(
        async (prjTask) =>
          await RunmeTaskProvider.newRunmeProjectTask(
            prjTask,
            {},
            token,
            this.serializer,
            this.runner!,
            runnerEnv,
          ),
      )
      return Promise.all(runmeTasks)
    } catch (e) {
      console.error(e)
    }

    return Promise.resolve([])
  }

  public resolveTask(task: Task): ProviderResult<Task> {
    /**
     * ToDo(sebastian): Implement refresh.
     * This only occurs if the task is no longer known.
     * Likely a side effect that the markdown file was modified.
     */
    return task
  }

  static async newRunmeProjectTask(
    knownTask: Pick<ProjectTask, 'id' | 'name' | 'documentPath'>,
    options: TaskOptions = {},
    token: CancellationToken,
    serializer: SerializerBase,
    runner: IRunner,
    runnerEnv?: IRunnerEnvironment,
  ): Promise<Task> {
    const { id, name, documentPath } = knownTask
    let mdBuffer: Uint8Array
    try {
      mdBuffer = await workspace.fs.readFile(Uri.parse(documentPath))
    } catch (err: any) {
      if (err.code !== 'FileNotFound') {
        log.error(`${err.message}`)
      }
      throw err
    }

    const notebook = from(serializer.deserializeNotebook(mdBuffer, token))
    const cell = notebook.pipe(
      map((n) => {
        console.log(documentPath)
        return n.cells.find(
          (cell) => cell.metadata?.['id'] === id || cell.metadata?.['runme.dev/name'] === name,
        )!
      }),
    )

    return this.newRunmeTask(documentPath, name, notebook, cell, options, runner, runnerEnv)
  }

  static async newRunmeTask(
    filePath: string,
    command: string,
    notebookish: TaskNotebook | Observable<TaskNotebook>,
    cellish: TaskCell | Observable<TaskCell>,
    options: TaskOptions = {},
    runner: IRunner,
    runnerEnv: IRunnerEnvironment | undefined,
  ): Promise<Task> {
    const source = asWorkspaceRelativePath(filePath).relativePath
    const name = `${command}`

    notebookish = !isObservable(notebookish) ? of(notebookish) : notebookish
    cellish = !isObservable(cellish) ? of(cellish) : cellish

    const task = new Task(
      { type: 'runme', name, command: name },
      TaskScope.Workspace,
      name,
      source,
      new CustomExecution(async () => {
        const notebook = await firstValueFrom<TaskNotebook>(notebookish as any)
        const cell = await firstValueFrom<TaskCell>(cellish as any)

        const { interactive, background, promptEnv } = getAnnotations(cell.metadata)
        const isBackground = options.isBackground || background

        const skipPromptEnvDocumentLevel = getNotebookSkipPromptEnvSetting(notebook)
        const languageId = ('languageId' in cell && cell.languageId) || 'sh'

        const { programName, commandMode } = getCellProgram(cell, notebook, languageId)
        const promptForEnv = skipPromptEnvDocumentLevel === false ? promptEnv : false
        const envs: Record<string, string> = {
          ...(await getWorkspaceEnvs(Uri.file(filePath))),
        }
        const envKeys = new Set([...(runnerEnv?.initialEnvs() ?? []), ...Object.keys(envs)])
        const cwd = options.cwd || (await getCellCwd(cell, notebook, Uri.file(filePath)))

        const cellText = 'value' in cell ? cell.value : cell.document.getText()

        if (!runnerEnv) {
          Object.assign(envs, process.env)
        }

        // todo(sebastian): re-prompt the best solution here?
        const execution = await RunmeTaskProvider.resolveRunProgramExecutionWithRetry(
          cellText,
          languageId,
          commandMode,
          promptForEnv,
          envKeys,
        )

        const runOpts: RunProgramOptions = {
          commandMode,
          convertEol: true,
          cwd,
          runnerEnv: runnerEnv,
          envs: Object.entries(envs).map(([k, v]) => `${k}=${v}`),
          exec: execution,
          languageId,
          programName,
          storeLastOutput: true,
          tty: interactive,
        }

        const program = await runner.createProgramSession(runOpts)

        program.registerTerminalWindow('vscode')
        program.setActiveTerminalWindow('vscode')

        task.isBackground = isBackground
        task.presentationOptions = {
          focus: true,
          // why doesn't this work with Silent?
          reveal: isBackground ? TaskRevealKind.Never : TaskRevealKind.Silent,
          panel: isBackground ? TaskPanelKind.Dedicated : TaskPanelKind.Shared,
        }

        return program
      }),
    )

    return task
  }

  static async resolveRunProgramExecutionWithRetry(
    script: string,
    languageId: string,
    commandMode: CommandMode,
    promptForEnv: boolean,
    skipEnvs?: Set<string>,
  ): Promise<RunProgramExecution> {
    try {
      return await resolveRunProgramExecution(
        script,
        languageId,
        commandMode,
        promptForEnv,
        skipEnvs,
      )
    } catch (err: unknown) {
      if (err instanceof Error) {
        log.error(err.message)
      }
      return RunmeTaskProvider.resolveRunProgramExecutionWithRetry(
        script,
        languageId,
        commandMode,
        promptForEnv,
        skipEnvs,
      )
    }
  }
}
