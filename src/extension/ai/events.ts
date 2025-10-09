import {
  LogEventsRequest,
  LogEventType,
  LogEvent,
  LogEvent_ExecuteStatus,
  StreamGenerateRequest_Trigger,
} from '@buf/runmedev_foyle.bufbuild_es/foyle/v1alpha1/agent_pb'
import * as vscode from 'vscode'
import { ulid } from 'ulidx'
import { Subject, Subscription, from, map, mergeMap } from 'rxjs'

import { RUNME_CELL_ID } from '../constants'
import getLogger from '../logger'

import { SessionManager } from './sessions'
import * as converters from './converters'
import * as stream from './stream'
import { AIClient } from './manager'

// Interface for the event reporter
// This allows us to swap in a null op logger when AI isn't enabled
export interface IEventReporter {
  reportExecution(cell: vscode.NotebookCell, status: boolean): void
  reportEvents(events: LogEvent[]): void
}

// EventReporter handles reporting events to the AI service
export class EventReporter implements vscode.Disposable, IEventReporter {
  client: AIClient
  log: ReturnType<typeof getLogger>
  queue: Subject<LogEvent[]> = new Subject()
  subscription: Subscription
  streamCreator: stream.StreamCreator

  constructor(client: AIClient, streamCreator: stream.StreamCreator) {
    this.client = client
    this.log = getLogger('AIEventReporter')
    this.streamCreator = streamCreator

    this.subscription = this.queue
      .pipe(
        map((events) => {
          for (const event of events) {
            if (event.eventId === '') {
              event.eventId = ulid()
            }
          }
          return new LogEventsRequest({ events })
        }),
        mergeMap((req) => {
          return from(
            this.client.logEvents(req).catch((e) => {
              // handle error local to the promise, to avoid stream termination
              this.log.error(`Failed to log event; error: ${e}`)
            }),
          )
        }),
      )
      .subscribe() // just subscribe, ignore responses
  }

  dispose(): void {
    this.subscription.unsubscribe()
  }

  reportExecution(cell: vscode.NotebookCell, executionSuccess: boolean) {
    const contextCells: vscode.NotebookCell[] = []

    // Include some previous cells as context.
    // N.B. In principle we shouldn't need to send any additional context because we
    // set the context id. So as soon as we put the focus on the execution cell we should
    // start a streaming generate request which will include the entire notebook or a large portion of it.
    // However, we still send some additional context here for two reasons
    // 1. Help us verify that sending context ids is working correctly.
    // 2. Its possible in the future we start rate limiting streaming generate requests and don't want to rely on it
    // for providing the context of the cell execution.
    let startIndex = cell.index - 1
    if (startIndex < 0) {
      startIndex = 0
    }
    for (let i = startIndex; i < cell.index; i++) {
      contextCells.push(cell.notebook.cellAt(i))
    }

    contextCells.push(cell)
    const cells = converters.vsCellsToESProtos(contextCells)
    const event = new LogEvent()
    event.selectedId = cell.metadata?.[RUNME_CELL_ID]
    event.selectedIndex = cell.index
    event.type = LogEventType.EXECUTE
    event.cells = cells
    event.contextId = SessionManager.getManager().getID()

    if (executionSuccess) {
      event.executeStatus = LogEvent_ExecuteStatus.SUCCEEDED
    } else {
      event.executeStatus = LogEvent_ExecuteStatus.FAILED
    }
    // Fire an event to trigger the AI service
    const cellChangeEvent = new stream.CellChangeEvent(
      cell.notebook.uri.toString(),
      cell.index,
      StreamGenerateRequest_Trigger.CELL_EXECUTE,
    )
    this.streamCreator.handleEvent(cellChangeEvent)
    return this.reportEvents([event])
  }

  reportEvents(events: LogEvent[]) {
    this.queue.next(events)
  }
}

// NullOpEventReporter is a null op implementation of the event reporter
export class NullOpEventReporter implements IEventReporter {
  reportExecution(_cell: vscode.NotebookCell, _status: boolean) {
    // Do nothing
  }

  reportEvents(_events: LogEvent[]) {
    // Do nothing
  }
}

let _globalReporter = new NullOpEventReporter()

// getEventReporter returns the global event reporter
export function getEventReporter(): IEventReporter {
  return _globalReporter
}

export function setEventReporter(reporter: IEventReporter) {
  _globalReporter = reporter
}
