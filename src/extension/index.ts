import { window, extensions, type ExtensionContext, env, Uri } from 'vscode'
import { TelemetryReporter } from 'vscode-telemetry'

import { RunmeExtension } from './extension'
import getLogger from './logger'

declare const INSTRUMENTATION_KEY: string

const ext = new RunmeExtension()
const log = getLogger()

export async function activate(context: ExtensionContext) {
  TelemetryReporter.configure(INSTRUMENTATION_KEY)
  const extensionIdentifier = RunmeExtension.getExtensionIdentifier(context)
  const pfound = extensions.all.find((extension) => extension.id === 'stateful.platform')

  if (extensionIdentifier === 'stateful.runme' && pfound) {
    log.warn('Skipping extension activation to avoid conflicts')
    const message =
      "The Stateful extension is a superset of Runme. Both extension can't be enabled at the same time." +
      'Please deactivate Runme and restart VS Code to avoid conflicts.'

    const actionText = 'Open Runme Extension'
    const response = await window.showWarningMessage(message, actionText)
    if (response === actionText) {
      await env.openExternal(Uri.parse('vscode:extension/stateful.runme'))
    }

    return
  }

  log.info('Activating Extension')
  try {
    await ext.initialize(context)
    log.info('Extension successfully activated')
  } catch (err: any) {
    log.error(`Failed to initialize the extension: ${err.message}`)
  }

  TelemetryReporter.sendTelemetryEvent('activate')
}

export function deactivate() {
  log.info('Deactivating Extension')
  TelemetryReporter.sendTelemetryEvent('deactivate')
}
