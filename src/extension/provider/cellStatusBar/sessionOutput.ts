import {
  NotebookCell,
  NotebookCellStatusBarItemProvider,
  NotebookCellStatusBarItem,
  NotebookCellKind,
} from 'vscode'

import { Kernel } from '../../kernel'
import { isDocumentSessionOutputs } from '../../serializer'

import CellStatusBarItem from './items/cellStatusBarItem'
import { GitHubGistStatusBarItem } from './items/githubGist'

/**
 * Cell Status Bar items provider for Session Output Only.
 */
export class SessionOutputCellStatusBarProvider implements NotebookCellStatusBarItemProvider {
  #cellStatusBarItems: Set<CellStatusBarItem>

  constructor(private readonly kernel: Kernel) {
    this.#cellStatusBarItems = new Set()
    this.#cellStatusBarItems.add(new GitHubGistStatusBarItem(this.kernel))
    this.#registerCommands()
  }

  #registerCommands() {
    this.#cellStatusBarItems.forEach((statusBarItem: CellStatusBarItem) => {
      try {
        statusBarItem.registerCommands()
      } catch (_error) {
        console.error(`Failed to register commands for ${statusBarItem.constructor.name}`)
      }
    })
  }

  async provideCellStatusBarItems(
    cell: NotebookCell,
  ): Promise<NotebookCellStatusBarItem[] | undefined> {
    if (cell.kind !== NotebookCellKind.Code) {
      return
    }

    const isSessionsOutput = isDocumentSessionOutputs(cell.notebook.metadata)

    if (!isSessionsOutput) {
      return
    }

    const items = Array.from(this.#cellStatusBarItems)
      .map((item: CellStatusBarItem) => item.getStatusBarItem(cell))
      .filter((item) => item !== undefined) as NotebookCellStatusBarItem[]

    if (items.length) {
      return items
    }
  }
}
