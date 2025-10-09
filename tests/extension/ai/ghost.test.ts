import { vi, suite, test, expect } from 'vitest'
import { workspace } from 'vscode'
import * as agent_pb from '@buf/runmedev_foyle.bufbuild_es/foyle/v1alpha1/agent_pb'
import * as parser_pb from '@buf/runmedev_runme.bufbuild_es/runme/parser/v1/parser_pb'

import { GhostCellGenerator } from '../../../src/extension/ai/ghost'
import { cellToCellData } from '../../../src/extension/ai/converters'
import { CellChangeEvent } from '../../../src/extension/ai/stream'
import { Uri } from '../../../__mocks__/vscode'

const changeEvents: [CellChangeEvent, { debounced: boolean; firstRequest: boolean }][] = [
  [
    {
      notebookUri: 'h',
      cellIndex: 0,
      trigger: 1,
    },
    { debounced: true, firstRequest: false },
  ],
  [
    {
      notebookUri: 'he',
      cellIndex: 1,
      trigger: 1,
    },
    { debounced: true, firstRequest: false },
  ],
  [
    {
      notebookUri: 'hel',
      cellIndex: 2,
      trigger: 1,
    },
    { debounced: true, firstRequest: false },
  ],
  [
    {
      notebookUri: 'hell',
      cellIndex: 3,
      trigger: 1,
    },
    { debounced: true, firstRequest: false },
  ],
  [
    {
      notebookUri: 'hello',
      cellIndex: 4,
      trigger: 1,
    },
    { debounced: false, firstRequest: true },
  ],
  [
    {
      notebookUri: 'how',
      cellIndex: 5,
      trigger: 1,
    },
    { debounced: true, firstRequest: false },
  ],
  [
    {
      notebookUri: 'how are',
      cellIndex: 6,
      trigger: 1,
    },
    { debounced: true, firstRequest: false },
  ],
  [
    {
      notebookUri: 'how are you?',
      cellIndex: 7,
      trigger: 1,
    },
    { debounced: false, firstRequest: true },
  ],
  [
    {
      notebookUri: "Is it me you're looking for?",
      cellIndex: 8,
      trigger: 1,
    },
    { debounced: false, firstRequest: true },
  ],
  [
    {
      notebookUri: 'here we go',
      cellIndex: 9,
      trigger: 1,
    },
    { debounced: false, firstRequest: true },
  ],
  [
    {
      notebookUri: 'again',
      cellIndex: 10,
      trigger: 1,
    },
    { debounced: false, firstRequest: true },
  ],
  [
    {
      notebookUri: 'down the only road I have ever known',
      cellIndex: 11,
      trigger: 1,
    },
    { debounced: false, firstRequest: true },
  ],
]

const CELL: parser_pb.Cell = new parser_pb.Cell({
  kind: 1,
  value: '',
  languageId: 'markdown',
  outputs: [],
  metadata: {},
})

const NOTEBOOK = {
  cells: [CELL],
  metadata: {},
}

vi.mock('vscode')
vi.mock('vscode-telemetry')

vi.mock('../../../src/extension/grpc/client', () => ({}))
vi.mock('../../../src/extension/runner', () => ({}))

vi.mock('../../../src/extension/ai/converters', () => ({
  cellToCellData: vi.fn(),
}))

vi.mock('ulidx', () => {
  return {
    ulid: function () {
      return '01JHRGWFAKE5FAKE8FAKEWFAKE'
    },
  }
})

suite('GhostCellGenerator', () => {
  let c: parser_pb.Cell
  vi.mocked(workspace.notebookDocuments.find).mockImplementation(() => {
    return {
      uri: Uri.parse('test.md'),
      cellAt: vi.fn().mockImplementation((index) => {
        c = new parser_pb.Cell(CELL)
        const [event] = changeEvents[index]
        c.value = event.notebookUri
        return c
      }),
      getCells: vi.fn().mockReturnValue([c]),
    } as any
  })
  vi.mocked(cellToCellData).mockReturnValue({} as any)

  const Converter = class {
    notebookDataToProto = async () => {
      const n = { ...NOTEBOOK }
      n.cells = [c]
      return n
    }
  }

  test('Process events for debouncing', async () => {
    const gen = new GhostCellGenerator(new Converter() as any)
    const requests = await processEvents(async (event) => {
      const sequence = event.cellIndex
      const request = await gen.buildRequestForDebounce(event)
      return {
        sequence,
        request,
      }
    })

    expect(requests).toHaveLength(12)
    expect(requests).toMatchSnapshot()

    const cases = new Set(requests.map((r) => r.request.request.case))
    expect(cases).toEqual(new Set(['update']))
  })

  test('Build requests for event stream', async () => {
    const gen = new GhostCellGenerator(new Converter() as any)
    const requests = await processEvents(async (event, firstRequest) => {
      const sequence = event.cellIndex
      const request = await gen.buildRequest(event, firstRequest)
      return {
        sequence,
        request,
      }
    })

    expect(requests).toHaveLength(12)
    expect(requests).toMatchSnapshot()

    const cases = new Set(requests.map((r) => r.request.request.case))
    expect(cases).toEqual(new Set(['update', 'fullContext']))
  })
})

type TestEventSequence = {
  sequence: number
  request: agent_pb.StreamGenerateRequest
}

async function processEvents(
  process: (event: CellChangeEvent, firstRequest: boolean) => Promise<TestEventSequence>,
): Promise<Array<TestEventSequence>> {
  const requests = new Array<TestEventSequence>()

  for (const [event, { firstRequest }] of changeEvents) {
    const r = await process(event, firstRequest)

    if (r) {
      requests.push(r)
    }
  }
  return requests
}
