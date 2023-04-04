import { join, basename, dirname, resolve } from 'node:path'

import {
  TreeItem,
  EventEmitter,
  workspace,
  TreeItemCollapsibleState,
  Command,
  TreeDataProvider,
  Event,
  Uri,
  commands,
  FileType,
  Disposable,
} from 'vscode'

import { Kernel } from '../kernel'
import { mapGitIgnoreToGlobFolders, getPathType } from '../utils'

interface IRunmeFileProps {
  tooltip: string
  lightIcon: string
  darkIcon: string
  collapsibleState: TreeItemCollapsibleState
  onSelectedCommand?: Command
  contextValue: string
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

export class RunmeFile extends TreeItem {
  constructor(public label: string, options: IRunmeFileProps) {
    super(label, options.collapsibleState)
    const assetsPath = join(__filename, '..', '..', 'assets')

    this.tooltip = options.tooltip
    this.command = options.onSelectedCommand
    this.contextValue = options.contextValue
    this.iconPath = {
      light: join(assetsPath, options.lightIcon),
      dark: join(assetsPath, options.darkIcon),
    }
  }
}

export class RunmeLauncherProvider implements TreeDataProvider<RunmeFile>, Disposable {
  #disposables: Disposable[] = []

  private filesTree: Map<string, TreeFile> = new Map()
  private defaultItemState: TreeItemCollapsibleState = TreeItemCollapsibleState.Collapsed

  constructor(private workspaceRoot?: string | undefined) {
    const watcher = workspace.createFileSystemWatcher(
      '**/*.md',
      false,
      true,
      false
    )
    this.#disposables.push(
      watcher.onDidCreate((file) => this.#onFileChange(file, true)),
      watcher.onDidDelete((file) => this.#onFileChange(file))
    )
  }

  private _onDidChangeTreeData: EventEmitter<RunmeFile | undefined> = new EventEmitter<RunmeFile | undefined>()
  readonly onDidChangeTreeData: Event<RunmeFile | undefined> = this._onDidChangeTreeData.event

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
      return [...this.filesTree.keys()].map((folder) => new RunmeFile(folder, {
        collapsibleState: this.defaultItemState,
        tooltip: 'Click to open runme files from folder',
        lightIcon: 'folder.svg',
        darkIcon: 'folder.svg',
        contextValue: 'folder',
      })).sort((a: RunmeFile, b: RunmeFile) => a.label.length > b.label.length ? 1 : -1)
    }

    const { files, folderPath } = this.filesTree.get(element.label as string) || { files: [] }
    return files.map((file) => new RunmeFile(file, {
      collapsibleState: TreeItemCollapsibleState.None,
      tooltip: 'Click to open runme file',
      lightIcon: 'icon.gif',
      darkIcon: 'icon.gif',
      contextValue: 'markdown-file',
      onSelectedCommand: {
        arguments: [{ file, folderPath }],
        command: 'runme.openRunmeFile',
        title: file,
      }
    }))
  }

  get disposables () {
    return this.#disposables
  }

  getParent () {
    return null
  }

  refresh(): void {
    this.filesTree = new Map()
    this._onDidChangeTreeData.fire(undefined)
  }

  public static async openFile({ file, folderPath }: { file: string, folderPath: string }) {
    const doc = Uri.file(`${folderPath}/${file}`)
    await commands.executeCommand('vscode.openWith', doc, Kernel.type)
  }

  async collapseAll () {
    this.defaultItemState = TreeItemCollapsibleState.Collapsed
    await commands.executeCommand('setContext', 'runme.launcher.isExpanded', false)
    this.refresh()
  }

  async expandAll () {
    this.defaultItemState = TreeItemCollapsibleState.Expanded
    await commands.executeCommand('setContext', 'runme.launcher.isExpanded', true)
    this.refresh()
  }

  private async _scanWorkspace () {
    let excludePatterns

    if (this.workspaceRoot) {
      const gitIgnoreUri = Uri.parse(join(this.workspaceRoot, '.gitignore'))
      const hasGitDirectory = (await getPathType(gitIgnoreUri)) === FileType.File

      if (hasGitDirectory) {
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

    const files = await workspace.findFiles('**/*.md', `{${excludePatterns}}`)
    for (const file of files) {
      this.#addFileToTree(file)
    }
  }

  #uriToEntry (file: Uri) {
    const nameTweaker = i % 2 ? ' ' : ''

    const rootFolder = basename(this.workspaceRoot || '')
    const info = basename(file.path)
    const folderPath = dirname(file.path)
    let folderName = folderPath.replace(resolve(this.workspaceRoot || '', '..'), '') + nameTweaker || rootFolder
    folderName = folderName.startsWith('/') ? folderName.substring(1, folderName.length) : folderName
    return { info, folderPath, folderName }
  }

  #addFileToTree (file: Uri) {
    const { info, folderPath, folderName } = this.#uriToEntry(file)
    if (!this.filesTree.has(folderName)) {
      this.filesTree.set(folderName, { files: [info], folderPath })
    } else {
      const { files } = this.filesTree.get(folderName) || { files: [] }
      this.filesTree.set(folderName, { files: [...files, info], folderPath })
    }
  }

  #onFileChange (file: Uri, isAdded = false) {
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
