import {
  Disposable,
  Event,
  EventEmitter,
  FileChangeEvent,
  FileStat,
  FileSystemError,
  FileSystemProvider,
  FileType,
  Uri,
} from 'vscode'

import getOneWorkflow from '../messages/platformRequest/getOneWorkflow'
import getAllWorkflows from '../messages/platformRequest/getAllWorkflows'

type Workflow = {
  owner: string
  repository: string
  path: string
  id: string
}

type PathTree = Record<string, string[]>

const excludedPaths = [
  '.vscode/tasks.json',
  '.vscode/launch.json',
  '.vscode/settings.json',
  '.runme_bootstrap',
  '.runme_bootstrap_demo',
]

export const StatefulFsScheme = 'statefulfs'

export function mergeUriPaths(uri: Uri, newPath: string): Uri {
  const isAbsolutePath = newPath.startsWith('/')

  if (isAbsolutePath) {
    return uri.with({ path: newPath })
  }

  const currentPath = uri.path
  const combinedPath = currentPath.replace(/\/+$/, '') + '/' + newPath

  return uri.with({ path: combinedPath })
}

/**
 * Handles the virtual file system statefulfs://
 */
export default class StatefulFS implements FileSystemProvider {
  private _onDidChangeFile: EventEmitter<FileChangeEvent[]> = new EventEmitter<FileChangeEvent[]>()
  readonly onDidChangeFile: Event<FileChangeEvent[]> = this._onDidChangeFile.event

  #notebooks: Workflow[] = []
  #pathTree: PathTree = {}

  get root() {
    return Uri.parse(`${StatefulFsScheme}:///`)
  }

  static resolveUri(path: string) {
    return Uri.parse(`${StatefulFsScheme}:///${path}`)
  }

  async readFile(uri: Uri): Promise<Uint8Array> {
    let id: string | undefined = uri.query.split('=')[1]
    id = id || (await this.notebooks()).find((n) => `/${n.path}` === uri.path)?.id

    if (!id) {
      throw FileSystemError.FileNotFound(uri)
    }
    try {
      const workflow = await getOneWorkflow(id)
      const data = workflow.data.workflow.data || ''
      return new Uint8Array(data)
    } catch (_error) {
      throw FileSystemError.FileNotFound(uri)
    }
  }

  writeFile(
    uri: Uri,
    _content: Uint8Array,
    options: { create: boolean; overwrite: boolean },
  ): void {
    console.log(`${uri} ${options}`)
  }

  watch(_uri: Uri, _options: { recursive: boolean; excludes: string[] }): Disposable {
    return new Disposable(() => {})
  }

  isFile(pathname: string): boolean {
    const parts = pathname.split('/')
    const lastPart = parts[parts.length - 1]
    const hasExtension = lastPart && /\.[^/.]+$/.test(lastPart)
    return Boolean(hasExtension)
  }

  isDir(pathname: string): boolean {
    return !this.isFile(pathname)
  }

  async stat(uri: Uri): Promise<FileStat> {
    if (excludedPaths.includes(uri.path)) {
      throw FileSystemError.FileNotFound(uri)
    }

    if (this.#pathTree[uri.path] || this.isDir(uri.path)) {
      return {
        type: FileType.Directory,
        ctime: Date.now(),
        mtime: Date.now(),
        size: 0,
      }
    }

    return {
      type: FileType.File,
      size: (await this.readFile(uri)).byteLength,
      ctime: Date.now(),
      mtime: Date.now(),
    }
  }

  getTreeNodes(notebooks: Workflow[]): PathTree {
    const nodes: PathTree = {}
    nodes['/'] = []

    notebooks.forEach((notebook) => {
      const parts = notebook.path.split('/')
      let currentPath = ''

      // This loop will process all parts of the path, no matter how deep
      for (let i = 0; i < parts.length; i++) {
        const prevPath = currentPath || '/'
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : `/${parts[i]}`

        if (!nodes[prevPath]) {
          nodes[prevPath] = []
        }

        if (!nodes[prevPath].includes(parts[i])) {
          nodes[prevPath].push(parts[i])
        }
      }
    })

    return nodes
  }

  async notebooks() {
    if (!this.#notebooks.length) {
      let response = await getAllWorkflows({ minRating: 1 })
      if (!response?.data?.workflows.length) {
        response = await getAllWorkflows()
      }
      const data = response?.data?.workflows.filter(
        (notebook): notebook is NonNullable<typeof notebook> => notebook !== null,
      )

      this.#notebooks = data.map((notebook) => {
        const [owner, repository] = notebook.repository.split('/')

        return {
          id: notebook.id,
          path: `${repository}/${notebook.path}`,
          repository: repository,
          owner: owner,
        }
      })
    }

    return this.#notebooks
  }

  async getPathTree() {
    if (!this.#pathTree.length) {
      this.#pathTree = this.getTreeNodes(await this.notebooks())
    }
    return this.#pathTree
  }

  async readDirectory(parent: Uri): Promise<[string, FileType][]> {
    const children = (await this.getPathTree())[parent.path] || []

    const isRoot = parent.path === '/'
    return children.map((child) => {
      if (isRoot) {
        return [child, FileType.Directory]
      }

      const path = `${parent.path}/${child}`
      return [child, path in this.#pathTree ? FileType.Directory : FileType.File]
    })
  }

  createDirectory(_uri: Uri): void {}

  delete(_uri: Uri): void {}

  rename(_oldUri: Uri, _newUri: Uri, _options: { overwrite: boolean }): void {}
}
