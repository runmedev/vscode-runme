import * as vscode from 'vscode'

import { GenerateCellsRequest, GenerateCellsResponse } from '../grpc/aiTypes'
import * as serializer from '../serializer'
import { Serializer } from '../../types'
import getLogger from '../logger'
import { initAIServiceClient } from '../grpc/aiClient'
import { AIServiceClient } from '../grpc/aiTypes'
import { CellKind, RunmeIdentity } from '../grpc/serializerTypes'
import { ServerLifecycleIdentity, getServerConfigurationValue } from '../../utils/configuration'

import * as converters from './converters'
const log = getLogger('AIGenerate')

const clients = new Map<string, AIServiceClient>()

const extName = 'runme'

export async function generateCompletion() {
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

  const req = GenerateCellsRequest.create()
  req.notebook = notebookProto

  const config = vscode.workspace.getConfiguration(extName)
  // Include a default so that address is always well defined
  const address = config.get<string>('foyleAddress', 'localhost:9080')

  let client = clients.get(address)
  if (!client) {
    log.info(`Creating new client for address: ${address}`)
    client = initAIServiceClient(address)
    clients.set(address, client)
  }

  client
    .generateCells(req)
    .then((finished) => {
      let response = finished.response
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

// addAIGeneratedCells turns the response from the AI model into a set of cells that can be inserted into the notebook.
// This is done by returning a mutation to add the new cells to the notebook.
// index is the position in the notebook at which the new the new cells should be inserted.
function addAIGeneratedCells(index: number, response: GenerateCellsResponse): vscode.NotebookEdit {
  let notebook: Serializer.Notebook = {
    cells: [],
  }
  for (let cell of response.cells) {
    let kind: vscode.NotebookCellKind = vscode.NotebookCellKind.Markup

    if (cell.kind === CellKind.CODE) {
      kind = vscode.NotebookCellKind.Code
    }

    let newCell: Serializer.Cell = {
      value: cell.value,
      metadata: cell.metadata,
      kind: kind,
      languageId: cell.languageId,
      // TODO(jeremy): Should we include outputs? The generate response should never contain outputs so we shouldn't
      // have to worry about them.
    }
    notebook.cells.push(newCell)
  }

  const identity: ServerLifecycleIdentity = getServerConfigurationValue<ServerLifecycleIdentity>(
    'lifecycleIdentity',
    RunmeIdentity.ALL,
  )
  let newCellData = serializer.SerializerBase.revive(notebook, identity)
  // Now insert the new cells at the end of the notebook
  return vscode.NotebookEdit.insertCells(index, newCellData)
}
