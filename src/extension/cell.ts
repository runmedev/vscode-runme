import {
  commands,
  window,
  Disposable,
  NotebookCell,
  NotebookCellExecution,
  NotebookCellKind,
  NotebookCellOutput,
  NotebookCellOutputItem,
  NotebookController,
  NotebookEdit,
  NotebookEditor,
  workspace,
  WorkspaceEdit,
  NotebookCellData,
} from 'vscode'

import {
  GITHUB_USER_SIGNED_IN,
  NOTEBOOK_AUTOSAVE_ON,
  OutputType,
  PLATFORM_USER_SIGNED_IN,
} from '../constants'
import {
  AWSState,
  CellOutputPayload,
  FeatureName,
  GCPState,
  GitHubState,
  Serializer,
} from '../types'
import { Mutex } from '../utils/sync'
import {
  getDocsUrl,
  getNotebookTerminalConfigurations,
  getSessionOutputs,
  isPlatformAuthEnabled,
} from '../utils/configuration'

import features from './features'
import { RUNME_TRANSIENT_REVISION } from './constants'
import { getAnnotations, replaceOutput, validateAnnotations } from './utils'
import {
  ITerminalState,
  LocalBufferTermState,
  NotebookTerminalType,
  XTermState,
} from './terminal/terminalState'
import ContextState from './contextState'
import { IRunnerEnvironment } from './runner/environment'
import { RunProgramOptions } from './runner'

const NOTEBOOK_SELECTION_COMMAND = '_notebook.selectKernel'

export class NotebookCellManager {
  #data = new WeakMap<NotebookCell, NotebookCellOutputManager>()
  #runnerEnv: IRunnerEnvironment | undefined
  #executionSessionOrder = new Map<string, number>()
  #mruSessionId = ''

  constructor(protected controller: NotebookController) {}

  registerCell(cell: NotebookCell): NotebookCellOutputManager {
    const existing = this.#data.get(cell)
    if (existing) {
      return existing
    }

    const outputs = new NotebookCellOutputManager(cell, this.controller)
    this.#data.set(cell, outputs)

    return outputs
  }

  setRunnerEnv(runnerEnv: IRunnerEnvironment) {
    this.#runnerEnv = runnerEnv
    this.#mruSessionId = runnerEnv.getSessionId()
    this.#executionSessionOrder.set(this.#mruSessionId, 0)
  }

  incrementExecutionOrder(outputs: NotebookCellOutputManager): void {
    let order = this.#executionSessionOrder.get(this.#mruSessionId) ?? 0
    this.#executionSessionOrder.set(this.#mruSessionId, ++order)
    outputs.setSessionExecutionOrder(this.#mruSessionId, order)
  }

  async createNotebookCellExecution(
    cell: NotebookCell,
  ): Promise<RunmeNotebookCellExecution | undefined> {
    const outputs = await this.getNotebookOutputs(cell)
    this.incrementExecutionOrder(outputs)
    return outputs.createNotebookCellExecution()
  }

  async getNotebookOutputs(cell: NotebookCell): Promise<NotebookCellOutputManager> {
    const outputs = this.#data.get(cell)
    if (!outputs) {
      console.error(`cell at index ${cell.index} has not been registered!`)
    } else {
      outputs.setMruSessionId(this.#mruSessionId)
    }

    return outputs ?? this.registerCell(cell)
  }
}

type NotebookOutputs = NotebookCellOutput | readonly NotebookCellOutput[]
interface ICellOption {
  editor?: NotebookEditor
  id: string
}

interface ICellState {
  type: OutputType
  // TODO: Define a better abstraction for integration states.
  state: GitHubState | GCPState | AWSState
}

interface InsertCodeCellOptions {
  cell: NotebookCell
  input: string
  displayConfirmationDialog: boolean
  languageId: string
  background: boolean
  run: boolean
}

export class NotebookCellOutputManager {
  protected outputs: readonly NotebookCellOutput[] = []

  protected enabledOutputs = new Map([
    [OutputType.annotations, false],
    [OutputType.github, false],
    [OutputType.gcp, false],
    [OutputType.aws, false],
    [OutputType.daggerCall, false],
    [OutputType.daggerShell, false],
  ])

  protected sessionExecutionOrder = new Map<string, number | undefined>()
  protected mruSessionId = ''

  protected cellState?: ICellState

  protected mutex: Mutex = new Mutex()
  protected withLock = this.mutex.withLock.bind(this.mutex)

  protected onFinish = Promise.resolve()
  protected execution?: NotebookCellExecution

  protected terminalState?: ITerminalState
  protected terminalEnabled = false
  protected outputsState?: Map<OutputType, Map<string, any>>

  constructor(
    protected cell: NotebookCell,
    protected controller: NotebookController,
  ) {}

  protected generateOutputUnsafe(type: OutputType): NotebookCellOutput | undefined {
    const cell = this.cell

    switch (type) {
      case OutputType.annotations: {
        const annotationJson: CellOutputPayload<OutputType.annotations> = {
          type: OutputType.annotations,
          output: {
            annotations: getAnnotations(cell),
            validationErrors: validateAnnotations(cell),
            id: cell.metadata['runme.dev/id'],
            settings: {
              docsUrl: getDocsUrl(),
            },
          },
        }

        return new NotebookCellOutput([
          NotebookCellOutputItem.json(annotationJson, OutputType.annotations),
          NotebookCellOutputItem.json(annotationJson),
        ])
      }

      case OutputType.daggerCall: {
        const cellId = cell.metadata['runme.dev/id']
        const payload: CellOutputPayload<OutputType.daggerCall> = {
          type: OutputType.daggerCall,
          output: { cellId },
        }

        const output = this.outputsState?.get?.(type)?.get?.(cellId)

        payload.output = {
          ...payload.output,
          output: { json: output?.json, text: output?.text },
        }

        return new NotebookCellOutput(
          [NotebookCellOutputItem.json(payload, OutputType.daggerCall)],
          {
            daggerCellId: cellId,
          },
        )
      }

      case OutputType.terminal: {
        const terminalState = this.terminalState
        if (!terminalState) {
          return
        }

        const { 'runme.dev/id': cellId, terminalRows } = getAnnotations(cell)
        if (!cellId) {
          throw new Error('Cannot open cell terminal with invalid ID!')
        }

        const stdoutBase64 = terminalState.serialize()
        if (type === OutputType.terminal) {
          let terminalOutputItem: NotebookCellOutputItem | undefined

          const daggerOutput = cell.outputs.find(
            ({ metadata }) => metadata?.daggerCellId === cellId,
          )

          const terminalStateStr = terminalState.serialize()
          const programOptions = terminalState.getProgramOptions()
          const execScript =
            programOptions?.exec?.type === 'script'
              ? programOptions.exec.script
              : (programOptions?.exec?.commands ?? []).join('\n')
          if (!terminalOutputItem) {
            const terminalConfigurations = getNotebookTerminalConfigurations(cell.notebook.metadata)

            const isSignedIn = isPlatformAuthEnabled()
              ? ContextState.getKey(PLATFORM_USER_SIGNED_IN)
              : ContextState.getKey(GITHUB_USER_SIGNED_IN)

            const json: CellOutputPayload<OutputType.terminal> = {
              type: OutputType.terminal,
              output: {
                'runme.dev/id': cellId,
                content: stdoutBase64,
                initialRows: terminalRows || terminalConfigurations.rows,
                isAutoSaveEnabled: isSignedIn
                  ? ContextState.getKey<boolean>(NOTEBOOK_AUTOSAVE_ON)
                  : false,
                isPlatformAuthEnabled: isPlatformAuthEnabled(),
                isDaggerOutput: !!daggerOutput,
                ...terminalConfigurations,
              },
            }
            terminalOutputItem = NotebookCellOutputItem.json(json, OutputType.terminal)
          }

          return new NotebookCellOutput(
            [
              terminalOutputItem,
              NotebookCellOutputItem.stdout(terminalStateStr),
              NotebookCellOutputItem.text(execScript),
            ],
            {
              'runme.dev/id': cellId,
            },
          )
        }
      }

      case OutputType.outputItems: {
        const terminalState = this.terminalState
        if (!terminalState) {
          return
        }

        const { 'runme.dev/id': cellId } = getAnnotations(cell)
        const terminalStateBase64 = terminalState.serialize()
        const json: CellOutputPayload<OutputType.outputItems> = {
          type: OutputType.outputItems,
          output: {
            content: terminalStateBase64,
            mime: 'text/plain',
            id: cellId!,
          },
        }

        return new NotebookCellOutput([
          NotebookCellOutputItem.json(json, OutputType.outputItems),
          NotebookCellOutputItem.stdout(
            Buffer.from(terminalStateBase64, 'base64').toString('utf-8'),
          ),
        ])
      }

      case OutputType.github: {
        const payload: CellOutputPayload<OutputType.github> = {
          type: OutputType.github,
          output: this.getCellState(type),
        }

        return new NotebookCellOutput([NotebookCellOutputItem.json(payload, OutputType.github)])
      }

      case OutputType.gcp: {
        const payload: CellOutputPayload<OutputType.gcp> = {
          type: OutputType.gcp,
          output: this.getCellState(type),
        }

        return new NotebookCellOutput([
          NotebookCellOutputItem.json(payload, OutputType.gcp),
          NotebookCellOutputItem.json(payload),
        ])
      }

      case OutputType.aws: {
        const payload: CellOutputPayload<OutputType.aws> = {
          type: OutputType.aws,
          output: this.getCellState(type),
        }

        return new NotebookCellOutput([
          NotebookCellOutputItem.json(payload, OutputType.aws),
          NotebookCellOutputItem.json(payload),
        ])
      }

      default: {
        return undefined
      }
    }
  }

  saveOutputState(cellId: string, type: OutputType, value: any) {
    if (!this.outputsState) {
      this.outputsState = new Map()
    }

    let outputState = this.outputsState.get(type)

    if (!outputState) {
      outputState = new Map()
    }

    outputState.set(cellId, value)
    this.outputsState.set(type, outputState)
  }

  cleanOutputState(cellId: string, type: OutputType) {
    if (!this.outputsState) {
      return
    }

    const outputState = this.outputsState.get(type)
    if (!outputState) {
      return
    }

    outputState.delete(cellId)
  }

  registerCellTerminalState({
    type,
    programOptions,
    scrollback,
  }: {
    type: NotebookTerminalType
    programOptions: RunProgramOptions
    scrollback: number
  }): ITerminalState {
    let terminalState: ITerminalState
    // Limit the number of emitted chunks which can include line-breaks
    // to avoid excessive memory usage
    const chunksLimit = scrollback

    switch (type) {
      case 'xterm':
        {
          const _terminalState = new XTermState(chunksLimit)
          const _write = _terminalState.write
          const _input = _terminalState.input

          _terminalState.write = (data) => {
            _write.call(_terminalState, data)
            // this.refreshTerminal(_terminalState)
          }

          _terminalState.input = (data: string, wasUserInput: boolean) => {
            _input.call(_terminalState, data, wasUserInput)
          }

          terminalState = _terminalState
        }
        break

      case 'local':
        {
          const _terminalState = new LocalBufferTermState(chunksLimit)
          const _write = _terminalState.write

          _terminalState.write = (data) => {
            _write.call(_terminalState, data)
            this.refreshOutput(OutputType.outputItems)
          }

          terminalState = _terminalState
        }
        break
    }

    terminalState.setProgramOptions(programOptions)
    this.terminalState = terminalState
    return terminalState
  }

  getCellTerminalState(): ITerminalState | undefined {
    return this.terminalState
  }

  private async handleNotebookKernelSelection() {
    // cmd may go away https://github.com/microsoft/vscode/issues/126534#issuecomment-864053106
    const selectionCommandAvailable = await commands
      .getCommands()
      .then((cmds) => cmds.includes(NOTEBOOK_SELECTION_COMMAND))

    if (!selectionCommandAvailable) {
      window.showWarningMessage('Please select a kernel (top right: "Select Kernel") to continue.')
      return
    }
    return await window
      .showInformationMessage('Please select a notebook kernel first to continue.', 'Select Kernel')
      .then((option) => {
        if (!option) {
          return
        }
        commands.executeCommand(NOTEBOOK_SELECTION_COMMAND)
      })
  }

  private async newCellExecution(): Promise<NotebookCellExecution | undefined> {
    try {
      return this.controller.createNotebookCellExecution(this.cell)
    } catch (e: any) {
      if (e.message.toString().includes('controller is NOT associated')) {
        await this.handleNotebookKernelSelection()
        return undefined
      }

      throw e
    }
  }

  async createNotebookCellExecution(): Promise<RunmeNotebookCellExecution | undefined> {
    await this.onFinish

    return await this.withLock(async () => {
      const execution = await this.newCellExecution()
      if (!execution) {
        return undefined
      }

      execution.executionOrder = this.currentExecutionOrder()
      this.execution = execution

      const wrapper = new RunmeNotebookCellExecution(execution)

      const resetExecution = async () => {
        await this.withLock(async () => {
          if (this.execution === execution) {
            this.execution = undefined
          }
        })
      }

      this.onFinish = new Promise<void>(async (resolve) => {
        wrapper.onWillEnd(async () => {
          await this.refreshTerminal(this.terminalState)
        })
        wrapper.onEnd(async () => {
          await resetExecution()
          resolve()
        })

        if (wrapper.hasEnded) {
          resolve()
        }
      }).finally(resetExecution)

      return wrapper
    })
  }

  protected hasOutputTypeUnsafe(
    type: OutputType,
    outputs?: readonly NotebookCellOutput[],
  ): boolean {
    outputs ??= this.cell.outputs
    return outputs.some((x) => x.items.some((y) => y.mime === type))
  }

  async replaceOutputs(outputs: NotebookOutputs) {
    await this.refreshOutputInternal(() => {
      this.outputs = outputsAsArray(outputs)
    })
  }

  async toggleOutput(type: OutputType) {
    await this.showOutput(type, () => !this.hasOutputTypeUnsafe(type))
  }

  async showOutput(type: OutputType, shown: boolean | (() => boolean | Promise<boolean>) = true) {
    await this.refreshOutputInternal(async () => {
      this.enabledOutputs.set(type, typeof shown === 'function' ? await shown() : shown)
    })
  }

  async toggleTerminal() {
    await this.showTerminal(() => {
      return !this.terminalEnabled
    })
  }

  async showTerminal(shown: boolean | (() => boolean) = true) {
    await this.refreshOutputInternal(async () => {
      this.terminalEnabled = typeof shown === 'function' ? shown() : shown
    })
  }

  shouldSkipRefreshTerminal() {
    const isSignedIn = features.isOnInContextState(FeatureName.SignedIn)
    const isForceLogin = features.isOnInContextState(FeatureName.ForceLogin)

    return !isSignedIn && isForceLogin
  }

  /**
   * Syncs a stdout output item based on the active terminal
   *
   * @param terminalState the terminal's state that should be
   * used to update the output item
   *
   * Unfortunately the replacement behavior appears to be broken
   * which leads to duplication of the output item in the UX
   *
   * Marking the document dirty instead of replacing the output
   *
   */
  async refreshTerminal(terminalState: ITerminalState | undefined): Promise<void> {
    if (this.shouldSkipRefreshTerminal()) {
      return
    }

    await this.withLock(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      await this.getExecutionUnsafe(async (exec) => {
        if (
          !terminalState ||
          !this.terminalEnabled ||
          !this.hasOutputTypeUnsafe(OutputType.terminal)
        ) {
          return
        }

        let terminalOutput: NotebookCellOutput | undefined
        let terminalOutputItem: NotebookCellOutputItem | undefined
        for (const out of this.cell.outputs) {
          terminalOutputItem = out.items.find((item) => {
            return item.mime === terminalState.outputType
          })
          if (terminalOutputItem) {
            terminalOutput = out
            break
          }
        }

        if (!getSessionOutputs() || !terminalOutput || !terminalOutputItem) {
          return
        }

        // deactivated due to some duplication behavior
        // perhaps https://github.com/microsoft/vscode/issues/173577 ?
        // const strTerminalState = terminalState?.serialize() || ''
        // const newStdoutOutputItem = NotebookCellOutputItem.stdout(strTerminalState)
        // await exec.replaceOutputItems([terminalOutputItem, newStdoutOutputItem], terminalOutput)

        // mark document as dirty instead (prompt user to hit save) to avoid data-loss
        const revision = this.cell.metadata[RUNME_TRANSIENT_REVISION] ?? 1

        const metadata = {
          ...(this.cell.metadata || {}),
          [RUNME_TRANSIENT_REVISION]: revision + 1,
        } as Serializer.Metadata

        const notebookEdits = NotebookEdit.updateCellMetadata(this.cell.index, metadata)

        const edit = new WorkspaceEdit()
        edit.set(this.cell.notebook.uri, [notebookEdits])

        await workspace.applyEdit(edit)
      })
    })
  }

  /**
   * Refreshes the output list
   *
   * @param type * If present, only refresh output list if the given OutputType(s)
   * are present in the outputs, otherwise does nothing
   */
  async refreshOutput(type?: OutputType | OutputType[]) {
    await this.refreshOutputInternal(() => {
      if (type === undefined) {
        return
      }

      const typeSet = Array.isArray(type) ? type : [type]
      return typeSet.some((t) => this.hasOutputTypeUnsafe(t))
    })
  }

  /**
   * Internal refresh output function. Runs under mutex.
   *
   * @param mutater Optional callback, which runs after enabled outputs are
   * retrieved, but before outputs are replaced. This function should be used to
   * mutate the state of enabled outputs.
   *
   * It can also be used to prevent outputs from being replaced at all, by
   * returning `false`. This is used in the exposed `refreshOutput` function,
   * where the user can prevent refreshing if a certain output type is not
   * present.
   */
  protected async refreshOutputInternal(mutater?: () => Promise<boolean | void> | boolean | void) {
    await this.withLock(async () => {
      await this.getExecutionUnsafe(async (exec) => {
        exec.executionOrder = this.currentExecutionOrder()
        for (const key of [...this.enabledOutputs.keys()]) {
          this.enabledOutputs.set(key, this.hasOutputTypeUnsafe(key))
        }

        const terminalOutput = this.terminalState?.outputType

        if (terminalOutput) {
          this.terminalEnabled = this.hasOutputTypeUnsafe(OutputType.terminal)
        }

        if (!((await mutater?.()) ?? true)) {
          return
        }

        let terminalCellOutput =
          this.terminalEnabled && terminalOutput && this.generateOutputUnsafe(terminalOutput)

        await replaceOutput(exec, [
          ...[...this.enabledOutputs.entries()].flatMap(([type, enabled]) => {
            if (!enabled) {
              return []
            }

            const output = this.generateOutputUnsafe(type)
            if (!output) {
              return []
            }

            return [output]
          }),
          ...(terminalCellOutput ? [terminalCellOutput] : []),
          ...this.outputs,
        ])
      })
    })
  }

  protected async getExecutionUnsafe(cb: (exec: NotebookCellExecution) => Promise<void> | void) {
    if (this.execution) {
      await cb?.(this.execution)
      return
    }

    const exec = await this.newCellExecution()
    if (!exec) {
      return
    }

    exec.start(Date.now())

    try {
      await cb(exec)
    } catch (e) {
      throw e
    } finally {
      exec.end(true)
    }
  }

  setSessionExecutionOrder(sessionId: string, order: number | undefined): number | undefined {
    this.sessionExecutionOrder.set(sessionId, order)
    this.setMruSessionId(sessionId)
    return order
  }

  setMruSessionId(sessionId: string): void {
    if (this.mruSessionId === sessionId) {
      return
    }
    this.mruSessionId = sessionId
  }

  protected currentExecutionOrder(): number | undefined {
    const mruExecOrder = this.sessionExecutionOrder.get(this.mruSessionId)
    return mruExecOrder
  }

  setState(state: ICellState) {
    this.cellState = state
  }

  getCellState<T>(type: OutputType): T | undefined {
    if (this.cellState?.type !== type) {
      this.cellState = undefined
    }
    return this.cellState?.state as T
  }
}

function outputsAsArray(outputs: NotebookOutputs): readonly NotebookCellOutput[] {
  return Array.isArray(outputs) ? outputs : [outputs]
}

type OnWillEndCallback = () => Promise<void>
type OnEndCallback = (info: { success?: boolean; endTime?: number }) => Promise<void>

export class RunmeNotebookCellExecution implements Disposable {
  private _onEnd?: OnEndCallback
  private _onWillEnd?: OnWillEndCallback

  private _hasEnded = false

  constructor(private exec: NotebookCellExecution) {}

  onEnd(cb: OnEndCallback) {
    this._onEnd = cb
  }

  onWillEnd(cb: OnWillEndCallback) {
    this._onWillEnd = cb
  }

  start(startTime?: number): void {
    return this.exec.start(startTime)
  }

  async end(success: boolean | undefined, endTime?: number): Promise<void> {
    await this._onWillEnd?.()
    this.exec.end(success, endTime)
    await this._onEnd?.({ success, endTime })
    this._hasEnded = true
  }

  dispose() {}

  get hasEnded() {
    return this._hasEnded
  }

  get underlyingExecution() {
    return this.exec
  }
}

export async function updateCellMetadata(cell: NotebookCell, meta: Partial<Serializer.Metadata>) {
  const edit = new WorkspaceEdit()

  const notebookEdit = NotebookEdit.updateCellMetadata(cell.index, {
    ...cell.metadata,
    ...meta,
  })

  edit.set(cell.notebook.uri, [notebookEdit])
  await workspace.applyEdit(edit)
}

export async function getCellById(options: ICellOption): Promise<NotebookCell | undefined> {
  const { editor, id } = options
  for (const document of workspace.notebookDocuments) {
    for (const cell of document.getCells()) {
      if (
        cell.kind !== NotebookCellKind.Code ||
        (editor && cell.document.uri.fsPath !== editor.notebook.uri.fsPath)
      ) {
        continue
      }

      if (cell.metadata?.['runme.dev/id'] === undefined) {
        console.error(`[Runme] Cell with index ${cell.index} lacks id`)
        continue
      }

      if (cell.metadata?.['runme.dev/id'] === id) {
        return cell
      }
    }
  }
}

export async function insertCodeCell(
  cellId: string,
  editor: NotebookEditor,
  input: string,
  languageId: string = 'sh',
  background: boolean = false,
  run: boolean = true,
) {
  const cell = await getCellById({ editor, id: cellId })
  if (!cell) {
    throw new Error('Cell not found')
  }
  await insertCodeNotebookCell({
    cell,
    input,
    displayConfirmationDialog: false,
    languageId,
    background,
    run,
  })
}

export async function insertCodeNotebookCell({
  cell,
  input,
  displayConfirmationDialog,
  languageId,
  background,
  run,
}: InsertCodeCellOptions) {
  if (displayConfirmationDialog) {
    const answer = await window.showInformationMessage(
      "Do you want to add a new cell to demonstrate referencing this cell's output?",
      { modal: true },
      'Yes',
      'No',
    )
    if (answer !== 'Yes') {
      return
    }
  }

  const newCellData = new NotebookCellData(NotebookCellKind.Code, input, languageId)
  newCellData.metadata = {
    background,
  }
  const notebookEdit = NotebookEdit.insertCells(cell.index + 1, [newCellData])
  const edit = new WorkspaceEdit()
  edit.set(cell.notebook.uri, [notebookEdit])
  workspace.applyEdit(edit)
  await commands.executeCommand('notebook.focusNextEditor')
  if (!run) {
    return
  }
  await commands.executeCommand('notebook.cell.execute')
  await commands.executeCommand('notebook.cell.focusInOutput')
}
