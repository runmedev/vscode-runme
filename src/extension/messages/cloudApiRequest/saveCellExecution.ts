import { TelemetryReporter } from 'vscode-telemetry'

import { ClientMessages } from '../../../constants'
import { ClientMessage, IApiMessage } from '../../../types'
import { InitializeClient } from '../../api/client'
import { getCellByUuId } from '../../cell'
import { getAnnotations, getAuthSession, getCellRunmeId } from '../../utils'
import { postClientMessage } from '../../../utils/messaging'
import { RunmeService } from '../../services/runme'
import { CreateCellExecutionDocument } from '../../__generated__/graphql'
import { Kernel } from '../../kernel'

type APIRequestMessage = IApiMessage<ClientMessage<ClientMessages.cloudApiRequest>>

export default async function saveCellExecution(
  requestMessage: APIRequestMessage,
  kernel: Kernel
): Promise<void | boolean> {
  const { messaging, message, editor } = requestMessage

  try {
    const session = await getAuthSession()

    if (!session) {
      throw new Error('You must authenticate with your GitHub account')
    }
    const cell = await getCellByUuId({ editor, uuid: message.output.uuid })
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
    const exitCode = runnerExitStatus
      ? runnerExitStatus.type === 'exit'
        ? runnerExitStatus.code
        : -1
      : 0
    const annotations = getAnnotations(cell)
    delete annotations['runme.dev/uuid']
    const runmeService = new RunmeService({ githubAccessToken: session.accessToken })
    const runmeTokenResponse = await runmeService.getUserToken()
    if (!runmeTokenResponse) {
      throw new Error('Unable to retrieve an access token')
    }
    const graphClient = InitializeClient({ runmeToken: runmeTokenResponse.token })
    const terminalContents = Array.from(new TextEncoder().encode(message.output.data.stdout))
    const result = await graphClient.mutate({
      mutation: CreateCellExecutionDocument,
      variables: {
        data: {
          stdout: exitCode === 0 ? terminalContents : Array.from([]),
          stderr: exitCode !== 0 ? terminalContents : Array.from([]),
          exitCode,
          pid,
          input: encodeURIComponent(cell.document.getText()),
          metadata: {
            mimeType: annotations.mimeType,
            name: annotations.name,
            category: annotations.category || '',
          },
        },
      },
    })
    TelemetryReporter.sendTelemetryEvent('app.save')
    return postClientMessage(messaging, ClientMessages.cloudApiResponse, {
      data: result,
      uuid: message.output.uuid,
    })
  } catch (error) {
    TelemetryReporter.sendTelemetryEvent('app.error')
    return postClientMessage(messaging, ClientMessages.cloudApiResponse, {
      data: (error as any).message,
      uuid: message.output.uuid,
      hasErrors: true,
    })
  }
}
