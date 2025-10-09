import { LogEvent, LogEventType } from '@buf/runmedev_foyle.bufbuild_es/foyle/v1alpha1/agent_pb'
import { ulid } from 'ulidx'
import * as vscode from 'vscode'

import { getEventReporter } from './events'

// SessionManager is responsible for managing sessions of the AI requests.
// A session consists of multiple requests/operations that are all related.
// Currently, a session corresponds to a user setting the focus on a cell and
// editing that cell. The purpose of the session manager is to assign a unique
// id to a session and keep track of the current session. This way we can use
// the session id to correlate requests. In particular, for each session we only
// need to send the entire notebook once and then on subsequent events just send
// diffs.
//
// There is a single instance of the SessionManager that is accessed by the getManager
// function. This is because we need a single global session id that multiple callers
// can access.
//
// N.B. Currently we assume there is only one session at a time. Notably, we don't allow
// for multiple sessions to be active corresponding to different notebooks. A new session
// is activated when ever the cell focus changes so whenever a user switches to a different
// notebook we will start a new session. However, the old notebook might still have some
// ghost cells in it.
export class SessionManager {
  static instance: SessionManager

  sessionID: string
  statusBar: vscode.StatusBarItem | null

  constructor(statusBar: vscode.StatusBarItem | null) {
    this.sessionID = ulid()
    this.statusBar = statusBar
  }

  public static getManager(): SessionManager {
    if (!SessionManager.instance) {
      // N.B. This shouldn't be triggered because we should initialize the manager
      // in the AIManager
      SessionManager.instance = new SessionManager(null)
    }

    return SessionManager.instance
  }

  public static resetManager(statusBar: vscode.StatusBarItem) {
    SessionManager.instance = new SessionManager(statusBar)
  }

  // getID returns the current session id
  public getID(): string {
    return this.sessionID
  }

  // newID generates a new session id and returns it
  public newID(): string {
    // Report the end of the current session and the start of the new session
    const oldID = this.sessionID
    const closeEvent = new LogEvent()
    closeEvent.type = LogEventType.SESSION_END
    closeEvent.contextId = oldID

    this.sessionID = ulid()

    const openEvent = new LogEvent()
    openEvent.type = LogEventType.SESSION_START
    openEvent.contextId = this.sessionID

    if (this.statusBar !== null) {
      this.statusBar.text = `Session: ${this.sessionID}`
    }

    getEventReporter().reportEvents([closeEvent, openEvent])
    return this.sessionID
  }
}
