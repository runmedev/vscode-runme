import path from 'node:path'
import os from 'node:os'

import {
  NotebookCell, Uri, window, env, NotebookDocument, TextDocument, ViewColumn,
  workspace, NotebookData, commands, NotebookCellData, NotebookCellKind
} from 'vscode'

import { getBinaryPath, getTLSDir, getTLSEnabled } from '../../utils/configuration'
import { Kernel } from '../kernel'
import { getAnnotations, getTerminalByCell } from '../utils'
import RunmeServer from '../server/runmeServer'
import { GrpcRunnerEnvironment } from '../runner'

function showWarningMessage () {
  return window.showWarningMessage('Couldn\'t find terminal! Was it already closed?')
}

export function openTerminal (cell: NotebookCell) {
  const terminal = getTerminalByCell(cell)
  if (!terminal) {
    return showWarningMessage()
  }
  return terminal.show()
}

export function copyCellToClipboard (cell: NotebookCell) {
  env.clipboard.writeText(cell.document.getText())
  return window.showInformationMessage('Copied cell to clipboard!')
}

export function stopBackgroundTask (cell: NotebookCell) {
  const terminal = getTerminalByCell(cell)
  if (!terminal) {
    return showWarningMessage()
  }
  terminal.dispose()
  return window.showInformationMessage(`${terminal?.name} task terminated!`)
}

export function runCLICommand(
  extensionBaseUri: Uri,
  grpcRunner: boolean,
  server: RunmeServer,
  kernel: Kernel
) {
 return async function(cell: NotebookCell) {
    const cwd = path.dirname(cell.document.uri.fsPath)

    const args = [
      `--chdir="${cwd}"`,
      `--filename="${path.basename(cell.document.uri.fsPath)}"`
    ]

    const envs: Record<string, string> = { }

    const runmeExecutable = getBinaryPath(extensionBaseUri, os.platform()).fsPath

    if (grpcRunner) {
      envs['RUNME_SERVER_ADDR'] = server.address()

      if (getTLSEnabled()) {
        envs['RUNME_TLS_DIR'] = getTLSDir()
      } else {
        args.push('--insecure')
      }

      const runnerEnv = kernel.getRunnerEnvironment()
      if(runnerEnv && runnerEnv instanceof GrpcRunnerEnvironment) {
        envs['RUNME_SESSION'] = runnerEnv.getSessionId()
      }
    }

    const annotations = getAnnotations(cell)
    const term = window.createTerminal({
      name: `CLI: ${annotations.name}`,
      cwd,
      env: envs,
    })

    term.show(false)
    term.sendText(`${runmeExecutable} run ${annotations.name} ${args.join(' ')}`)
  }
}

export function openAsRunmeNotebook (doc: NotebookDocument) {
  window.showNotebookDocument(doc, {
    viewColumn: ViewColumn.Active
  })
}

export function openSplitViewAsMarkdownText (doc: TextDocument) {
  window.showTextDocument(doc, {
    viewColumn: ViewColumn.Beside
  })
}

export async function createNewRunmeNotebook () {
  const newNotebook = await workspace.openNotebookDocument(
    Kernel.type,
    new NotebookData([
      new NotebookCellData(
        NotebookCellKind.Markup,
        '# Runme Notebook\n\nDouble-click and start writing here...',
        'markdown'
      ),
      new NotebookCellData(NotebookCellKind.Code, 'echo "Hello World"', 'sh'),
      new NotebookCellData(
        NotebookCellKind.Markup,
        '*Read the docs on [runme.dev](https://www.runme.dev/docs/intro)' +
          ' to learn how to get most out of Runme notebooks!*',
        'markdown'
      ),
    ])
  )
  await commands.executeCommand('vscode.openWith', newNotebook.uri, Kernel.type)
}
