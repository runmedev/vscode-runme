// Conversion routines between the protocol buffer format and VSCode's representation of a notebook
//
// See ../vscode_apis.md for an exlanation. It is very helpful for understanding this folder.

import * as vscode from 'vscode'
import * as parser_pb from '@buf/runmedev_runme.bufbuild_es/runme/parser/v1/parser_pb'

import { ServerLifecycleIdentity, getServerConfigurationValue } from '../../utils/configuration'
import { Serializer } from '../../types'
import { ConnectSerializer } from '../serializer'
import * as parserTypes from '../grpc/parser/tcp/types'
import * as serializer from '../serializer'
import { Kernel } from '../kernel'

// Converter provides converstion routines from vscode data types to protocol buffer types.
// It is a class because in order to handle the conversion we need to keep track of the kernel
// because we need to add execution information to the cells before serializing.
export class Converter {
  kernel: Kernel
  constructor(kernel: Kernel) {
    this.kernel = kernel
  }

  // notebokDataToProto converts a VSCode NotebookData to a RunMe Notebook proto.
  // It adds execution information to the cells before converting.
  public async notebookDataToProto(notebookData: vscode.NotebookData): Promise<parser_pb.Notebook> {
    // We need to add the execution info to the cells so that the AI model can use that information.
    const cellDataWithExec = await serializer.addExecInfo(notebookData, this.kernel)
    let notebookDataWithExec = new vscode.NotebookData(cellDataWithExec)
    // marshalNotebook returns a protocol buffer using the ts client library from buf we need to
    // convert it to es
    return ConnectSerializer.marshalNotebook(notebookDataWithExec)
  }
}

// cellToCellData converts a NotebookCell to a NotebookCellData.
// NotebookCell is an interface used by the editor.
// NotebookCellData is a concrete class.
// For more explanation of the different vscode APIs see
// https://github.com/jlewi/foyle/blob/main/frontend/foyle/vscode_apis.md
export function cellToCellData(cell: vscode.NotebookCell): vscode.NotebookCellData {
  let data = new vscode.NotebookCellData(
    cell.kind,
    cell.document.getText(),
    cell.document.languageId,
  )

  data.metadata = cell.metadata
  data.outputs = []
  for (let o of cell.outputs) {
    data.outputs.push(o)
  }
  return data
}

// cellProtosToCellData converts an array of RunMe cell protos to an array of VSCode CellData
export function cellProtosToCellData(cells: parserTypes.Cell[]): vscode.NotebookCellData[] {
  let notebook: Serializer.Notebook = {
    cells: [],
  }
  for (let cell of cells) {
    let kind: vscode.NotebookCellKind = vscode.NotebookCellKind.Markup

    if (cell.kind === parserTypes.CellKind.CODE) {
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
    parserTypes.RunmeIdentity.ALL,
  )
  let newCellData = ConnectSerializer.revive(notebook, Number(identity))
  return newCellData
}

// vsCellsToESProto converts a VSCode NotebookCell to a RunMe Cell proto
// Its not quite the inverse of cellProtosToCellData because this function
// uses the ES client library as opposed to the TS client library.
// The reason we don't rely on the serialization routines is we don't want to
// generate an RPC just to convert the cell to a proto.
export function vsCellsToESProtos(cells: vscode.NotebookCell[]): parser_pb.Cell[] {
  const cellProtos: parser_pb.Cell[] = []

  for (let cell of cells) {
    const cellProto = new parser_pb.Cell()
    if (cell.kind === vscode.NotebookCellKind.Code) {
      cellProto.kind = parser_pb.CellKind.CODE
    } else if (cell.kind === vscode.NotebookCellKind.Markup) {
      cellProto.kind = parser_pb.CellKind.MARKUP
    }

    cellProto.value = cell.document.getText()
    cellProto.metadata = cell.metadata

    cellProtos.push(cellProto)
  }

  return cellProtos
}
