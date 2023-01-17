import {
  Disposable, notebooks, window, workspace, ExtensionContext,
  NotebookEditor, NotebookCell, NotebookCellKind, NotebookCellExecution, WorkspaceEdit, NotebookEdit
} from 'vscode'

import type { ClientMessage } from '../types'
import { ClientMessages } from '../constants'
import { API } from '../utils/deno/api'

import executor, { runme } from './executors'
import { ExperimentalTerminal } from './terminal/terminal'
import { ENV_STORE, DENO_ACCESS_TOKEN_KEY } from './constants'
import { resetEnv, getKey, getAnnotations } from './utils'

import './wasm/wasm_exec.js'

enum ConfirmationItems {
  Yes = 'Yes',
  No = 'No',
  Skip = 'Skip Prompt and run all',
  Cancel = 'Cancel'
}

export class Kernel implements Disposable {
  static readonly type = 'runme' as const

  readonly hasAnnotationsEditExperimentEnabled: boolean

  #terminals = new Map<string, ExperimentalTerminal>
  #disposables: Disposable[] = []
  #controller = notebooks.createNotebookController(
    Kernel.type,
    Kernel.type,
    Kernel.type.toUpperCase()
  )
  protected messaging = notebooks.createRendererMessaging('runme-renderer')

  constructor(protected context: ExtensionContext) {
    const config = workspace.getConfiguration('runme.experiments')
    this.hasAnnotationsEditExperimentEnabled = config.get<boolean>('annotationsEdit', false)

    this.#controller.supportedLanguages = Object.keys(executor)
    this.#controller.supportsExecutionOrder = false
    this.#controller.description = 'Run your README.md'
    this.#controller.executeHandler = this._executeAll.bind(this)

    this.messaging.postMessage({ from: 'kernel' })
    this.#disposables.push(
      this.messaging.onDidReceiveMessage(this.#handleRendererMessage.bind(this)),
      window.onDidChangeActiveNotebookEditor(this.#handleRunmeTerminals.bind(this)),
    )
  }

  dispose () {
    resetEnv()
    this.#controller.dispose()
    this.#disposables.forEach((d) => d.dispose())
  }

  // eslint-disable-next-line max-len
  async #handleRendererMessage({ editor, message }: { editor: NotebookEditor, message: ClientMessage<ClientMessages> }) {
    if (message.type === ClientMessages.mutateAnnotations) {
      const payload = message as ClientMessage<ClientMessages.mutateAnnotations>

      let editCell: NotebookCell | undefined = undefined
      for (const document of workspace.notebookDocuments) {
        for (const cell of document.getCells()) {
          if (cell.document.uri.fsPath !== editor.notebook.uri.fsPath) {
            break
          }

          if (cell.metadata?.['runme.dev/uuid'] === payload.output.annotations['runme.dev/uuid']) {
            editCell = cell
            break
          }
        }

        if (editCell) {
          break
        }
		}

      if (editCell) {
        const edit = new WorkspaceEdit()
        const newMetadata = {
          ...editCell.metadata,
          ...payload.output.annotations,
        }
        const notebookEdit = NotebookEdit.updateCellMetadata(editCell.index, newMetadata)

        edit.set(editCell.notebook.uri, [notebookEdit])
        await workspace.applyEdit(edit)
      }

      return
    } else if (message.type === ClientMessages.promote) {
      const payload = message as ClientMessage<ClientMessages.promote>
      const token = ENV_STORE.get(DENO_ACCESS_TOKEN_KEY)
      if (!token) {
        return
      }

      const api = API.fromToken(token)
      const deployed = await api.promoteDeployment(payload.output.id, payload.output.productionDeployment)
      this.messaging.postMessage(<ClientMessage<ClientMessages.deployed>>{
        type: ClientMessages.deployed,
        output: deployed
      })
    } else if (message.type === ClientMessages.prod) {
      const payload = message as ClientMessage<ClientMessages.prod>
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const cell = editor.notebook.cellAt(payload.output.cellIndex)
      if (cell.executionSummary?.success) {
        process.env['vercelProd'] = 'true'
        return this._doExecuteCell(cell)
      }
    } else if (message.type === ClientMessages.infoMessage) {
      return window.showInformationMessage(message.output as string)
    } else if (message.type === ClientMessages.errorMessage) {
      return window.showInformationMessage(message.output as string)
    }

    console.error(`[Runme] Unknown kernel event type: ${message.type}`)
  }

  private async _executeAll(cells: NotebookCell[]) {
    const totalNotebookCells = (
      cells[0] &&
      cells[0].notebook.getCells().filter((cell) => cell.kind === NotebookCellKind.Code).length
    ) || 0
    const totalCellsToExecute = cells.length
    let showConfirmPrompt = totalNotebookCells === totalCellsToExecute && totalNotebookCells > 1

    for (const cell of cells) {
      if (showConfirmPrompt) {
        const annotations = getAnnotations(cell)
        const cellText = cell.document.getText()
        const cellLabel = (
          annotations.name ||
          cellText.length > 20 ? `${cellText.slice(0, 20)}...` : cellText
        )

        const answer = await window.showQuickPick(Object.values(ConfirmationItems), {
          title: `Are you sure you like to run "${cellLabel}"?`,
          ignoreFocusOut: true
        }) as ConfirmationItems | undefined

        if (answer === ConfirmationItems.No) {
          continue
        }

        if (answer === ConfirmationItems.Skip) {
          showConfirmPrompt = false
        }

        if (answer === ConfirmationItems.Cancel) {
          return
        }
      }

      await this._doExecuteCell(cell)
    }
  }

  public async createCellExecution(cell: NotebookCell): Promise<NotebookCellExecution> {
    return this.#controller.createNotebookCellExecution(cell)
  }

  private async _doExecuteCell(cell: NotebookCell): Promise<void> {
    const runningCell = await workspace.openTextDocument(cell.document.uri)
    const exec = await this.createCellExecution(cell)

    exec.start(Date.now())
    let execKey = getKey(runningCell)

    /**
     * check if user is running experiment to execute shell via runme cli
     */
    const config = workspace.getConfiguration('runme.experiments')
    const hasPsuedoTerminalExperimentEnabled = config.get<boolean>('pseudoterminal')
    const terminal = this.#terminals.get(cell.document.uri.fsPath)
    const successfulCellExecution = (hasPsuedoTerminalExperimentEnabled && terminal)
      ? await runme.call(this, exec, terminal)
      : await executor[execKey].call(this, exec, runningCell)
    exec.end(successfulCellExecution)
  }

  #handleRunmeTerminals (editor?: NotebookEditor) {
    // Todo(Christian): clean up
    if (!editor) {
      return
    }

    /**
     * Runme terminal for notebook already launched
     */
    if (this.#terminals.has(editor.notebook.uri.fsPath)) {
      return
    }

    const runmeTerminal = new ExperimentalTerminal(editor.notebook)
    this.#terminals.set(editor.notebook.uri.fsPath, runmeTerminal)
  }
}
