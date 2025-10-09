import { vi, test } from 'vitest'
import * as agent_pb from '@buf/runmedev_foyle.bufbuild_es/foyle/v1alpha1/agent_pb'
import * as parser_pb from '@buf/runmedev_runme.bufbuild_es/runme/parser/v1/parser_pb'
import { ulid } from 'ulidx'
import { AIService } from '@buf/runmedev_foyle.connectrpc_es/foyle/v1alpha1/agent_connect'
import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-node'

import getLogger from '../../../src/extension/logger'
import * as stream from '../../../src/extension/ai/stream'

const log = getLogger()

vi.mock('vscode', async () => {
  const vscode = await import('../../../__mocks__/vscode')
  return {
    default: vscode,
    ...vscode,
  }
})

// SWITCH got to be >500ms to escape typing debounce
const [SWITCH, TYPING] = [2000, undefined]
type EventsData = [string, number?][]
const eventsData: EventsData = [
  ['h', TYPING],
  ['he', TYPING],
  ['hel', TYPING],
  ['hell', TYPING],
  ['hello', SWITCH],
  // new cell
  ['stop', SWITCH],
  ['how', TYPING],
  ['how are', TYPING],
  ['how are you?', SWITCH],
  // new cell
  ['stop', SWITCH],
  ["Is it me you're looking for?", SWITCH],
  // new cell
  ['stop', SWITCH],
  ['here we go', SWITCH],
  ['again', SWITCH],
  ['down the only road I have ever known', SWITCH],
  // new cell
  ['done', SWITCH],
]

class FakeCompletion implements stream.CompletionHandlers {
  contextId = ''
  // Done is a promise which we use to signal to the test that we are done
  public done: Promise<void>
  resolveDone: () => void
  private stack: Array<() => Promise<void>> = []
  constructor(private readonly data: EventsData) {
    this.data = data
    this.done = new Promise<void>((resolve, _reject) => {
      this.resolveDone = resolve
    })
  }

  async runEvents(creator: stream.StreamCreator): Promise<void> {
    // Avoid overlapping runs by chaining the promises
    this.stack = this.data.map(([value, delay], i) => {
      return this.createCallback(creator, value, i, delay)
    })

    await this.next()
  }

  // take the top callback off the stack and run it
  async next(): Promise<void> {
    const callback = this.stack.shift()

    if (callback) {
      await callback()
      return
    }

    log.info('Stopping')
    this.shutdown()
  }

  // close loop out-of-band for debounced requests
  async skipAhead(): Promise<void> {
    await this.processResponse(new agent_pb.StreamGenerateResponse())
  }

  private createCallback(
    creator: stream.StreamCreator,
    value: string,
    index: number,
    delay?: number,
  ): () => Promise<void> {
    return async () => {
      const event = new stream.CellChangeEvent(
        value,
        index,
        agent_pb.StreamGenerateRequest_Trigger.CELL_TEXT_CHANGE,
      )

      // don't send values in these cases because Folye might "dropResponse"
      if (['stop', 'done'].includes(value)) {
        this.contextId = '' // force sending fullContext with next req
        await this.skipAhead()
        return
      }

      await creator.handleEvent(event)
      // Unless otherwise specified delay by 10 to simulate typing
      await this.delayBy(delay ?? 10)

      // close loop manually for simulated typing
      if (delay === undefined) {
        await this.skipAhead()
      }
    }
  }

  public delayBy(delay: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, delay)
    })
  }

  async buildRequest(
    cellChangeEvent: stream.CellChangeEvent,
    firstRequest: boolean,
  ): Promise<agent_pb.StreamGenerateRequest> {
    const handleNewCells = true
    console.log('Building request:', cellChangeEvent, firstRequest)

    // Decide that we need a new request
    if (handleNewCells && this.contextId === '') {
      firstRequest = true
    }

    const [data] = this.data[cellChangeEvent.cellIndex]

    let req: agent_pb.StreamGenerateRequest
    if (firstRequest && handleNewCells) {
      this.contextId = ulid()
      req = new agent_pb.StreamGenerateRequest({
        request: {
          case: 'fullContext',
          value: new agent_pb.FullContext({
            notebook: new parser_pb.Notebook({
              cells: [
                new parser_pb.Cell({
                  value: data,
                  languageId: 'markdown',
                  kind: parser_pb.CellKind.MARKUP,
                }),
              ],
            }),
            selected: 0,
            notebookUri: cellChangeEvent.notebookUri,
          }),
        },
        contextId: this.contextId,
        trigger: agent_pb.StreamGenerateRequest_Trigger.CELL_TEXT_CHANGE,
      })
      return req
    }

    return this.buildUpdateRequest(cellChangeEvent)
  }

  // Generates update request
  private async buildUpdateRequest(cellChangeEvent: stream.CellChangeEvent) {
    const [data] = this.data[cellChangeEvent.cellIndex]

    return new agent_pb.StreamGenerateRequest({
      request: {
        case: 'update',
        value: new agent_pb.UpdateContext({
          cell: new parser_pb.Cell({
            value: data,
            languageId: 'markdown',
            kind: parser_pb.CellKind.MARKUP,
          }),
        }),
      },
      contextId: this.contextId,
      trigger: agent_pb.StreamGenerateRequest_Trigger.CELL_TEXT_CHANGE,
    })
  }

  async buildRequestForDebounce(
    cellChangeEvent: stream.CellChangeEvent,
  ): Promise<agent_pb.StreamGenerateRequest> {
    return this.buildUpdateRequest(cellChangeEvent)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async processResponse(response: agent_pb.StreamGenerateResponse): Promise<void> {
    // Stub implementation
    console.log('Processing response:', JSON.stringify(response, null, 1))

    await this.next()
  }

  shutdown = (): void => {
    this.resolveDone()
  }
}

test.skipIf(process.env.RUN_MANUAL_TESTS !== 'true')(
  'manual foyle streaming RPC test',
  async () => {
    const completion = new FakeCompletion(eventsData)
    const client = createClient(
      AIService,
      createConnectTransport({
        httpVersion: '2',
        baseUrl: 'http://localhost:8877/api',
      }),
    )
    const creator = new stream.StreamCreator(completion, client)

    completion.runEvents(creator)
    await completion.done
  },
  // Increase the test timeout
  60_000,
)
