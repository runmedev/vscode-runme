import {
  NotebookCell,
  NotebookCellStatusBarItemProvider,
  NotebookCellStatusBarItem,
  NotebookCellKind,
} from 'vscode'

import { Kernel } from '../../kernel'
import { isDocumentSessionOutputs } from '../../serializer'

import { AnnotationsStatusBarItem } from './items/annotations'
import { CopyStatusBarItem } from './items/copy'
import CellStatusBarItem from './items/cellStatusBarItem'
import { ForkStatusBarItem } from './items/fork'
import { NamedStatusBarItem } from './items/named'
import { CLIStatusBarItem } from './items/cli'

/**
 * Cell Status Bar items provider for Runme Notebooks Only.
 */
export class NotebookCellStatusBarProvider implements NotebookCellStatusBarItemProvider {
  #cellStatusBarItems: Set<CellStatusBarItem>

  constructor(private readonly kernel: Kernel) {
    this.#cellStatusBarItems = new Set()
    this.#cellStatusBarItems.add(new AnnotationsStatusBarItem(this.kernel))
    this.#cellStatusBarItems.add(new CopyStatusBarItem(this.kernel))
    this.#cellStatusBarItems.add(new NamedStatusBarItem(this.kernel))
    this.#cellStatusBarItems.add(new CLIStatusBarItem(this.kernel))
    this.#cellStatusBarItems.add(new ForkStatusBarItem(this.kernel))

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

    if (isSessionsOutput) {
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
