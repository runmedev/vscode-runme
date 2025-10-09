import * as parser_pb from '@buf/runmedev_runme.bufbuild_es/runme/parser/v1/parser_pb'

import * as parserTypes from './tcp/types'

// Convert from a notebook protobuf represented as protobuf-ts (https://github.com/timostamm/protobuf-ts/tree/main)
// to protobuf-es. See https://github.com/stateful/runme/issues/641.
export function notebookTSToES(left: parserTypes.Notebook): parser_pb.Notebook {
  try {
    // N.B. Notebook.toJson raises an exception
    let binaryValue = parserTypes.Notebook.toBinary(left)
    return parser_pb.Notebook.fromBinary(binaryValue)
  } catch (e) {
    console.log(`Failed to convert notebook; error :${e}`)
  }
  return new parser_pb.Notebook()
}

export function cellTSToES(left: parserTypes.Cell): parser_pb.Cell {
  let data = parserTypes.Cell.toBinary(left)
  return parser_pb.Cell.fromBinary(data)
}

export function cellsESToTS(left: parser_pb.Cell[]): parserTypes.Cell[] {
  let cells = []
  for (let cell of left) {
    let binaryValue = cell.toBinary()
    cells.push(parserTypes.Cell.fromBinary(binaryValue))
  }
  return cells
}
