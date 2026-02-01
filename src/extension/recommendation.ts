import { join } from 'node:path'

import { ExtensionContext, Uri, window, workspace } from 'vscode'
import { TelemetryReporter } from 'vscode-telemetry'
import { parse } from 'jsonc-parser'

import { EXTENSION_NAME, TELEMETRY_EVENTS } from '../constants'

import {
  editJsonc,
  fileOrDirectoryExists,
  getDefaultWorkspace,
  isMultiRootWorkspace,
} from './utils'

export class RecommendedExtension {
  constructor(
    protected readonly context: ExtensionContext,
    readonly stateSettings?: Partial<Record<TELEMETRY_EVENTS, any>>,
  ) {
    this.context = context
    this.stateSettings = stateSettings
  }

  async isRecommended(): Promise<boolean> {
    // Multi-root workspace not supported atm
    const isMultiRoot = isMultiRootWorkspace()
    if (isMultiRoot) {
      window.showInformationMessage('Multi-root workspace are not supported')
      return true
    }
    const workspaceRoot = getDefaultWorkspace()
    if (!workspaceRoot || isMultiRoot) {
      return true
    }
    const extensionsJson = Uri.parse(join(workspaceRoot, '.vscode/extensions.json'))
    const extensionfileOrDirectoryExists = await fileOrDirectoryExists(extensionsJson)
    let documentText = ''

    if (extensionfileOrDirectoryExists) {
      const extensionDocument = await workspace.openTextDocument(extensionsJson)
      documentText = extensionDocument.getText()
      const { recommendations }: Record<string, string[]> = parse(documentText)

      if (recommendations.includes(EXTENSION_NAME)) {
        return true
      }
    }

    return false
  }

  async add(): Promise<void> {
    try {
      if (await this.isRecommended()) {
        return
      }

      const workspaceRoot = getDefaultWorkspace()
      if (!workspaceRoot) {
        return
      }

      const extensionsJson = Uri.parse(join(workspaceRoot, '.vscode/extensions.json'))
      const extensionfileOrDirectoryExists = await fileOrDirectoryExists(extensionsJson)
      let extensionRecommendations: string[] = []
      let documentText = ''

      if (extensionfileOrDirectoryExists) {
        const extensionDocument = await workspace.openTextDocument(extensionsJson)
        documentText = extensionDocument.getText()
        const { recommendations }: Record<string, string[]> = parse(documentText)
        extensionRecommendations = recommendations
      }

      const folderUri = Uri.parse(join(workspaceRoot, '.vscode'))
      const dirExists = await fileOrDirectoryExists(folderUri)
      if (!dirExists) {
        await workspace.fs.createDirectory(folderUri)
      }

      await workspace.fs.writeFile(
        extensionsJson,
        Buffer.from(
          editJsonc(
            documentText,
            'recommendations',
            true,
            extensionRecommendations,
            EXTENSION_NAME,
          ),
        ),
      )

      TelemetryReporter.sendTelemetryEvent(TELEMETRY_EVENTS.RecommendExtension, {
        added: 'true',
        error: 'false',
      })
    } catch (_error) {
      TelemetryReporter.sendTelemetryEvent(TELEMETRY_EVENTS.RecommendExtension, {
        added: 'false',
        error: 'true',
      })
    }
  }
}
