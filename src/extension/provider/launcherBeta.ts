import { basename, dirname } from 'node:path'

import {
  workspace,
  Disposable,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  CancellationTokenSource,
  NotebookData,
  commands,
  window,
  EventEmitter,
  tasks as vscodeTasks,
  Task,
} from 'vscode'

import { asWorkspaceRelativePath, getAnnotations } from '../utils'
import { Kernel } from '../kernel'
import getLogger from '../logger'
import { ISerializer } from '../serializer'
import { LANGID_AND_EXTENSIONS } from '../../constants'

import { OpenFileOptions, RunmeFile, RunmeTreeProvider } from './launcher'

export const GLOB_PATTERN = '**/*.{md,mdr,mdx}'
const logger = getLogger('RunmeLauncherProvider')

export class RunmeLauncherProvider implements RunmeTreeProvider {
  #disposables: Disposable[] = []
  private allowUnnamed = false
  private defaultItemState = TreeItemCollapsibleState.Collapsed
  private _onDidChangeTreeData = new EventEmitter<RunmeFile | undefined>()
  private notebooks: RunmeFile[] = []
  private _onDidRefresh: EventEmitter<void> = new EventEmitter<void>()

  constructor(
    private kernel: Kernel,
    private serializer: ISerializer,
  ) {
    const watcher = workspace.createFileSystemWatcher(GLOB_PATTERN, false, true, false)

    this.#disposables.push(
      watcher.onDidCreate((file) => logger.info('onDidCreate: ', file.fsPath)),
      watcher.onDidDelete((file) => logger.info('onDidDelete: ', file.fsPath)),
    )
  }

  public get includeAllTasks(): boolean {
    return this.allowUnnamed
  }

  async includeUnnamed() {
    this.allowUnnamed = true
    this.notebooks = []
    await commands.executeCommand('setContext', 'runme.launcher.includeUnnamed', this.allowUnnamed)
    this._onDidChangeTreeData.fire(undefined)
  }

  onDidRefresh(callback: VoidFunction): Promise<void> {
    return new Promise<void>((resolve) => {
      this._onDidRefresh.event(() => {
        callback()
        this._onDidChangeTreeData.fire(undefined)
        resolve()
      })
    })
  }

  async refreshTasks() {
    this.notebooks = []
    this._onDidRefresh.fire(undefined)
  }

  async excludeUnnamed() {
    this.allowUnnamed = false
    this.notebooks = []
    await commands.executeCommand('setContext', 'runme.launcher.includeUnnamed', this.allowUnnamed)
    this._onDidChangeTreeData.fire(undefined)
  }

  get onDidChangeTreeData() {
    return this._onDidChangeTreeData.event
  }

  async collapseAll() {
    this.defaultItemState = TreeItemCollapsibleState.Collapsed
    await commands.executeCommand('setContext', 'runme.launcher.isExpanded', false)
    this._onDidChangeTreeData.fire(undefined)
  }

  async expandAll() {
    this.defaultItemState = TreeItemCollapsibleState.Expanded
    await commands.executeCommand('setContext', 'runme.launcher.isExpanded', true)
    this._onDidChangeTreeData.fire(undefined)
  }

  getTreeItem(element: RunmeFile): TreeItem {
    return element
  }

  async getChildren(element?: RunmeFile | undefined): Promise<RunmeFile[]> {
    if (!element) {
      /**
       * we need to tweak the folder name to force VS Code re-render the tree view
       * see https://github.com/microsoft/vscode/issues/172479
       */
      if (this.notebooks.length) {
        return this.notebooks.reduce((acc: RunmeFile[], notebook: RunmeFile) => {
          if (!notebook.parent) {
            acc.push({
              ...notebook,
              collapsibleState: this.defaultItemState,
              label: this.resolveLabel(notebook.label),
            })
          }
          return acc
        }, [])
      }

      const tasks = await vscodeTasks.fetchTasks({ type: 'runme' })
      const notebooks = await this.getNotebooks(tasks)
      this.notebooks = [...notebooks]

      const cellsPromises = this.notebooks.map((element) => this.getCells(tasks, element))

      const cells = await Promise.all(cellsPromises)
      this.notebooks.push(...cells.flat())

      return notebooks
    }

    return this.notebooks.filter((f) => f.parent === element.label.trim())
  }

  resolveLabel(relativePath: string) {
    return `${relativePath.trim()}${this.defaultItemState === 1 ? ' ' : ''}`
  }

  getNotebooks(tasks: Task[]): RunmeFile[] {
    const foundTasks: RunmeFile[] = []
    let prevDir: string | undefined

    for (const task of tasks) {
      const { definition } = task
      const fileUri = definition.fileUri as Uri
      const documentPath = fileUri.path
      const { outside, relativePath } = asWorkspaceRelativePath(documentPath)

      if (outside) {
        continue
      }

      if (prevDir === relativePath) {
        continue
      }

      prevDir = relativePath
      foundTasks.push(
        new RunmeFile(this.resolveLabel(relativePath), {
          documentPath: documentPath,
          collapsibleState: this.defaultItemState,
          lightIcon: 'icon.png',
          darkIcon: 'icon.png',
          contextValue: 'markdownNotebook',
        }),
      )
    }

    return foundTasks
  }

  async getCells(tasks: Task[], element: RunmeFile): Promise<RunmeFile[]> {
    const foundTasks: RunmeFile[] = []
    const parent = element.label.trim()
    let mdBuffer: Uint8Array
    let prevFile: string | undefined
    let notebook: NotebookData | undefined

    for (const task of tasks) {
      const {
        name,
        definition: { fileUri, isNameGenerated },
      } = task
      const documentPath = fileUri?.path
      const { outside, relativePath } = asWorkspaceRelativePath(documentPath)

      if (outside || (!this.allowUnnamed && isNameGenerated)) {
        continue
      }

      if (parent !== relativePath) {
        continue
      }

      if (prevFile !== documentPath) {
        prevFile = documentPath

        try {
          mdBuffer = await workspace.fs.readFile(Uri.parse(documentPath))
        } catch (err: any) {
          if (err.code !== 'FileNotFound') {
            logger.error(`${err.message}`)
          }
          throw err
        }

        const token = new CancellationTokenSource().token
        notebook = await this.serializer.deserializeNotebook(mdBuffer, token)
      }

      if (!notebook) {
        continue
      }

      const cell = notebook.cells.find((cell) => cell.metadata?.['runme.dev/name'] === name)
      if (!cell) {
        continue
      }

      const { excludeFromRunAll } = getAnnotations(cell.metadata)
      const cellText = 'value' in cell ? cell.value : ''
      const languageId = ('languageId' in cell && cell.languageId) || 'sh'
      const cellIndex = notebook.cells.findIndex(
        (cell) => cell.metadata?.['runme.dev/name'] === name,
      )

      const lines = cellText.split('\n')
      const tooltip = lines.length > 3 ? [...lines.slice(0, 3), '...'].join('\n') : lines.join('\n')

      foundTasks.push(
        new RunmeFile(`${name}${!excludeFromRunAll ? '*' : ''}`, {
          description: `${lines.at(0)}`,
          tooltip: tooltip,
          cellIndex: cellIndex,
          documentPath: documentPath,
          parent: parent,
          onSelectedCommand: {
            arguments: [
              {
                file: basename(documentPath),
                folderPath: dirname(documentPath),
                cellIndex: cellIndex,
              },
            ],
            command: 'runme.openRunmeFile',
            title: name,
          },
          resourceUri: Uri.parse(`${name}.${this.resolveExtension(languageId)}`),
          collapsibleState: TreeItemCollapsibleState.None,
          contextValue: 'markdownCell',
        }),
      )
    }

    return Promise.resolve(foundTasks)
  }

  async openNotebook(runmeFile: RunmeFile) {
    await this.getNoteboookEditor(runmeFile, false)
  }

  async openFile({ file, folderPath, cellIndex }: OpenFileOptions) {
    const doc = Uri.file(`${folderPath}/${file}`)
    await commands.executeCommand('vscode.openWith', doc, Kernel.type)

    if (cellIndex === undefined) {
      return
    }

    const notebookEditor = window.visibleNotebookEditors.find((editor) => {
      return editor.notebook.uri.path === doc.path
    })

    if (notebookEditor && this.kernel) {
      await this.kernel.focusNotebookCell(notebookEditor.notebook.cellAt(cellIndex))
    }
  }

  async getNoteboookEditor(runmeFile: RunmeFile, requireCellIndex = true) {
    if (!runmeFile.documentPath) {
      return
    }

    if (requireCellIndex && runmeFile.cellIndex === undefined) {
      return
    }

    const file = basename(runmeFile.documentPath)
    const folderPath = dirname(runmeFile.documentPath)
    const docUri = Uri.file(`${folderPath}/${file}`)

    let notebookEditor = window.visibleNotebookEditors.find((editor) => {
      return editor.notebook.uri.path === docUri.path
    })

    if (!notebookEditor) {
      await commands.executeCommand('vscode.openWith', docUri, Kernel.type)
      notebookEditor = window.visibleNotebookEditors.find((editor) => {
        return editor.notebook.uri.path === docUri.path
      })
    }

    return notebookEditor
  }

  async runCell(runmeFile: RunmeFile) {
    const notebookEditor = await this.getNoteboookEditor(runmeFile)
    if (runmeFile.cellIndex !== undefined && notebookEditor) {
      await this.kernel.executeAndFocusNotebookCell(
        notebookEditor.notebook.cellAt(runmeFile.cellIndex),
      )
    }
  }

  async openCell(runmeFile: RunmeFile) {
    const notebookEditor = await this.getNoteboookEditor(runmeFile)
    if (runmeFile.cellIndex !== undefined && notebookEditor) {
      await this.kernel.focusNotebookCell(notebookEditor.notebook.cellAt(runmeFile.cellIndex))
    }
  }

  dispose() {
    this.#disposables.forEach((d) => d.dispose())
  }

  resolveExtension(languageId: string): string {
    const key = languageId.toLowerCase()
    return LANGID_AND_EXTENSIONS.get(key) || languageId
  }
}
