import * as vscode from 'vscode'
import * as agent_pb from '@buf/runmedev_foyle.bufbuild_es/foyle/v1alpha1/agent_pb'
import { StreamGenerateRequest_Trigger } from '@buf/runmedev_foyle.bufbuild_es/foyle/v1alpha1/agent_pb'
import { workspace } from 'vscode'
import { share, Subject } from 'rxjs'

import getLogger from '../logger'
import { RUNME_CELL_ID } from '../constants'
import * as protos from '../grpc/parser/protos'

import * as stream from './stream'
import { SessionManager } from './sessions'
import { getEventReporter } from './events'
import { cellProtosToCellData, cellToCellData, Converter } from './converters'

const log = getLogger()

// n.b. using the prefix _ or runme.dev indicates the metadata is ephemeral and shouldn't
// be persisted to the markdown file. This ensures that if a ghost cell is accepted
// the ghost metadata is not persisted to the markdown file.
export const ghostKey = '_ghostCell'
export const ghostCellKindKey = '_ghostCellKind'

// Schemes are defined at
// https://github.com/microsoft/vscode/blob/a56879c50db91715377005d6182d12742d1ba5c7/src/vs/base/common/network.ts#L64
export const vsCodeCellScheme = 'vscode-notebook-cell'

// vsCodeOutputScheme is the scheme for the output window (not cell outputs).
// The output window is where the logs for Runme are displayed.
export const vsCodeOutputScheme = 'output'

const ghostDecoration = vscode.window.createTextEditorDecorationType({
  color: '#888888', // Light grey color
})

type ProgressReport = {
  message?: string
  increment?: number
}

export type RequestProgressReport = {
  requestID: number
  progress: ProgressReport
}

// TODO(jeremy): How do we handle multiple notebooks? Arguably you should only be generating
// completions for the active notebook. So as soon as the active notebook changes we should
// stop generating completions for the old notebook and start generating completions for the new notebook.

// GhostCellGenerator is a class that generates completions for a notebook cell.
// This class implements the stream.CompletionHandlers. It is responsible
// for generating a request to the AIService given an event and it is
// also responsible for applying the changes to the notebook.
//
// Generating a request to the AIService is stateful because the data that gets sent
// depends on whether this is the first request for a given selected cell in which
// case we send the full notebook or if it is an incremental change because
// the cell contents have changed.
export class GhostCellGenerator implements stream.CompletionHandlers {
  private notebookState: Map<vscode.Uri, NotebookState>
  private converter: Converter
  // contextID is the ID of the context we are generating completions for.
  // It is used to detect whether a completion response is stale and should be
  // discarded because the context has changed.

  // _progress is like an event that is fired when progress is made.
  private _progress = new Subject<RequestProgressReport>()
  private requestID = 0
  get progress() {
    return this._progress.pipe(share())
  }

  constructor(converter: Converter) {
    this.notebookState = new Map<vscode.Uri, NotebookState>()
    // Generate a random context ID. This should be unnecessary because presumable the event to change
    // the active cell will be sent before any requests are sent but it doesn't hurt to be safe.
    this.converter = converter
  }

  protected reportProgress(report: ProgressReport) {
    if (report.increment === 0) {
      this.requestID++
    }
    this._progress.next({
      requestID: this.requestID,
      progress: report,
    })
  }

  // Updated method to check and initialize notebook state
  private getNotebookState(notebook: vscode.NotebookDocument): NotebookState {
    if (!this.notebookState.has(notebook.uri)) {
      this.notebookState.set(notebook.uri, new NotebookState())
    }
    return this.notebookState.get(notebook.uri)!
  }

  private async getNotebook(notebookUri: string): Promise<vscode.NotebookDocument> {
    // TODO(jeremy): Is there a more efficient way to find the cell and notebook?
    // Can we cache it in the class? Since we keep track of notebooks in NotebookState
    // Is there a way we can go from the URI of the cell to the URI of the notebook directly
    const notebook = workspace.notebookDocuments.find((notebook) => {
      // We need to do the comparison on the actual values so we use the string.
      // If we just used === we would be checking if the references are to the same object.
      return notebook.uri.toString() === notebookUri
    })

    // Irrecoverable error
    if (notebook === undefined) {
      // It's error or value (null) not both due to execptions in JS
      throw new Error(`notebook for cell ${notebookUri} NOT found`)
    }

    return notebook
  }

  // textDocumentChangeEventToCompletionRequest converts a VSCode TextDocumentChangeEvent to a Request proto.
  // This is a stateful transformation because we need to decide whether to send the full document or
  // the incremental changes.  It will return a null request if the event should be ignored or if there
  // is an error preventing it from computing a proper request.
  async buildRequest(
    cellChangeEvent: stream.CellChangeEvent,
    firstRequest: boolean,
  ): Promise<agent_pb.StreamGenerateRequest> {
    const notebook = await this.getNotebook(cellChangeEvent.notebookUri)

    // Get the notebook state; this will initialize it if this is the first time we
    // process an event for this notebook.
    const nbState = this.getNotebookState(notebook)

    // TODO(jeremy): We should probably add the cellUri to the event so we can verify the cell URI matches
    const matchedCell = notebook.cellAt(cellChangeEvent.cellIndex)

    let newCell = false
    // Has the cell changed since the last time we processed an event?
    // TODO(https://github.com/jlewi/foyle/issues/312): I think there's an edge case where we don't
    // correctly detect that the cell has changed and a new stream needs to be initiated.
    newCell = true
    if (nbState.activeCell?.document.uri === matchedCell?.document?.uri) {
      newCell = false
    }

    log.info(
      `buildRequest: is newCell: ${newCell} , firstRequest: ${firstRequest}, trigger ${cellChangeEvent.trigger}`,
    )

    this.reportProgress({ message: 'Analyzing cell changes', increment: 0 })

    // Update notebook state
    nbState.activeCell = matchedCell
    this.notebookState.set(notebook.uri, nbState)

    let request: agent_pb.StreamGenerateRequest

    if (newCell || firstRequest) {
      // Generate a new request

      // Notebook uses the vscode interface types NotebookDocument and NotebookCell. We
      // need to convert this to NotebookCellData which is the concrete type used by the serializer.
      // This allows us to reuse the existing serializer code.
      const cellData = notebook.getCells().map((cell) => {
        return cellToCellData(cell)
      })
      const notebookData = new vscode.NotebookData(cellData)

      const notebookProto = await this.converter.notebookDataToProto(notebookData)
      request = new agent_pb.StreamGenerateRequest({
        contextId: SessionManager.getManager().getID(),
        trigger: cellChangeEvent.trigger,
        request: {
          case: 'fullContext',
          value: new agent_pb.FullContext({
            notebook: notebookProto,
            selected: matchedCell.index,
            notebookUri: notebook.uri.toString(),
          }),
        },
      })
    } else {
      // Generate update request instead
      request = await this.buildUpdateRequest(notebook, cellChangeEvent)
    }

    this.reportProgress({ message: 'Generating ghost cells', increment: 40 })

    return request
  }

  async buildRequestForDebounce(
    cellChangeEvent: stream.CellChangeEvent,
  ): Promise<agent_pb.StreamGenerateRequest> {
    const notebook = await this.getNotebook(cellChangeEvent.notebookUri)
    return this.buildUpdateRequest(notebook, cellChangeEvent)
  }

  // Generates update request
  private async buildUpdateRequest(
    notebook: vscode.NotebookDocument,
    cellChangeEvent: stream.CellChangeEvent,
  ) {
    const matchedCell = notebook.cellAt(cellChangeEvent.cellIndex)

    const cellData = cellToCellData(matchedCell)
    const notebookData = new vscode.NotebookData([cellData])

    const notebookProto = await this.converter.notebookDataToProto(notebookData)
    const request = new agent_pb.StreamGenerateRequest({
      contextId: SessionManager.getManager().getID(),
      trigger: cellChangeEvent.trigger,
      request: {
        case: 'update',
        value: new agent_pb.UpdateContext({
          cell: notebookProto.cells[0],
        }),
      },
    })

    return request
  }

  // processResponse applies the changes from the response to the notebook.
  processResponse(response: agent_pb.StreamGenerateResponse) {
    if (response.contextId !== SessionManager.getManager().getID()) {
      // TODO(jeremy): Is this logging too verbose?
      log.info(
        `Ignoring response with contextID ${response.contextId} because it doesn't match the current contextID ${SessionManager.getManager().getID()}`,
      )
      return
    }

    let cellsTs = protos.cellsESToTS(response.cells)
    let newCellData = cellProtosToCellData(cellsTs)

    const edit = new vscode.WorkspaceEdit()
    const edits: vscode.NotebookEdit[] = []

    if (response.notebookUri === undefined || response.notebookUri.toString() === '') {
      log.error('notebookUri is undefined')
      return
    }

    const notebook = vscode.workspace.notebookDocuments.find((notebook) => {
      return notebook.uri.toString() === response.notebookUri
    })

    if (notebook === undefined) {
      // Could this happen e.g because the notebook was closed?
      console.log(`notebook for cell ${response.notebookUri} NOT found`)
      return
    }

    this.reportProgress({ message: 'Inserting ghost cells', increment: 40 })

    // We want to insert the new cells and get rid of any existing ghost cells.
    // The old cells may not be located at the same location as the new cells.
    // So we don't use replace.
    const startIndex = response.insertAt
    notebook.getCells().forEach((cell) => {
      if (isGhostCell(cell)) {
        const deleteCells = vscode.NotebookEdit.deleteCells(
          new vscode.NotebookRange(cell.index, cell.index + 1),
        )
        edits.push(deleteCells)
      }
    })

    // Mark all newCells as ghost cells
    newCellData.forEach((cell) => {
      if (cell.metadata === undefined) {
        cell.metadata = {}
      }
      cell.metadata[ghostKey] = true

      if (cell.kind === vscode.NotebookCellKind.Markup) {
        // In order to render markup cells as ghost cells we need to convert them to code cells.
        // Otherwise they don't get inserted in edit mode and we can't apply the decoration.
        cell.metadata[ghostCellKindKey] = GhostCellKind.Markdown
        cell.languageId = 'markdown'
        cell.kind = vscode.NotebookCellKind.Code
      } else {
        cell.metadata[ghostCellKindKey] = GhostCellKind.Code
      }
    })

    const insertCells = vscode.NotebookEdit.insertCells(startIndex, newCellData)
    edits.push(insertCells)
    edit.set(notebook.uri, edits)
    vscode.workspace.applyEdit(edit).then((result: boolean) => {
      log.trace(`applyedit resolved with ${result}`)

      this.reportProgress({ message: 'Ghost cells completed', increment: 20 })

      // Apply renderings to the newly inserted ghost cells
      // TODO(jeremy): We are just assuming that activeNotebookEditor is the correct editor
      if (vscode.window.activeNotebookEditor?.notebook.uri !== notebook.uri) {
        log.error('activeNotebookEditor is not the same as the notebook that was edited')
      }
      if (!result) {
        log.error('applyEdit failed')
        return
      }
    })
  }

  // handleOnDidChangeActiveTextEditor updates the ghostKey cell decoration and rendering
  // when it is selected
  handleOnDidChangeActiveTextEditor = (editor: vscode.TextEditor | undefined) => {
    const oldCID = SessionManager.getManager().getID()
    // We need to generate a new context ID because the context has changed.
    const contextID = SessionManager.getManager().newID()
    log.info(
      `onDidChangeActiveTextEditor fired: editor: ${editor?.document.uri}; new contextID: ${contextID}; old contextID: ${oldCID}`,
    )
    if (editor === undefined) {
      return
    }

    // Are schemes defined here:
    // https://github.com/microsoft/vscode/blob/a56879c50db91715377005d6182d12742d1ba5c7/src/vs/base/common/network.ts#L64
    if (editor.document.uri.scheme !== 'vscode-notebook-cell') {
      // Doesn't correspond to a notebook cell so do nothing
      return
    }

    // So if we want to delete any ghost cells when the active editor changes
    // Then we should loop over all the cells and if its a ghost cell do one of two
    // things select it if its the active cell and delete it otherwise

    let edits: vscode.NotebookEdit[] = []

    vscode.window.activeNotebookEditor?.notebook.getCells().forEach((cell) => {
      if (!isGhostCell(cell)) {
        // Since this cell isn't a ghost cell do nothing
        return
      }

      // Its a ghost cell. We will do one of two things
      // If its the newly selected cell we select it which means rendering it as non ghost
      // Otherwise we are deleting the cell.

      if (cell.document === editor.document) {
        const ghostKind = getGhostCellKind(cell)
        if (ghostKind === GhostCellKind.Markdown) {
          // Since this is actually a markdown cell we need to replace the cell in order to convert it
          // to a markdown cell.
          edits.push(markupCellAsNonGhost(cell))
        } else if (cell.kind === vscode.NotebookCellKind.Code) {
          // ...cell.metadata creates a shallow copy of the metadata object
          const updatedMetadata = { ...cell.metadata, [ghostKey]: false }
          const update = vscode.NotebookEdit.updateCellMetadata(cell.index, updatedMetadata)
          edits.push(update)
          // If the cell is a ghost cell we want to remove the decoration
          // and replace it with a non-ghost cell.
          editorAsNonGhost(editor)
        }

        // Log the acceptance of the cell
        const event = new agent_pb.LogEvent()
        event.type = agent_pb.LogEventType.ACCEPTED
        event.contextId = oldCID
        event.selectedId = cell.metadata?.[RUNME_CELL_ID]
        event.selectedIndex = cell.index
        getEventReporter().reportEvents([event])
      } else {
        // Its a ghost cell that is not selected so we want to get rid of it.
        const deleteCells = vscode.NotebookEdit.deleteCells(
          new vscode.NotebookRange(cell.index, cell.index + 1),
        )
        edits.push(deleteCells)
      }
    })

    if (edits.length === 0) {
      return
    }
    const edit = new vscode.WorkspaceEdit()
    edit.set(editor.document.uri, edits)

    vscode.workspace.applyEdit(edit).then((result: boolean) => {
      log.trace(`resolving ghost cells failed with ${result}`)
      if (!result) {
        log.error('applyEdit failed')
        return
      }
    })
  }

  shutdown(): void {
    log.info('Shutting down')
  }
}

// NotebookState keeps track of state information for a given notebook.
class NotebookState {
  public activeCell: vscode.NotebookCell | null
  constructor() {
    this.activeCell = null
  }
}

// CellChangeEventGenerator is a class that generates events when a cell changes.
// It converts vscode.TextDocumentChangeEvents into a stream.CellChangeEvent
// and then enques them in the StreamCreator.
export class CellChangeEventGenerator {
  streamCreator: stream.StreamCreator

  constructor(streamCreator: stream.StreamCreator) {
    this.streamCreator = streamCreator
  }

  handleOnDidChangeNotebookCell = async (event: vscode.TextDocumentChangeEvent) => {
    if (![vsCodeCellScheme].includes(event.document.uri.scheme)) {
      return
    }
    var matchedCell: vscode.NotebookCell | undefined

    // TODO(jeremy): Is there a more efficient way to find the cell and notebook?
    // Could we cache it somewhere.
    const notebook = vscode.workspace.notebookDocuments.find((notebook) => {
      const cell = notebook.getCells().find((cell) => cell.document === event.document)
      const result = Boolean(cell)
      if (cell !== undefined) {
        matchedCell = cell
      }
      return result
    })
    if (notebook === undefined) {
      log.error(`notebook for cell ${event.document.uri} NOT found`)
      return
    }

    if (matchedCell === undefined) {
      log.error(`cell for document ${event.document.uri} NOT found`)
      return
    }

    await this.streamCreator.handleEvent(
      new stream.CellChangeEvent(
        notebook.uri.toString(),
        matchedCell.index,
        StreamGenerateRequest_Trigger.CELL_TEXT_CHANGE,
      ),
    )
  }

  // handleOnDidChangeVisibleTextEditors is called when the visible text editors change.
  // This includes when a TextEditor is created. I also think it can be the result of scrolling.
  // When cells become visible we need to apply ghost decorations.
  //
  // This event is also fired when a code cell is executed and its output becomes visible.
  // We use that to trigger completion generation because we want the newly rendered code
  // cell output to affect the suggestions.
  handleOnDidChangeVisibleTextEditors = (editors: readonly vscode.TextEditor[]) => {
    for (const editor of editors) {
      if (![vsCodeCellScheme].includes(editor.document.uri.scheme)) {
        // Doesn't correspond to a notebook or output cell so do nothing
        continue
      }

      const cell = getCellFromCellDocument(editor.document)
      if (cell === undefined) {
        continue
      }

      if (!isGhostCell(cell)) {
        continue
      }

      editorAsGhost(editor)
    }
  }
}

// editorAsGhost decorates an editor as a ghost cell.
function editorAsGhost(editor: vscode.TextEditor) {
  const textDoc = editor.document
  const range = new vscode.Range(
    textDoc.positionAt(0),
    textDoc.positionAt(textDoc.getText().length),
  )

  editor.setDecorations(ghostDecoration, [range])
}

function editorAsNonGhost(editor: vscode.TextEditor) {
  // To remove the decoration we set the range to an empty range and pass in a reference
  // to the original decoration
  // https://github.com/microsoft/vscode-extension-samples/blob/main/decorator-sample/USAGE.md#tips
  //
  // Important: ghostDecoration must be a reference to the same object that was used to create the decoration.
  // that's how VSCode knows which decoration to remove. If you use a "copy" (i.e. a decoration with the same value)
  // the decoration won't get removed.
  editor.setDecorations(ghostDecoration, [])
}

function isGhostCell(cell: vscode.NotebookCell): boolean {
  const metadata = cell.metadata
  return metadata?.[ghostKey] === true
}

enum GhostCellKind {
  Code = 'CODE',
  Markdown = 'MARKDOWN',
  None = 'NONE',
}

// getGhostCellKind returns the kind of cell that should be used for a ghost cell.
function getGhostCellKind(cell: vscode.NotebookCell): GhostCellKind {
  const metadata = cell.metadata
  if (metadata === undefined) {
    return GhostCellKind.None
  }
  if (metadata[ghostCellKindKey] === undefined) {
    return GhostCellKind.None
  }
  return metadata[ghostCellKindKey]
}

// getCellFromCellDocument returns the notebook cell that corresponds to a given text document.
// We do this by iterating over all notebook documents and cells to find the cell that has the same URI as the
// text document.
// TODO(jeremy): Should we cache this information?
function getCellFromCellDocument(textDoc: vscode.TextDocument): vscode.NotebookCell | undefined {
  var matchedCell: vscode.NotebookCell | undefined
  // TODO(jeremy): This seems very inefficient. We are searching overall cells in all notebooks.
  // Is there a way to loop over the documents?
  vscode.workspace.notebookDocuments.find((notebook) => {
    const cell = notebook.getCells().find((cell) => cell.document === textDoc)
    const result = Boolean(cell)
    if (cell !== undefined) {
      matchedCell = cell
    }
    return result
  })
  return matchedCell
}

// markupCellAsNonGhost replaces a ghost markup cell with a non-ghost cell.
// Since we render the markup cell as a code cell in order to make the ghost rendering apply
// to the markup cell we need to replace the cell in order to change the cell type back to markdown.
function markupCellAsNonGhost(cell: vscode.NotebookCell): vscode.NotebookEdit {
  // ...cell.metadata creates a shallow copy of the metadata object
  const updatedMetadata = { ...cell.metadata, [ghostKey]: false }
  const newCell = new vscode.NotebookCellData(
    vscode.NotebookCellKind.Markup, // New cell type (code or markdown)
    cell.document.getText(), // Cell content
    cell.document.languageId, // Language of the cell content
  )

  newCell.metadata = updatedMetadata
  const notebook = cell.notebook
  const index = notebook.getCells().indexOf(cell)

  const editReplace = vscode.NotebookEdit.replaceCells(new vscode.NotebookRange(index, index + 1), [
    newCell,
  ])

  return editReplace
}
