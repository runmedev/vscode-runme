import * as vscode from 'vscode'
import { PromiseClient } from '@connectrpc/connect'
import { AIService } from '@buf/jlewi_foyle.connectrpc_es/foyle/v1alpha1/agent_connect'
import {
  GenerateCellsRequest,
  GenerateCellsResponse,
} from '@buf/jlewi_foyle.bufbuild_es/foyle/v1alpha1/agent_pb'

import * as serializer from '../serializer'
import getLogger from '../logger'

import * as protos from './protos'
import * as converters from './converters'
const log = getLogger('AIGenerate')

// CompletionGenerator is a class that generates completions for a notebook.
// It generates a single completion
export class CompletionGenerator {
  client: PromiseClient<typeof AIService>

  constructor(client: PromiseClient<typeof AIService>) {
    this.client = client
  }

  public generateCompletion = async () => {
    const editor = vscode.window.activeNotebookEditor

    if (!editor) {
      return
    }

    if (editor?.selection.isEmpty) {
      return
    }

    // We subtract 1 because end is non-inclusive
    const lastSelectedCell = editor?.selection.end - 1
    log.trace(`generateCompletion: lastSelectedCell: ${lastSelectedCell}`)

    // Notebook uses the vscode interface types NotebookDocument and NotebookCell. We
    // need to convert this to NotebookCellData which is the concrete type used by the serializer.
    // This allows us to reuse the existing serializer code.
    let cellData = editor?.notebook.getCells().map((cell) => converters.cellToCellData(cell))
    let notebookData = new vscode.NotebookData(cellData)

    let notebookProto = serializer.GrpcSerializer.marshalNotebook(notebookData)

    const req = new GenerateCellsRequest()
    req.notebook = protos.notebookTSToES(notebookProto)
    req.selectedIndex = lastSelectedCell

    this.client
      .generateCells(req)
      .then((response) => {
        // TODO(jeremy): We should have the server add the traceId to the response and then we should
        // log it here. This is for debugging purposes as it allows to easily link to the logs
        log.info('Generate request succeeded traceId')

        const insertCells = addAIGeneratedCells(lastSelectedCell + 1, response)

        const edit = new vscode.WorkspaceEdit()
        const notebookUri = editor?.notebook.uri
        edit.set(notebookUri, [insertCells])
        vscode.workspace.applyEdit(edit).then((result: boolean) => {
          log.trace(`applyedit resolved with ${result}`)
        })
      })
      .catch((error) => {
        log.error(`AI Generate request failed ${error}`)
        return
      })
  }
}

// addAIGeneratedCells turns the response from the AI model into a set of cells that can be inserted into the notebook.
// This is done by returning a mutation to add the new cells to the notebook.
// index is the position in the notebook at which the new the new cells should be inserted.
//
function addAIGeneratedCells(index: number, response: GenerateCellsResponse): vscode.NotebookEdit {
  let newCellData = converters.cellProtosToCellData(protos.cellsESToTS(response.cells))
  // Now insert the new cells at the end of the notebook
  return vscode.NotebookEdit.insertCells(index, newCellData)
}
