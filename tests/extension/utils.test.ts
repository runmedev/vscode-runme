import path from 'node:path'

import vscode, { ExtensionContext, FileType, Uri, commands, workspace } from 'vscode'
import { expect, vi, test, beforeEach, beforeAll, afterAll, suite } from 'vitest'
import { ulid } from 'ulidx'
import simpleGit from 'simple-git'

import {
  getTerminalByCell,
  getKeyInfo,
  normalizeLanguage,
  getAnnotations,
  mapGitIgnoreToGlobFolders,
  hashDocumentUri,
  getGrpcHost,
  openFileAsRunmeNotebook,
  getWorkspaceFolder,
  getWorkspaceEnvs,
  isGitHubLink,
  isDenoScript,
  validateAnnotations,
  setNotebookCategories,
  getNotebookCategories,
  getNamespacedMid,
  bootFile,
  fileOrDirectoryExists,
  isMultiRootWorkspace,
  convertEnvList,
  asWorkspaceRelativePath,
  editJsonc,
  getGitContext,
} from '../../src/extension/utils'
import { ENV_STORE, DEFAULT_ENV } from '../../src/extension/constants'
import { CellAnnotations } from '../../src/types'
import { isInteractiveTerminalDefault } from '../../src/utils/configuration'

vi.mock('simple-git')
vi.mock('../../src/extension/grpc/tcpClient', () => ({}))
vi.mock('../../../src/extension/grpc/runner/v1', () => ({
  ResolveProgramRequest_Mode: vi.fn(),
}))
vi.mock('../../src/utils/configuration', async () => {
  const actual = (await vi.importActual('../../src/utils/configuration')) as any
  return {
    ...actual,
    isInteractiveTerminalDefault: vi.fn(),
  }
})

vi.mock('vscode', async () => {
  const { ulid } = (await vi.importActual('ulidx')) as typeof import('ulidx')
  const mocked = (await vi.importActual('../../__mocks__/vscode')) as any

  const ulid1 = ulid()
  const ulid2 = ulid()

  return {
    ...mocked,
    default: {
      window: {
        terminals: [
          {
            creationOptions: { env: { RUNME_ID: ulid1 } },
            name: `echo hello (RUNME_ID: ${ulid1})`,
          },
          { creationOptions: { env: { RUNME_ID: ulid2 } }, name: `echo hi (RUNME_ID: ${ulid2})` },
        ],
      },
      workspace: {
        getConfiguration: vi.fn(),
        workspaceFolders: [],
        fs: { readFile: vi.fn().mockResolvedValue({}), writeFile: vi.fn() },
      },
      env: {
        machineId: 'test-machine-id',
      },
      NotebookCellKind: {
        Markup: 1,
        Code: 2,
      },
    },
    workspace: {
      asRelativePath: vi.fn(),
      getConfiguration: vi.fn().mockReturnValue(new Map()),
      fs: mocked.workspace.fs,
      workspaceFolders: [],
    },
    commands: {
      executeCommand: vi.fn(),
    },
  }
})
vi.mock('vscode-telemetry')

const PATH = process.env.PATH
beforeAll(() => {
  DEFAULT_ENV.PATH = '/usr/bin'
  ENV_STORE.delete('PATH')
})
afterAll(() => {
  process.env.PATH = PATH
})
beforeEach(() => {
  vi.mocked(workspace.getConfiguration).mockClear()
  vi.mocked(commands.executeCommand).mockClear()
  vi.mocked(isInteractiveTerminalDefault).mockReturnValue(true)
})

test('isInteractive', () => {
  expect(getAnnotations({ metadata: { interactive: 'true' } } as any).interactive).toBe(true)
  expect(getAnnotations({ metadata: { interactive: 'false' } } as any).interactive).toBe(false)
  expect(getAnnotations({ metadata: {} } as any).interactive).toBe(true)
})

test('interactiveIsDefaultFalse', () => {
  vi.mocked(isInteractiveTerminalDefault).mockReturnValue(false)
  expect(getAnnotations({ metadata: { interactive: 'true' } } as any).interactive).toBe(true)
  expect(getAnnotations({ metadata: { interactive: 'false' } } as any).interactive).toBe(false)
  expect(getAnnotations({ metadata: {} } as any).interactive).toBe(false)
})

test('getTerminalByCell', () => {
  expect(
    getTerminalByCell({
      metadata: { 'runme.dev/id': vscode.window.terminals[0].creationOptions['env'].RUNME_ID },
      kind: 2,
    } as any),
  ).toBeTruthy()

  expect(
    getTerminalByCell({
      metadata: { 'runme.dev/id': ulid() },
      kind: 2,
    } as any),
  ).toBeUndefined()

  expect(
    getTerminalByCell({
      kind: 1,
    } as any),
  ).toBeUndefined()
})

test('getKeyInfo', () => {
  const fakeFrontmatter = { shell: '' }
  expect(
    getKeyInfo(
      {
        getText: vi.fn().mockReturnValue('foobar'),
        languageId: 'barfoo',
      } as any,
      {} as any,
      fakeFrontmatter,
    ),
  ).toStrictEqual({
    key: 'barfoo',
    resource: 'None',
  })

  expect(
    getKeyInfo(
      {
        getText: vi.fn().mockReturnValue('deployctl deploy foobar'),
        languageId: 'something else',
      } as any,
      {} as any,
      fakeFrontmatter,
    ),
  ).toStrictEqual({
    key: 'deno',
    resource: 'URI',
  })

  expect(
    getKeyInfo(
      {
        getText: vi
          .fn()
          .mockReturnValue(
            'https://github.com/runmedev/vscode-runme/actions/workflows/release.yml',
          ),
        languageId: 'sh',
      } as any,
      {} as any,
      fakeFrontmatter,
    ),
  ).toStrictEqual({
    key: 'github',
    resource: 'URI',
  })

  expect(
    getKeyInfo(
      {
        getText: vi
          .fn()
          .mockReturnValue(
            'https://console.cloud.google.com/kubernetes/list/overview?project=runme-ci',
          ),
        languageId: 'sh',
      } as any,
      {} as any,
      fakeFrontmatter,
    ),
  ).toStrictEqual({
    key: 'gcp',
    resource: 'URI',
  })

  expect(
    getKeyInfo(
      {
        getText: vi.fn().mockReturnValue(
          // eslint-disable-next-line max-len
          'https://us-east-1.console.aws.amazon.com/ec2/home?region=us-east-1#InstanceDetails:instanceId=$EC2_INSTANCE_ID',
        ),
        languageId: 'sh',
      } as any,
      {} as any,
      fakeFrontmatter,
    ),
  ).toStrictEqual({
    key: 'aws',
    resource: 'URI',
  })

  expect(
    getKeyInfo(
      {
        getText: vi.fn().mockReturnValue(''),
        languageId: 'shellscript',
      } as any,
      {} as any,
      fakeFrontmatter,
    ),
  ).toStrictEqual({
    key: 'sh',
    resource: 'None',
  })

  expect(
    getKeyInfo(
      {
        getText: vi
          .fn()
          .mockReturnValue(
            'export EC2_INSTANCE_ID=123\n' +
              'https://us-east-1.console.aws.amazon.com/ec2/home' +
              '?region=us-east-1#InstanceDetails:instanceId=$EC2_INSTANCE_ID',
          ),
        languageId: 'sh',
      } as any,
      {} as any,
      fakeFrontmatter,
    ),
  ).toStrictEqual({
    key: 'sh',
    resource: 'None',
  })
})

suite('normalizeLanguage', () => {
  test('with zsh', () => {
    const lang = normalizeLanguage('zsh')
    expect(lang).toBe('sh')
  })

  test('with shell', () => {
    const lang = normalizeLanguage('shell')
    expect(lang).toBe('sh')
  })

  test('with sh', () => {
    const lang = normalizeLanguage('sh')
    expect(lang).toBe('sh')
  })
})

suite('mapGitIgnoreToGlobFolders', () => {
  test('map properly to glob patterns folders', () => {
    const gitIgnoreContents = `
    # Logs
    report.[0-9]*.[0-9]*.[0-9]*.[0-9]*.json
    yarn-error.log
    modules/
    out
    node_modules
    /node_modules
    .vscode-test/
    *.vsix
    wasm
    .DS_Store
    coverage
    .wdio-vscode-service
    examples/fresh/deno.lock
    tests/e2e/logs
    tests/e2e/screenshots
    #Comment
    \#README
    !coverage/config
    abc/**
    a/**/b
    hello.*
    jspm_packages/
    `

    const expectedGlobPatterns = [
      '**/modules/**',
      '**/out/**',
      '**/node_modules/**',
      '**/.vscode-test/**',
      '**/wasm/**',
      '**/.DS_Store**',
      '**/coverage/**',
      '**/.wdio-vscode-service**',
      '**/tests/e2e/logs/**',
      '**/tests/e2e/screenshots/**',
      '**/coverage/config/**',
      '**/abc/**/**',
      '**/a/**/b/**',
      '**/jspm_packages/**',
    ]

    const globPatterns = mapGitIgnoreToGlobFolders(gitIgnoreContents.split('\n'))
    expect(globPatterns).toStrictEqual(expectedGlobPatterns)
  })

  test('should handle empty gitignore file properly', () => {
    const gitIgnoreContents = ''
    const expectedGlobPatterns = []
    const globPatterns = mapGitIgnoreToGlobFolders(gitIgnoreContents.split('\n'))
    expect(globPatterns).toStrictEqual(expectedGlobPatterns)
  })
})

test('salt hash filename', () => {
  const hashed = hashDocumentUri('file:///tmp/test/README.md')
  expect(hashed).toBe('6617e96a-2b29-5457-b824-b161ebe678bc')
})

suite('#getAnnotations', () => {
  test('should have sane defaults', () => {
    const d = getAnnotations({
      name: 'command-123',
      'runme.dev/id': '01HGVC6M8Y76XAGAY6MQ06F5XS',
    })
    expect(d).toStrictEqual(<CellAnnotations>{
      background: false,
      closeTerminalOnSuccess: true,
      openTerminalOnError: true,
      cwd: '',
      interactive: true,
      name: 'command-123',
      category: '',
      excludeFromRunAll: false,
      promptEnv: 0,
      id: d.id,
      'runme.dev/id': '01HGVC6M8Y76XAGAY6MQ06F5XS',
      interpreter: '',
    })
  })

  test('should process cell properly', () => {
    const hello: object = {
      kind: 2,
      value: 'echo "Hello World!"',
      languageId: 'sh',
      metadata: { 'runme.dev/name': 'echo-hello' },
    }

    expect(getAnnotations(hello)).toStrictEqual({
      id: undefined,
      background: false,
      closeTerminalOnSuccess: true,
      openTerminalOnError: true,
      cwd: '',
      interactive: true,
      name: 'echo-hello',
      promptEnv: 0,
      excludeFromRunAll: false,
      category: '',
      interpreter: '',
      'runme.dev/name': 'echo-hello',
    })
  })
})

suite('#getGrpcHost', () => {
  test('should return host addr including config port', () => {
    vi.mocked(workspace.getConfiguration).mockReturnValue({
      get: vi.fn().mockReturnValue(7863),
    } as any)
    expect(getGrpcHost()).toStrictEqual('localhost:7863')
  })
})

suite('openFileAsRunmeNotebook', () => {
  beforeEach(() => {
    vi.mocked(commands.executeCommand).mockClear()
  })

  test('runs executecommand', async () => {
    const uri = {} as any
    await openFileAsRunmeNotebook(uri)

    expect(commands.executeCommand).toBeCalledTimes(1)
    expect(commands.executeCommand).toBeCalledWith('vscode.openWith', uri, 'runme')
  })
})

suite('getWorkspaceFolder', () => {
  beforeEach(() => {
    // @ts-ignore
    workspace.workspaceFolders = []
  })

  test('is empty if no workspace folder', async () => {
    expect(await getWorkspaceEnvs()).toStrictEqual({})
  })

  test('identifies correct workspace', () => {
    const workspaceFolder1 = { uri: Uri.file('/foo/bar') }
    const workspaceFolder2 = { uri: Uri.file('/bar/foo') }
    const workspaceFolder3 = { uri: Uri.file('/bar/baz') }

    // @ts-ignore
    workspace.workspaceFolders = [workspaceFolder1, workspaceFolder2, workspaceFolder3]

    expect(getWorkspaceFolder()).toBe(workspaceFolder1)
    expect(getWorkspaceFolder(Uri.file('/bar/baz/.env'))).toBe(workspaceFolder3)
  })
})

suite('getWorkspaceEnvs', () => {
  beforeEach(() => {
    // @ts-ignore
    workspace.workspaceFolders = []

    vi.mocked(workspace.fs.stat).mockReset()
    vi.mocked(workspace.fs.readFile).mockReset()
  })

  test('identifies env files', async () => {
    const workspaceFolder = { uri: Uri.file('/foo/bar') }

    vi.mocked(workspace.fs.stat).mockResolvedValue({ type: FileType.File } as any)
    vi.mocked(workspace.fs.readFile).mockImplementation(async (uri) => {
      if (uri.fsPath === '/foo/bar/.env') {
        return Buffer.from('SECRET_1=secret1_override\nSECRET_2=secret2\n')
      } else if (uri.fsPath === '/foo/bar/.env.local') {
        return Buffer.from('SECRET_1=secret1\nSECRET_3=secret3')
      }

      return Buffer.from([])
    })

    // @ts-ignore
    workspace.workspaceFolders = [workspaceFolder]

    expect(await getWorkspaceEnvs(workspaceFolder.uri)).toStrictEqual({
      SECRET_1: 'secret1_override',
      SECRET_2: 'secret2',
      SECRET_3: 'secret3',
    })
  })
})

suite('isGitHubLink', () => {
  test('Only accepts secure (https) links', () => {
    const cell: any = {
      getText: vi
        .fn()
        .mockReturnValue('http://github.com/runmedev/vscode-runme/actions/workflows/release.yml'),
    }
    expect(isGitHubLink(cell)).toBe(false)
  })

  test('Only accepts github.com links', () => {
    const cell: any = {
      getText: vi
        .fn()
        .mockReturnValue('http://gitmango.com/runmedev/vscode-runme/actions/workflows/release.yml'),
    }
    expect(isGitHubLink(cell)).toBe(false)
  })

  test('Only accepts github.com workflow links', () => {
    const cell: any = {
      getText: vi.fn().mockReturnValue('http://github.com/runmedev/vscode-runme'),
    }
    expect(isGitHubLink(cell)).toBe(false)
  })

  test('Only accepts complete github.com workflow links', () => {
    const cell: any = {
      getText: vi.fn().mockReturnValue('http://github.com/runmedev/vscode-runme/actions/workflows'),
    }
    expect(isGitHubLink(cell)).toBe(false)
  })

  test('Accepts an action workflow link', () => {
    const cell: any = {
      getText: vi
        .fn()
        .mockReturnValue('https://github.com/runmedev/vscode-runme/actions/workflows/release.yml'),
    }
    expect(isGitHubLink(cell)).toBe(true)
  })

  test('Accepts a source code action workflow link', () => {
    const cell: any = {
      getText: vi
        .fn()
        .mockReturnValue(
          'https://github.com/runmedev/vscode-runme/blob/main/.github/workflows/release.yml',
        ),
    }
    expect(isGitHubLink(cell)).toBe(true)
  })
})

suite('isDenoScript', () => {
  test('Rejects invalid deno command', () => {
    const cell: any = {
      getText: vi.fn().mockReturnValue('deno deploy'),
    }
    expect(isDenoScript(cell)).toBe(false)
  })

  test('Accepts only deno deploy script', () => {
    const cell: any = {
      getText: vi.fn().mockReturnValue('deployctl deploy'),
    }
    expect(isDenoScript(cell)).toBe(true)
  })
})

suite('validateAnnotations', () => {
  test('it should fail for invalid annotations values', () => {
    const cell: any = {
      metadata: {
        background: 'invalid',
        interactive: 'invalid',
        closeTerminalOnSuccess: 'invalid',
        openTerminalOnError: 'invalid',
        promptEnv: 'invalid',
        mimeType: 'application/',
      },
      document: { uri: { fsPath: '/foo/bar/README.md' } },
    }
    const result = validateAnnotations(cell)
    expect(result.hasErrors).toBe(true)
    expect(result.errors && Object.entries(result.errors).length).toBe(5)
  })

  test('it should pass for valid annotations values', () => {
    const cell: any = {
      metadata: {
        background: false,
        interactive: true,
        closeTerminalOnSuccess: true,
        openTerminalOnError: true,
        promptEnv: false,
        mimeType: 'text/plain',
      },
      document: { uri: { fsPath: '/foo/bar/README.md' } },
    }
    const result = validateAnnotations(cell)
    expect(result.hasErrors).toBe(false)
  })
})

suite('setNotebookCategories', () => {
  test('should set notebook categories', async () => {
    const contextMock: ExtensionContext = {
      globalState: {
        get: vi.fn().mockReturnValue({
          notebook1: ['shell scripts', 'node.js examples'],
          notebook2: ['more shell scripts'],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    } as any
    const uriMock = {
      path: 'notebook1',
    } as any

    await setNotebookCategories(
      contextMock,
      uriMock,
      new Set(['shell scripts', 'node.js examples']),
    )
    expect(contextMock.globalState.update).toHaveBeenCalledWith('notebookAvailableCategories', {
      notebook1: ['shell scripts', 'node.js examples'],
      notebook2: ['more shell scripts'],
    })
  })

  test('should set a new categories object when empty', async () => {
    const contextMock: ExtensionContext = {
      globalState: {
        get: vi.fn().mockReturnValue(undefined),
        update: vi.fn().mockResolvedValue({}),
      },
    } as any
    const uriMock = {
      path: 'notebook1',
    } as any

    await setNotebookCategories(
      contextMock,
      uriMock,
      new Set(['shell scripts', 'node.js examples']),
    )
    expect(contextMock.globalState.update).toHaveBeenCalledWith('notebookAvailableCategories', {
      notebook1: ['shell scripts', 'node.js examples'],
    })
  })
})

suite('getNotebookCategories', () => {
  test('should get notebook categories', async () => {
    const contextMock: ExtensionContext = {
      globalState: {
        get: vi.fn().mockReturnValue({
          notebook1: ['shell scripts', 'node.js examples'],
          notebook2: ['more shell scripts'],
        }),
      },
    } as any
    const uriMock = {
      path: 'notebook1',
    } as any

    const categories = await getNotebookCategories(contextMock, uriMock)
    expect(contextMock.globalState.get).toHaveBeenCalledWith('notebookAvailableCategories')
    expect(categories).toStrictEqual(['shell scripts', 'node.js examples'])
  })

  test('should get empty categories array for non-existing notebook state', async () => {
    const contextMock: ExtensionContext = {
      globalState: {
        get: vi.fn().mockReturnValue({
          notebook1: ['shell scripts', 'node.js examples'],
          notebook2: ['more shell scripts'],
        }),
      },
    } as any
    const uriMock = {
      path: 'notebook3',
    } as any

    const categories = await getNotebookCategories(contextMock, uriMock)
    expect(contextMock.globalState.get).toHaveBeenCalledWith('notebookAvailableCategories')
    expect(categories).toStrictEqual([])
  })
})

test('getNamespacedMid', () => {
  expect(getNamespacedMid('1836968c0b13822b48750c44bbb356d8ae45bebbd8f990c63b2641092a23ba89')).toBe(
    'af4f113b-0bd0-5d95-ac4c-4d354a9cb84a',
  )
})

suite('bootFile', () => {
  const contextMock: ExtensionContext = {
    globalState: {
      update: vi.fn().mockResolvedValue({}),
    },
  } as any

  test('should prefer boot file before settings', async () => {
    await bootFile(contextMock)
    expect(workspace.getConfiguration).toBeCalledTimes(0)
  })

  test('should load file defined in settings', async () => {
    vi.mocked(workspace.getConfiguration).mockReturnValue({
      get: () => '/foo/Settings.md',
    } as any)
    vi.mocked(workspace.fs.stat).mockImplementation(async (uri) =>
      uri.path.endsWith('Settings.md') ? true : (Promise.reject(new Error('not existing')) as any),
    )
    await bootFile(contextMock)
    expect(commands.executeCommand).toBeCalledWith(
      'vscode.openWith',
      expect.objectContaining({
        path: '/foo/bar/foo/Settings.md',
      }),
      'runme',
    )
  })
})

suite('fileOrDirectoryExists', () => {
  test('should return false when file does not exists', async () => {
    vi.mocked(workspace.fs.stat).mockResolvedValue({ type: FileType.Unknown } as any)
    const path = Uri.parse('.vscode-mango')
    const exists = await fileOrDirectoryExists(path)
    expect(exists).toBe(false)
  })

  test('should return true when file does exists', async () => {
    vi.mocked(workspace.fs.stat).mockResolvedValue({ type: FileType.File } as any)
    const path = Uri.parse('.vscode-mango')
    const exists = await fileOrDirectoryExists(path)
    expect(exists).toBe(true)
  })

  test('should return true when directory does exists', async () => {
    vi.mocked(workspace.fs.stat).mockResolvedValue({ type: FileType.Directory } as any)
    const path = Uri.parse('.vscode-mango')
    const exists = await fileOrDirectoryExists(path)
    expect(exists).toBe(true)
  })
})

suite('isMultiRootWorkspace', () => {
  test('should return true when there are multiple workspace folders', () => {
    // @ts-expect-error
    workspace.workspaceFolders = [
      { uri: Uri.file('/Users/user/Projects/project1') },
      { uri: Uri.file('/Users/user/Projects/project2') },
    ]
    expect(isMultiRootWorkspace()).toStrictEqual(true)
  })

  test('should return false when there is one workspace folder', () => {
    // @ts-expect-error
    workspace.workspaceFolders = [{ uri: Uri.file('/Users/user/Projects/project1') }]
    expect(isMultiRootWorkspace()).toStrictEqual(false)
  })

  test('should return false when workspaceFolders are not defined', () => {
    // @ts-expect-error
    workspace.workspaceFolders = undefined
    expect(isMultiRootWorkspace()).toStrictEqual(false)
  })
})

suite('convertEnvList', () => {
  test('can handle basic example', () => {
    expect(convertEnvList(['a=1', 'b=2', 'c=3\n4'])).toStrictEqual({
      a: '1',
      b: '2',
      c: '3\n4',
    })
  })
})

suite('asWorkspaceRelativePath', () => {
  test('return relative path if sub-path inside workspace base', () => {
    const relativePath = '/to/a/repo'
    vi.mocked(workspace.asRelativePath).mockReturnValue(relativePath)
    expect(asWorkspaceRelativePath('/this/is/a/workspace/path/to/a/repo')).toStrictEqual({
      relativePath,
      outside: false,
    })
  })

  test('return basename if sub-path outside workspace base', () => {
    const absolutePath = '/this/is/a/workspace/path/outside/a/repo'
    vi.mocked(workspace.asRelativePath).mockReturnValue(absolutePath)
    expect(asWorkspaceRelativePath(absolutePath)).toStrictEqual({
      relativePath: path.basename(absolutePath),
      outside: true,
    })
  })
})

suite('editJsonC', () => {
  test('format a JSON with comments properly', () => {
    const jsonText = `{
      "recommendations": [
        "dbaeumer.vscode-eslint",
        "amodio.tsl-problem-matcher",
        "editorconfig.editorconfig",
        "esbenp.prettier-vscode"
      ],
      "unwantedRecommendations": [
        /** This is a json comment and should be respected */
        "publisher.another",
      ]
    }`

    const expectedUpdatedJson =
      // eslint-disable-next-line max-len
      '{\n\t"recommendations": [\n\t\t"dbaeumer.vscode-eslint",\n\t\t"amodio.tsl-problem-matcher",\n\t\t"editorconfig.editorconfig",\n\t\t"esbenp.prettier-vscode",\n\t\t"stateful.runme"\n\t],\n\t"unwantedRecommendations": [\n\t\t/** This is a json comment and should be respected */\n\t\t"publisher.another",\n\t]\n}'

    const result = editJsonc(
      jsonText,
      'recommendations',
      true,
      [
        'dbaeumer.vscode-eslint',
        'amodio.tsl-problem-matcher',
        'editorconfig.editorconfig',
        'esbenp.prettier-vscode',
      ],
      'stateful.runme',
    )
    expect(result).toStrictEqual(expectedUpdatedJson)
  })
})

suite('getGitContext', () => {
  test('should return the correct git context', async () => {
    const gitMock = {
      branch: vi.fn().mockResolvedValue({ current: 'main' }),
      listRemote: vi.fn().mockResolvedValue('https://github.com/user/repo.git'),
      revparse: vi.fn().mockImplementation((params) => {
        if (params[0] === 'HEAD') {
          return 'commit-hash'
        }
        if (params[0] === '--show-prefix') {
          return 'relative-path/'
        }
      }),
    }

    vi.mocked(simpleGit).mockReturnValueOnce(gitMock as unknown as ReturnType<typeof simpleGit>)

    const { branch, commit, repository, relativePath } = await getGitContext('/path/to/repo')

    expect(branch).toBe('main')
    expect(commit).toBe('commit-hash')
    expect(repository).toBe('https://github.com/user/repo.git')
    expect(relativePath).toBe('relative-path/')
  })

  test('should return null values if there is an error', async () => {
    const gitMock = {
      branch: vi.fn().mockRejectedValue(new Error('branch error')),
      listRemote: vi.fn().mockRejectedValue(new Error('listRemote error')),
      revparse: vi.fn().mockRejectedValue(new Error('revparse error')),
      relativePath: vi.fn().mockRejectedValue(new Error('relativePath error')),
    }

    vi.mocked(simpleGit).mockReturnValueOnce(gitMock as unknown as ReturnType<typeof simpleGit>)

    const { branch, commit, repository, relativePath } = await getGitContext('/path/to/repo')

    expect(branch).toBe(null)
    expect(commit).toBe(null)
    expect(repository).toBe(null)
    expect(relativePath).toBe(null)
  })
})
