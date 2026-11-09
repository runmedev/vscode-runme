import { join, basename, dirname, resolve } from 'node:path'

import {
  TreeItem,
  EventEmitter,
  workspace,
  TreeItemCollapsibleState,
  Command,
  TreeDataProvider,
  Uri,
  commands,
  FileType,
  Disposable,
  ThemeIcon,
} from 'vscode'

import { Kernel } from '../kernel'
import { mapGitIgnoreToGlobFolders, getPathType } from '../utils'

interface IRunmeFileProps {
  tooltip?: string
  lightIcon?: string
  darkIcon?: string
  collapsibleState: TreeItemCollapsibleState
  onSelectedCommand?: Command
  contextValue: string
  description?: string
  iconPath?: string | Uri | { light: string | Uri; dark: string | Uri } | ThemeIcon
  resourceUri?: Uri
  cellIndex?: number
  parent?: string
  documentPath?: string
}

interface TreeFile {
  files: string[]
  folderPath: string
}

/**
 * used to force VS Code update the tree view when user expands/collapses all
 * see https://github.com/microsoft/vscode/issues/172479
 */
let i = 0

export const GLOB_PATTERN = '**/*.{md,mdr,mdx}'

export class RunmeFile extends TreeItem {
  public readonly cellIndex: number | undefined
  public readonly parent?: string
  public readonly documentPath?: string

  constructor(
    public label: string,
    options: IRunmeFileProps,
  ) {
    super(label, options.collapsibleState)

    this.tooltip = options.tooltip
    this.command = options.onSelectedCommand
    this.contextValue = options.contextValue
    this.description = options.description
    this.resourceUri = options.resourceUri
    this.cellIndex = options.cellIndex
    this.parent = options.parent
    this.documentPath = options.documentPath

    if (options.iconPath) {
      this.iconPath = options.iconPath
    } else if (options.lightIcon && options.darkIcon) {
      const assetsPath = join(__filename, '..', '..', 'assets')
      this.iconPath = {
        light: join(assetsPath, options.lightIcon),
        dark: join(assetsPath, options.darkIcon),
      }
    }
  }
}

export type OpenFileOptions = { file: string; folderPath: string; cellIndex?: number }
export interface RunmeTreeProvider extends TreeDataProvider<RunmeFile>, Disposable {
  includeAllTasks: boolean
  excludeUnnamed(): Promise<void>
  includeUnnamed(): Promise<void>
  collapseAll(): Promise<void>
  expandAll(): Promise<void>
  openFile(options: OpenFileOptions): Promise<void>
  openNotebook?(runmeFile: RunmeFile): Promise<void>
  openCell?(runmeFile: RunmeFile): Promise<void>
  runCell?(runmeFile: RunmeFile): Promise<void>
  refreshTasks?(): Promise<void>
  onDidRefresh(callback: VoidFunction): Promise<void>
}

export class RunmeLauncherProvider implements RunmeTreeProvider {
  #disposables: Disposable[] = []

  private _includeAllTasks = false

  private filesTree: Map<string, TreeFile> = new Map()
  private defaultItemState: TreeItemCollapsibleState = TreeItemCollapsibleState.Collapsed
  private _onDidRefresh: EventEmitter<void> = new EventEmitter<void>()

  constructor(private workspaceRoot?: string | undefined) {
    const watcher = workspace.createFileSystemWatcher(GLOB_PATTERN, false, true, false)
    this.#disposables.push(
      watcher.onDidCreate((file) => this.#onFileChange(file, true)),
      watcher.onDidDelete((file) => this.#onFileChange(file)),
    )
  }

  onDidRefresh(_callback: VoidFunction): Promise<void> {
    return new Promise<void>((resolve) => {
      resolve()
    })
  }

  public get includeAllTasks(): boolean {
    return this._includeAllTasks
  }

  private _onDidChangeTreeData = new EventEmitter<RunmeFile | undefined>()

  getTreeItem(element: RunmeFile): TreeItem {
    return element
  }

  async getChildren(element?: RunmeFile | undefined): Promise<RunmeFile[]> {
    if (!this.workspaceRoot) {
      return Promise.resolve([])
    }

    /**
     * scan for files first time we render the tree
     */
    if (this.filesTree.size === 0) {
      await this._scanWorkspace()
    }

    if (!element) {
      /**
       * render folders
       */
      return [...this.filesTree.keys()]
        .map(
          (folder) =>
            new RunmeFile(folder, {
              collapsibleState: this.defaultItemState,
              tooltip: 'Click to open runme files from folder',
              lightIcon: 'folder.svg',
              darkIcon: 'folder.svg',
              contextValue: 'folder',
            }),
        )
        .sort((a: RunmeFile, b: RunmeFile) => (a.label.length > b.label.length ? 1 : -1))
    }

    const { files, folderPath } = this.filesTree.get(element.label as string) || { files: [] }
    return files.map(
      (file) =>
        new RunmeFile(file, {
          collapsibleState: TreeItemCollapsibleState.None,
          tooltip: 'Click to open runme file',
          lightIcon: 'icon.png',
          darkIcon: 'icon.png',
          contextValue: 'markdown-file',
          onSelectedCommand: {
            arguments: [{ file, folderPath }],
            command: 'runme.openRunmeFile',
            title: file,
          },
        }),
    )
  }

  get disposables() {
    return this.#disposables
  }

  getParent() {
    return null
  }

  refresh(): void {
    this.filesTree = new Map()
    this._onDidChangeTreeData.fire(undefined)
  }

  async openFile({ file, folderPath }: OpenFileOptions) {
    const doc = Uri.file(`${folderPath}/${file}`)
    await commands.executeCommand('vscode.openWith', doc, Kernel.type)
  }

  get onDidChangeTreeData() {
    return this._onDidChangeTreeData.event
  }

  async collapseAll() {
    this.defaultItemState = TreeItemCollapsibleState.Collapsed
    await commands.executeCommand('setContext', 'runme.launcher.isExpanded', false)
    this.refresh()
  }

  async expandAll() {
    this.defaultItemState = TreeItemCollapsibleState.Expanded
    await commands.executeCommand('setContext', 'runme.launcher.isExpanded', true)
    this.refresh()
  }

  async includeUnnamed() {
    this._includeAllTasks = true
    await commands.executeCommand(
      'setContext',
      'runme.launcher.includeUnnamed',
      this._includeAllTasks,
    )
  }

  async excludeUnnamed() {
    this._includeAllTasks = false
    await commands.executeCommand(
      'setContext',
      'runme.launcher.includeUnnamed',
      this._includeAllTasks,
    )
  }

  private async _scanWorkspace() {
    let excludePatterns

    if (this.workspaceRoot) {
      const gitIgnoreUri = Uri.parse(join(this.workspaceRoot, '.gitignore'))
      const hasGitignoreFile = (await getPathType(gitIgnoreUri)) === FileType.File
      if (hasGitignoreFile) {
        try {
          const ignoreList = await workspace.openTextDocument(gitIgnoreUri)
          const patterns = mapGitIgnoreToGlobFolders(ignoreList.getText().split('\n'))
          excludePatterns = patterns.join(',')
        } catch (err: unknown) {
          console.error(`Failed to read .gitignore file: ${(err as Error).message}`)
        }
      }
    }

    /**
     * we need to tweak the folder name to force VS Code re-render the tree view
     * see https://github.com/microsoft/vscode/issues/172479
     */
    ++i

    const files = await workspace.findFiles(GLOB_PATTERN, `{${excludePatterns}}`)
    for (const file of files) {
      this.#addFileToTree(file)
    }
  }

  #uriToEntry(file: Uri) {
    const nameTweaker = i % 2 ? ' ' : ''

    const rootFolder = basename(this.workspaceRoot || '')
    const info = basename(file.path)
    const folderPath = dirname(file.path)
    let folderName =
      folderPath.replace(resolve(this.workspaceRoot || '', '..'), '') + nameTweaker || rootFolder
    folderName = folderName.startsWith('/')
      ? folderName.substring(1, folderName.length)
      : folderName
    return { info, folderPath, folderName }
  }

  #addFileToTree(file: Uri) {
    const { info, folderPath, folderName } = this.#uriToEntry(file)
    if (!this.filesTree.has(folderName)) {
      this.filesTree.set(folderName, { files: [info], folderPath })
    } else {
      const { files } = this.filesTree.get(folderName) || { files: [] }
      this.filesTree.set(folderName, { files: [...files, info], folderPath })
    }
  }

  #onFileChange(file: Uri, isAdded = false) {
    /**
     * adding a file this way allows us to keep folder open
     * when a file was added
     */
    if (isAdded) {
      this.#addFileToTree(file)
      return this._onDidChangeTreeData.fire(undefined)
    }

    this.refresh()
  }

  dispose() {
    this.refresh()
    this.#disposables.forEach((d) => d.dispose())
  }
}
