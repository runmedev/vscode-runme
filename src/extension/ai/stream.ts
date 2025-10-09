import { ConnectError } from '@connectrpc/connect'
import {
  StreamGenerateRequest,
  StreamGenerateResponse,
  StreamGenerateRequest_Trigger,
} from '@buf/runmedev_foyle.bufbuild_es/foyle/v1alpha1/agent_pb'
import {
  buffer,
  debounceTime,
  filter,
  from,
  map,
  merge,
  mergeMap,
  Observable,
  pairwise,
  startWith,
  Subject,
} from 'rxjs'

import getLogger from '../logger'

import { AIClient } from './manager'

const log = getLogger()

export const processedEvents: Promise<number>[] = []

// CompletionHandlers is an interface that defines the completion handlers for the completion service
export interface CompletionHandlers {
  // buildRequest is a function that generates a StreamGenerateRequest based on
  // a cellChangeEvent and a value indicating whether this is the first request in the stream.
  // The latter allows the request to vary depending on whether its the first in the stream.
  // If null is returned then no request is generated
  buildRequest: (
    cellChangeEvent: CellChangeEvent,
    firstRequest: boolean,
  ) => Promise<StreamGenerateRequest>

  // processResponse is a function that processes a StreamGenerateResponse
  processResponse: (response: StreamGenerateResponse) => void

  // buildRequestForDebounce is a function that turns cell change events into update events
  // observe them for debouncing superfulous keystrokes
  buildRequestForDebounce: (cellChangeEvent: CellChangeEvent) => Promise<StreamGenerateRequest>

  // shutDown is invoked when the streamCreator is closed
  // This is a way of signaling no more events are expected
  shutdown: () => void
}

type CellChangeEventRequest = {
  event: CellChangeEvent
  request: StreamGenerateRequest | null
}

// TODO(jeremy): Rename StreamCreator -> StreamManager
// StreamCreator takes as input a stream of events representing changes to a notebook and turns
// these into a stream of requests to completion service, and then processes the responses
// from the completion service.
//
// This class handles starting a new stream and when to stop it.
// There are two different circumstances under which we start a new stream:
//   1. When the event stream switches to a different cell we want to start a new stream.
//   2. If the existing stream has an error (e.g. timeout); we need to restart the stream.
//
// When we restart the stream we need to send the full document to the completion service.
//
// Importantly, this means the StreamCreator needs to decide whether an incremental
// or full document is needed and then be able to fetch the appropariate data.
//
// However, we don't want StreamManager to implement the logic for converting a VSCode NoteBook Document
// into requests to the completion service. One reason is separation of concerns. The other is testing.
// We'd like to be able to test the logic for StreamCreator (i.e. its management of connections) without
// having to import vscode and run full integration tests.
//
// Connect's bidi streaming API uses AsyncIterables. This is a pull model.
// VSCode events follow a push model. The StreamCreator acts as a converter between the two.
// The function handleEvent can be used to push events into the StreamCreator. These events
// are then wrapped in iterators and passed to the completion service.
//
//
//
//
// These events are split into windows and then turned into a stream of requests.
//
export class StreamCreator {
  events = new Subject<CellChangeEventRequest>()
  lastIterator: PromiseIterator<StreamGenerateRequest> | null = null

  handlers: CompletionHandlers
  client: AIClient
  constructor(handlers: CompletionHandlers, client: AIClient) {
    this.handlers = handlers

    // Create a client this is actually a Client
    this.client = client

    // Only look at updates for debouncing
    // triggerEvent will gen its own events
    const updateEvents = this.events.pipe(filter((item) => item.request?.request.case === 'update'))

    const cellTextChangeEvents = updateEvents.pipe(
      this.onlyCellTextChange(true),
      // debounce buffering with 500ms interval
      buffer(updateEvents.pipe(debounceTime(500))),
      filter((items) => items.length > 0),
      mergeMap((items) => {
        const debounced = from(items).pipe(
          startWith(undefined),
          pairwise(),
          filter(([prev, current], index) => {
            // always emit single item in buffer
            if (items.length === 1) {
              return true
            }

            if (
              prev?.request &&
              prev.request?.request.case === 'update' &&
              current?.request &&
              current.request?.request.case === 'update'
            ) {
              const unrelated = prev && prev?.request?.contextId !== current?.request?.contextId

              const preVal = prev?.request?.request?.value?.cell?.value ?? ''
              const currVal = current?.request?.request?.value?.cell?.value ?? ''
              const isSubstr = currVal.startsWith(preVal)

              const isLast = index === items.length - 1

              // Emit if the current value is related and not a substring of the previous value
              // or it's the last item in the buffer
              return (!isSubstr || isLast) && !unrelated
            }

            return false
          }),
          map(([, item]) => item!.event),
        )
        return debounced
      }),
    )

    const remainingEvents = updateEvents.pipe(
      this.onlyCellTextChange(false),
      map((item) => item.event),
    )

    // Subscribe to all update events for downstream processing
    merge(cellTextChangeEvents, remainingEvents).subscribe(this.triggerEvent)
  }

  onlyCellTextChange(include: boolean) {
    return function (source: Observable<CellChangeEventRequest>) {
      return source.pipe(
        filter((item) => {
          if (!item.request) {
            return true
          }

          if (item.request.trigger === StreamGenerateRequest_Trigger.CELL_TEXT_CHANGE) {
            return include
          }

          return !include
        }),
      )
    }
  }

  handleEvent = async (event: CellChangeEvent): Promise<void> => {
    const request = await this.handlers.buildRequestForDebounce(event)
    this.events.next({ event, request })
  }

  // triggerEvent processes a request
  // n.b we use arror function definition to ensure this gets properly bound
  // see https://www.typescriptlang.org/docs/handbook/2/classes.html#this-at-runtime-in-classes
  private triggerEvent = async (event: CellChangeEvent): Promise<void> => {
    // We need to generate a new request
    let firstRequest = false
    if (this.lastIterator === undefined || this.lastIterator === null) {
      firstRequest = true
    }

    log.info('triggerEvent: building request')
    let req = await this.handlers.buildRequest(event, firstRequest)

    if (req === null) {
      log.info(`Notebook: ${event.notebookUri}; no request generated`)
      return
    }

    // If the request is a fullContext request we need to start a new stream
    if (req.request.case === 'fullContext') {
      firstRequest = true
    }

    if (this.lastIterator !== undefined && this.lastIterator !== null && firstRequest === true) {
      console.log('Stopping the current stream')
      this.lastIterator.close()
      this.lastIterator = null
    }

    if (this.lastIterator === null) {
      // n.b. we need to define newIterator and then refer to newIterator in the closure
      let newIterator = new PromiseIterator<StreamGenerateRequest>()
      this.lastIterator = newIterator
      // start the bidirectional stream
      let iterable = {
        [Symbol.asyncIterator]: () => {
          // n.b. We don't want to refer to this.lastIterator because we need to create a closure
          // this.lastIterator is a reference that will get be updated over time. We don't want the iterator though
          // to change.
          return newIterator
        },
      }

      const responseIterable = this.client.streamGenerate(iterable)
      // Start a coroutine to process responses from the completion service
      this.processResponses(responseIterable)
    }

    // Enqueue the request
    this.lastIterator.enQueue(req)
  }

  processResponses = async (responses: AsyncIterable<StreamGenerateResponse>) => {
    try {
      for await (const response of responses) {
        this.handlers.processResponse(response)
      }
    } catch (error) {
      if (error instanceof ConnectError) {
        log.error(
          `Error processing response: ${error}; details: ${error.details}; rawMessage: ${error.rawMessage}`,
        )
      } else {
        log.error(`Error processing response: ${error}`)
      }
      // Since an error occurred we want to start a new stream for the next request
      if (this.lastIterator !== undefined && this.lastIterator !== null) {
        // Do we need to call close here? What if the error indicates the stream already closed?
        this.lastIterator.close()
        log.info('Stream closed due to error; resetting iterator')
        // We need to unset the iterator so that a new one will be created in the next event.
        this.lastIterator = null
      }
    }
  }

  // shutdown should be invoked when the stream is to be stopped
  shutdown = (): void => {
    // Close the last iterator
    if (this.lastIterator !== undefined && this.lastIterator !== null) {
      console.log('Stopping the current stream')
      this.lastIterator.close()
      this.lastIterator = null
      this.handlers.shutdown()
      return
    }
  }
}

// CellChangeEvent defines an event that indicates a cell has changed
// The purpose of this class is to create a data structure that can capture the important
// information in a vscode.TextDocumentChangeEvent. We don't want to use the VSCode API directly
// because then we can't test without importing vscode.
export class CellChangeEvent {
  public notebookUri: string
  public cellIndex: number
  public trigger: StreamGenerateRequest_Trigger
  constructor(notebookUri: string, cellIndex: number, trigger: StreamGenerateRequest_Trigger) {
    this.notebookUri = notebookUri
    this.cellIndex = cellIndex
    this.trigger = trigger
  }
}

class PromiseFunctions<T> {
  resolve: (value: T) => void
  reject: (error: any) => void
  constructor(res: (value: T) => void, rej: (error: any) => void) {
    this.resolve = res
    this.reject = rej
  }
}

// PromiseIterator implements the iterator protocol for an AsyncIterable.
// It is used to create a "channel" that allows us to turn events into requests
// to be sent via the streaming protocol.
// It implements the iterator protocol; wrapped around a list. The list is used
// to buffer values from a pusher. The iterator returns promises that get
// resolved when values get pushed..
class PromiseIterator<T> {
  values: T[] = []

  // Keep track of the resolve and reject functions for the promise returned by next
  // That needs to be closed when the next value is added to the list.
  pending: PromiseFunctions<IteratorResult<T>> | null = null

  // resolve: (value: IteratorResult<T>) => void
  // reject: (error: any) => void | undefined = undefined
  completed = false
  error: any = null

  // enQueue the item to be returned by the iterator
  enQueue(item: T) {
    if (this.pending !== null) {
      this.pending.resolve({ value: item, done: false })
      this.pending = null
    } else {
      // TODO(jeremy): Arguably we shouldn't push this onto a list we should replace the current item if there is one.
      // There's no point sending an earlier version of the cell.
      this.values.push(item)
    }
  }

  // Close the iterator
  close() {
    this.completed = true
    if (this.pending !== null) {
      this.pending.resolve({ value: undefined, done: true })
      this.pending = null
    }
  }

  // Implement the iterator protocol
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols#the_iterator_protocol
  next(): Promise<IteratorResult<T>> {
    let outer = this
    // Each call to next returns a promise. If we already have a value in the list, we return it.
    // If the list is empty, we store the resolve and reject functions so that we can invoke resolve when
    // a value is added to the list
    return new Promise<IteratorResult<T>>((res, rej) => {
      if (outer.error) {
        rej(outer.error)
      } else if (outer.values.length) {
        // If there is a value in the list, return it
        res({ value: outer.values.shift()!, done: false })
      } else if (outer.completed) {
        res({ value: undefined, done: true })
      } else {
        // Store the resolve and reject functions so that we can
        outer.pending = new PromiseFunctions(res, rej)
      }
    })
  }

  return(): Promise<IteratorResult<T>> {
    return Promise.resolve({ value: undefined, done: true })
  }
  // The connect method requires this method to be implemented even though it is optional in AsyncIterable.
  // I suspect this method gets invoked if there is an error in the connection; e.g. it gets closed with a timeout.
  // I think by calling Promise.reject(err) we are propogating the error so if we are iterating over the AsyncIterable
  // e.g. in a for await loop; the loop will be aborted with an error that can be caught in a try/catch block.
  throw(err: any) {
    console.log('Error in PromiseIterator:', err)
    return Promise.reject(err)
  }
}
