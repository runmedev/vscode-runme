import path from 'node:path'

import { NotebookCell, Uri, window, env, NotebookDocument, TextDocument, ViewColumn } from 'vscode'

import { CliProvider } from '../provider/cli'
import { getTerminalByCell } from '../utils'

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

export async function runCLICommand (cell: NotebookCell) {
  if (!await CliProvider.isCliInstalled()) {
    return window.showInformationMessage(
      'Runme CLI is not installed. Do you want to download it?',
      'Download now'
    ).then((openBrowser) => openBrowser && env.openExternal(
      Uri.parse('https://github.com/stateful/runme/releases')
    ))
  }
  const cliName: string = (cell.metadata?.['cliName'] || '').trim()
  const term = window.createTerminal(`CLI: ${cliName}`)
  term.show(false)
  term.sendText(`runme run ${cliName} --chdir="${path.dirname(cell.document.uri.fsPath)}"`)
}
export function openAsRunmeNotebook (doc: NotebookDocument) {
  window.showNotebookDocument(doc, {
    viewColumn: ViewColumn.Beside
  })
}

export function openSplitViewAsMarkdownText (doc: TextDocument) {
  window.showTextDocument(doc, {
    viewColumn: ViewColumn.Beside
  })
}
