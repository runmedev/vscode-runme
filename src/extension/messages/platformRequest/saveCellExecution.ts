import util from 'node:util'
import os from 'node:os'

import {
  Uri,
  env,
  workspace,
  commands,
  EventEmitter,
  AuthenticationSessionsChangeEvent,
  window,
  CancellationTokenSource,
} from 'vscode'
import { TelemetryReporter } from 'vscode-telemetry'
import { mac } from 'address'
import YAML from 'yaml'
import { FetchResult } from '@apollo/client'

import {
  ClientMessages,
  NOTEBOOK_AUTOSAVE_ON,
  OutputType,
  RUNME_FRONTMATTER_PARSED,
} from '../../../constants'
import { ClientMessage, FeatureName, IApiMessage } from '../../../types'
import { postClientMessage } from '../../../utils/messaging'
import ContextState from '../../contextState'
import { Kernel } from '../../kernel'
import getLogger from '../../logger'
import { getAnnotations, getCellRunmeId, getGitContext } from '../../utils'
import { InitializeCloudClient } from '../../api/client'
import {
  CreateCellExecutionDocument,
  CreateCellExecutionMutation,
  CreateCellExecutionMutationVariables,
  CreateExtensionCellOutputDocument,
  CreateExtensionCellOutputMutation,
  CreateNotebookInput,
  MutationCreateExtensionCellOutputArgs,
  ReporterFrontmatterInput,
} from '../../__generated-platform__/graphql'
import { Frontmatter } from '../../grpc/parser/tcp/types'
import { getCellById } from '../../cell'
import {
  AUTH_TIMEOUT,
  StatefulAuthProvider,
  StatefulAuthSession,
} from '../../provider/statefulAuth'
import features from '../../features'
import AuthSessionChangeHandler from '../../authSessionChangeHandler'
import { promiseFromEvent } from '../../../utils/promiseFromEvent'
import { getDocumentCacheId } from '../../serializer/serializer'
import { ConnectSerializer } from '../../serializer'
export type APIRequestMessage = IApiMessage<ClientMessage<ClientMessages.platformApiRequest>>

const log = getLogger('SaveCell')
type SessionType = StatefulAuthSession | undefined

let currentCts: CancellationTokenSource | undefined

const getMAC = util.promisify<string | null | undefined>(mac)

export default async function saveCellExecution(
  requestMessage: APIRequestMessage,
  kernel: Kernel,
): Promise<void | boolean> {
  const isReporterEnabled = features.isOnInContextState(FeatureName.ReporterAPI)
  const { messaging, message, editor } = requestMessage

  if (currentCts) {
    currentCts.cancel()
  }

  currentCts = new CancellationTokenSource()
  const { token } = currentCts

  try {
    const autoSaveIsOn = ContextState.getKey<boolean>(NOTEBOOK_AUTOSAVE_ON)
    const forceLogin = kernel.isFeatureOn(FeatureName.ForceLogin)

    let session = await StatefulAuthProvider.instance.currentSession()

    if (!session && forceLogin) {
      session = await StatefulAuthProvider.instance.newSession()
    }

    if (!session && message.output.data.isUserAction) {
      await commands.executeCommand('runme.openCloudPanel')

      const authenticationEvent = new EventEmitter<StatefulAuthSession | undefined>()

      const callback = (_e: AuthenticationSessionsChangeEvent) => {
        AuthSessionChangeHandler.instance.removeListener(callback)
        StatefulAuthProvider.instance.currentSession().then((session) => {
          authenticationEvent.fire(session)
        })
      }

      AuthSessionChangeHandler.instance.addListener(callback)

      if (token.isCancellationRequested) {
        return
      }

      try {
        session = await Promise.race([
          promiseFromEvent<SessionType, SessionType>(authenticationEvent.event).promise,
          new Promise<undefined>((resolve, reject) => {
            const timeoutId = setTimeout(() => reject(undefined), AUTH_TIMEOUT)
            token.onCancellationRequested(() => {
              clearTimeout(timeoutId)
              reject(new Error('Operation cancelled'))
            })
          }),
        ])
      } finally {
        authenticationEvent.dispose()

        if (token.isCancellationRequested) {
          log.info('Cancelling authentication event')
          return
        }

        if (!session) {
          await postClientMessage(messaging, ClientMessages.platformApiResponse, {
            data: { displayShare: false },
            id: message.output.id,
          })

          window.showWarningMessage(
            'Saving timed out. Sign in to save your cells. Please try again.',
          )
          return
        }
      }
    }

    const graphClient = await InitializeCloudClient()

    const path = editor.notebook.uri.fsPath
    const gitCtx = await getGitContext(path)
    const filePath = gitCtx.repository ? `${gitCtx.relativePath}${path?.split('/').pop()}` : path
    const fileContent = path ? await workspace.fs.readFile(Uri.file(path)) : undefined
    let data:
      FetchResult<CreateExtensionCellOutputMutation> | FetchResult<CreateCellExecutionMutation>

    if (!session) {
      return postClientMessage(messaging, ClientMessages.platformApiResponse, {
        data: { displayShare: false },
        id: message.output.id,
      })
    }

    // Save the file to ensure the serialization completes before saving the cell execution.
    // This guarantees we access the latest cache state of the serializer.
    await editor.notebook.save()

    log.info('Saving cell execution')

    const frontmatter = ConnectSerializer.marshalFrontmatter(editor.notebook.metadata, kernel)

    const metadata = { ...editor.notebook.metadata, [RUNME_FRONTMATTER_PARSED]: frontmatter }

    const cacheId = getDocumentCacheId(metadata) as string
    const plainSessionOutput = await kernel.getPlainCache(cacheId)
    const maskedSessionOutput = await kernel.getMaskedCache(cacheId)

    let hostname = os.hostname()
    if (['localhost', '127.0.0.1'].includes(hostname) && process.env.K_SERVICE) {
      hostname = process.env.K_SERVICE
    }

    let macAddress: string | null | undefined = '[unknown]'
    try {
      macAddress = await getMAC()
    } catch (error) {
      if (!(error instanceof Error)) {
        return
      }
      log.error('Error getting MAC address', error.message)
    }

    const vsEnv = {
      appHost: env.appHost,
      appName: env.appName,
      appRoot: env.appRoot,
      isNewAppInstall: env.isNewAppInstall,
      language: env.language,
      machineId: env.machineId,
      remoteName: env.remoteName || '',
      sessionId: env.sessionId,
      shell: env.shell,
      uiKind: env.uiKind,
      uriScheme: env.uriScheme,
    }

    // If the reporter is enabled, we will save the cell execution using the reporter API.
    // This is only temporary, until the reporter is fully tested.
    if (isReporterEnabled) {
      const notebookData = kernel.getNotebookDataCache(cacheId)

      if (!notebookData) {
        throw new Error(`Notebook data cache not found for cache ID: ${cacheId}`)
      }

      const notebook = ConnectSerializer.marshalNotebook(notebookData, {
        kernel,
        marshalFrontmatter: true,
      })

      const cell = notebook?.cells.find((c) => c.metadata.id === message.output.id)

      if (!cell) {
        throw new Error(`Cell not found in notebook ${notebook.frontmatter?.runme?.id}`)
      }

      // TODO: Implement the reporter to normalize the data into a valid Platform api payload
      const mutation = {
        mutation: CreateExtensionCellOutputDocument,
        variables: <MutationCreateExtensionCellOutputArgs>{
          input: {
            extension: {
              autoSave: autoSaveIsOn,
              device: {
                arch: os.arch(),
                hostname: hostname,
                platform: os.platform(),
                macAddress,
                release: os.release(),
                shell: os.userInfo().shell,
                vendor: os.userInfo().username,
                vsAppHost: vsEnv.appHost,
                vsAppName: vsEnv.appName,
                vsAppSessionId: vsEnv.sessionId,
                vsMachineId: vsEnv.machineId,
                vsMetadata: vsEnv,
              },
              file: { content: fileContent, path: filePath },
              git: { branch: gitCtx.branch, commit: gitCtx.commit, repository: gitCtx.repository },
              session: { maskedOutput: maskedSessionOutput, plainOutput: plainSessionOutput },
            },
            notebook: {
              cells: [
                {
                  ...cell,
                  outputs: (cell?.outputs || [])?.map((output) => ({
                    ...output,
                    items: (output?.items || [])?.filter((item) => {
                      if (item.mime === OutputType.stdout) {
                        return item
                      }
                    }),
                  })),
                },
              ],
              frontmatter: notebook?.frontmatter as ReporterFrontmatterInput,
              metadata: notebook?.metadata,
            },
          },
        },
      }

      const result = await graphClient.mutate(mutation)
      data = result
    }
    // TODO: Remove the legacy createCellExecution mutation once the reporter is fully tested.
    else {
      const cell = await getCellById({ editor, id: message.output.id })
      if (!cell) {
        throw new Error('Cell not found')
      }

      const runmeId = getCellRunmeId(cell)
      const terminal = kernel.getTerminal(runmeId)
      if (!terminal) {
        throw new Error('Could not find an associated terminal')
      }
      const pid = (await terminal.processId) || 0
      const runnerExitStatus = terminal.runnerSession?.hasExited()
      const exitCode =
        runnerExitStatus?.type === 'exit'
          ? runnerExitStatus.code
          : runnerExitStatus?.type === 'error'
            ? 1
            : 0
      const annotations = getAnnotations(cell)
      delete annotations['runme.dev/id']

      const terminalContents = Array.from(new TextEncoder().encode(message.output.data.stdout))

      let fmParsed = editor.notebook.metadata[RUNME_FRONTMATTER_PARSED] as Frontmatter

      if (!fmParsed) {
        try {
          const yamlDocs = YAML.parseAllDocuments(editor.notebook.metadata['runme.dev/frontmatter'])
          fmParsed = yamlDocs[0].toJS?.() || {}
        } catch (error: any) {
          log.warn('failed to parse frontmatter, reason: ', error.message)
        }
      }

      let notebookInput: CreateNotebookInput | undefined

      if (fmParsed?.runme?.id || fmParsed?.runme?.version) {
        notebookInput = {
          fileName: path,
          id: fmParsed?.runme?.id,
          runmeVersion: fmParsed?.runme?.version,
        }
      }
      const sessionId = kernel.getRunnerEnvironment()?.getSessionId()

      const mutation = {
        mutation: CreateCellExecutionDocument,
        variables: <CreateCellExecutionMutationVariables>{
          input: {
            stdout: terminalContents,
            stderr: Array.from([]), // stderr will become applicable for non-terminal
            exitCode,
            pid,
            input: encodeURIComponent(cell.document.getText()),
            languageId: cell.document.languageId,
            autoSave: autoSaveIsOn,
            metadata: {
              mimeType: annotations.mimeType,
              name: annotations.name,
              category: annotations.category || '',
              exitType: runnerExitStatus?.type,
              startTime: cell.executionSummary?.timing?.startTime,
              endTime: cell.executionSummary?.timing?.endTime,
            },
            id: annotations.id,
            notebook: notebookInput,
            branch: gitCtx?.branch,
            repository: gitCtx?.repository,
            commit: gitCtx?.commit,
            fileContent,
            filePath,
            sessionId,
            plainSessionOutput,
            maskedSessionOutput,
            device: {
              macAddress,
              hostname: hostname,
              platform: os.platform(),
              release: os.release(),
              arch: os.arch(),
              vendor: os.cpus()[0].model,
              shell: vsEnv.shell,
              // Only save the relevant env variables
              vsAppHost: vsEnv.appHost,
              vsAppName: vsEnv.appName,
              vsAppSessionId: vsEnv.sessionId,
              vsMachineId: vsEnv.machineId,
              metadata: {
                // Let's save the entire env object for future reference if needed
                vsEnv,
              },
            },
          },
        },
      }

      const result = await graphClient.mutate(mutation)

      data = result
    }

    log.info('Cell execution saved')

    TelemetryReporter.sendTelemetryEvent('app.save')
    return postClientMessage(messaging, ClientMessages.platformApiResponse, {
      data,
      id: message.output.id,
    })
  } catch (error) {
    log.error('Error saving cell execution', (error as Error).message)
    TelemetryReporter.sendTelemetryEvent('app.error')
    return postClientMessage(messaging, ClientMessages.platformApiResponse, {
      data: (error as any).message,
      id: message.output.id,
      hasErrors: true,
    })
  } finally {
    if (currentCts?.token === token) {
      currentCts.dispose()
      currentCts = undefined
    }
  }
}
