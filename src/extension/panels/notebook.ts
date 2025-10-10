import { Subscription, Observable, combineLatest, switchMap, map, filter, shareReplay } from 'rxjs'
import { Disposable, ExtensionContext, Uri, Webview, WebviewView } from 'vscode'

import { SnapshotEnv, SyncSchemaBus } from '../../types'
import getLogger from '../logger'
import { GrpcRunnerMonitorEnvStore } from '../runner/monitorEnv'
import {
  MonitorEnvStoreResponse,
  MonitorEnvStoreResponseSnapshot_SnapshotEnv,
} from '../grpc/runner/v1'

import { TanglePanel } from './base'

export type EnvStoreMonitorWithSession = {
  monitor: GrpcRunnerMonitorEnvStore
  sessionId: string
}

type SnapshotEnvs = MonitorEnvStoreResponseSnapshot_SnapshotEnv[]

const log = getLogger('NotebookPanel')
export class EnvStorePanel extends TanglePanel {
  #webviewView: WebviewView | undefined
  #disposables: Disposable[] = []

  constructor(
    protected readonly context: ExtensionContext,
    identifier: string,
    protected envStoreMonitor: Observable<EnvStoreMonitorWithSession>,
  ) {
    super(context, identifier)

    const snapshotEnvs: Observable<SnapshotEnvs> = envStoreMonitor.pipe(
      switchMap((monWithSess) => {
        const stream = monWithSess.monitor.monitorEnvStore(monWithSess.sessionId)
        return new Observable<MonitorEnvStoreResponse['data']>((observer) => {
          stream.responses.onMessage(({ data }) => observer.next(data))
          // only log to not complete observable, these errors are recoverable
          stream.responses.onError((err) => log.error('error in monitor', err.toString()))
          stream.responses.onComplete(() => observer.complete())
        })
      }),
      filter((data) => data.oneofKind === 'snapshot'),
      map((data) => data.snapshot.envs),
      shareReplay(1), // cache last value for new subscribers between updates
    )

    const sub = combineLatest([this.webview, snapshotEnvs]).subscribe({
      next: ([, envVars]) => this.updateWebview(envVars),
    })
    this.#disposables.push({
      dispose: () => sub.unsubscribe(),
    })
  }

  async resolveWebviewTelemetryView(webviewView: WebviewView): Promise<void> {
    const { webview } = webviewView
    this.#webviewView = webviewView
    const webviewOptions = {
      enableScripts: true,
      retainContextWhenHidden: true,
    }

    log.trace(`${this.identifier} webview resolving`)

    const extensionUri = this.context.extensionUri

    webviewView.webview.html = this.getHtml(webview, extensionUri, [])
    webviewView.webview.options = {
      ...webviewOptions,
      localResourceRoots: [extensionUri],
    }

    webviewView.onDidDispose(this.onDidDispose)

    this.webview.next(webviewView.webview)
    log.trace(`${this.identifier} webview resolved`)

    return Promise.resolve()
  }

  private sanitizeVariables(variables: SnapshotEnvs) {
    variables.forEach((variable: SnapshotEnv) => {
      variable.originalValue = variable.originalValue.replace(/'/g, '&#39;')
      variable.description = variable.description.replace(/'/g, '&#39;')
    })
    return variables
  }

  private getHtml(webview: Webview, extensionUri: Uri, variables: SnapshotEnvs) {
    const scripts = [
      {
        src: EnvStorePanel.getUri(webview, extensionUri, ['out', 'client.js']),
        defer: true,
      },
    ]
    const scriptTags = scripts.map((s) => {
      if (s.defer) {
        return `<script src="${s.src}" type="module"></script>`
      } else {
        return `<script src="${s.src}" type="module" defer></script>`
      }
    })
    return `<!DOCTYPE html><html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Panel</title>
      ${scriptTags}
    </head>
    <body>
    <env-store variables='${JSON.stringify(this.sanitizeVariables(variables))}'></env-store>
    </body>
  </html>`
  }

  private updateWebview(vars: SnapshotEnvs) {
    this.#webviewView!.webview.html = this.getHtml(
      this.#webviewView!.webview,
      this.context.extensionUri,
      vars,
    )
  }

  private static getUri(webview: Webview, extensionUri: Uri, pathList: string[]) {
    return webview.asWebviewUri(Uri.joinPath(extensionUri, ...pathList))
  }

  private onDidDispose() {
    this.#disposables.forEach((disposable) => disposable.dispose())
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected registerSubscribers(bus: SyncSchemaBus): Subscription[] {
    return []
  }
}
