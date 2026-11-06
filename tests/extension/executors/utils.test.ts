import path from 'node:path'
import fs from 'node:fs/promises'

import { window, Uri } from 'vscode'
import { expect, vi, test, suite, beforeEach } from 'vitest'

import {
  getCellShellPath,
  getSystemShellPath,
  getCellCwd,
  isShellLanguage,
  getCmdShellSeq,
  getCmdSeq,
} from '../../../src/extension/executors/utils'
import { getWorkspaceFolder, getAnnotations } from '../../../src/extension/utils'
import { getCellProgram } from '../../../src/extension/executors/utils'

vi.mock('vscode-telemetry', () => ({}))

vi.mock('vscode')

vi.mock('../../../src/extension/utils', () => {
  return {
    replaceOutput: vi.fn(),
    getWorkspaceFolder: vi.fn(),
    getAnnotations: vi.fn(),
  }
})

vi.mock('node:fs/promises', () => ({
  default: {
    stat: vi.fn(),
  },
}))

const COMMAND_MODE_INLINE_SHELL = 1
const COMMAND_MODE_TEMP_FILE = 2
const COMMAND_MODE_DAGGER = 4

vi.mock('../../../src/extension/grpc/runner/v1', () => ({
  CommandMode: {
    INLINE_SHELL: 1,
    TEMP_FILE: 2,
    DAGGER: 4,
  },
}))

beforeEach(() => {
  vi.mocked(window.showInputBox).mockClear()
  vi.mocked(window.showErrorMessage).mockClear()
})

suite('getCellShellPath', () => {
  test('cell beats frontmatter and system', () => {
    vi.mocked(getAnnotations).mockReturnValueOnce({ interpreter: '/bin/bash' } as any)
    const shellPath = getCellShellPath(
      {} as any,
      {
        metadata: { 'runme.dev/frontmatterParsed': { shell: 'zsh' } },
      } as any,
    )
    expect(shellPath).toStrictEqual('/bin/bash')
  })

  test('frontmatter beats system', () => {
    vi.mocked(getAnnotations).mockReturnValueOnce({ interpreter: '' } as any)
    const shellPath = getCellShellPath(
      {} as any,
      {
        metadata: { 'runme.dev/frontmatterParsed': { shell: 'zsh' } },
      } as any,
    )
    expect(shellPath).toStrictEqual('zsh')
  })

  test('default to system shell', () => {
    vi.mocked(getAnnotations).mockReturnValue({ interpreter: '' } as any)

    let shellPath = getCellShellPath({} as any, {} as any)
    expect(shellPath).toStrictEqual(getSystemShellPath())

    shellPath = getCellShellPath(
      {} as any,
      {
        metadata: { 'runme.dev/frontmatterParsed': { shell: '' } },
      } as any,
    )
    expect(shellPath).toStrictEqual(getSystemShellPath())
  })
})

suite('isShellLanguage', () => {
  test('usual suspects', () => {
    for (const shell of [
      'bash',
      'sh',
      'fish',
      'ksh',
      'zsh',
      'shell',
      'bat',
      'cmd',
      'powershell',
      'pwsh',
    ]) {
      expect(isShellLanguage(shell)).toBeTruthy()
    }
  })
})

suite('getCellProgram', () => {
  test('is inline shell for shell types', async () => {
    for (const shell of [
      'bash',
      'sh',
      'fish',
      'ksh',
      'zsh',
      'shell',
      'bat',
      'cmd',
      'powershell',
      'pwsh',
    ]) {
      vi.mocked(getAnnotations).mockReturnValueOnce({} as any)

      let shellPath = getSystemShellPath()
      if (!shellPath) {
        console.warn(
          `SHELL env not set likely due to non-interactive execution, using ${shell} as default`,
        )
        shellPath = getSystemShellPath(shell)
      }

      expect(getCellProgram({ metadata: {} } as any, {} as any, shell)).toStrictEqual({
        commandMode: COMMAND_MODE_INLINE_SHELL,
        programName: shellPath,
      })
    }
  })

  test('is temp file for non-shell types', async () => {
    vi.mocked(getAnnotations).mockReturnValueOnce({} as any)

    expect(getCellProgram({ metadata: {} } as any, {} as any, 'python')).toStrictEqual({
      commandMode: COMMAND_MODE_TEMP_FILE,
      programName: '',
    })
  })

  test('respects custom interpreter in shell mode', async () => {
    vi.mocked(getAnnotations).mockImplementationOnce(((x: any) => ({
      interpreter: x.interpreter,
    })) as any)

    expect(
      getCellProgram({ metadata: { interpreter: 'fish' } } as any, {} as any, 'sh'),
    ).toStrictEqual({
      commandMode: COMMAND_MODE_INLINE_SHELL,
      programName: 'fish',
    })
  })

  test('respects custom interpreter in temp file mode', async () => {
    vi.mocked(getAnnotations).mockImplementationOnce(((x: any) => ({
      interpreter: x.interpreter,
    })) as any)

    expect(
      getCellProgram({ metadata: { interpreter: 'bun' } } as any, {} as any, 'javascript'),
    ).toStrictEqual({
      commandMode: COMMAND_MODE_TEMP_FILE,
      programName: 'bun',
    })
  })

  test('enables DAGGER command mode for legacy and canonical Dagger commands', async () => {
    vi.mocked(getAnnotations).mockImplementation(((x: any) => ({
      interpreter: x.interpreter,
    })) as any)

    for (const programName of [
      'dagger shell',
      'dagger script',
      '/opt/homebrew/bin/dagger shell',
      'dagger --progress=plain shell',
      '/usr/bin/env dagger script --progress=plain',
    ]) {
      expect(
        getCellProgram({ metadata: { interpreter: programName } } as any, {} as any, 'sh'),
      ).toStrictEqual({
        commandMode: COMMAND_MODE_DAGGER,
        programName,
      })
    }
  })

  test('does not enable DAGGER command mode for terminal shell commands or unrelated interpreters', async () => {
    vi.mocked(getAnnotations).mockImplementation(((x: any) => ({
      interpreter: x.interpreter,
    })) as any)

    for (const programName of ['dagger shell --container alpine', 'not dagger shell']) {
      expect(
        getCellProgram({ metadata: { interpreter: programName } } as any, {} as any, 'sh'),
      ).toStrictEqual({
        commandMode: COMMAND_MODE_INLINE_SHELL,
        programName,
      })
    }
  })
})

suite('getCellCwd', () => {
  const projectRoot = '/project'
  const mdFilePath = '/project/folder/DOC.md'

  const testGetCellCwd = async (
    frontmatter?: string,
    annotation?: string,
    existingFolders?: string[],
    disableMdFile = false,
  ) => {
    const mdFile = disableMdFile ? undefined : mdFilePath

    vi.mocked(getWorkspaceFolder).mockReturnValueOnce({
      uri: Uri.file(projectRoot),
    } as any)

    vi.mocked(getAnnotations).mockReturnValueOnce({
      cwd: annotation,
    } as any)

    vi.mocked(fs.stat).mockImplementation((async (p: string) => ({
      isDirectory: () => existingFolders?.includes(path.normalize(p)),
    })) as any)

    const cwd = await getCellCwd(
      {} as any,
      {
        metadata: {
          'runme.dev/frontmatterParsed': {
            cwd: frontmatter,
          },
        },
      } as any,
      mdFile ? Uri.file(mdFile) : undefined,
    )

    vi.mocked(fs.stat).mockReset()

    return cwd
  }

  test('falls back when cwd doesnt exist', async () => {
    const files = ['/project/folder']

    expect(await testGetCellCwd(undefined, './non_existant', files)).toStrictEqual(
      '/project/folder',
    )
  })

  test('no notebook file', async () => {
    expect(await testGetCellCwd(undefined, undefined, undefined, true)).toStrictEqual(undefined)
  })

  test('no frontmatter', async () => {
    const files = ['/project/folder', '/project', '/project/', '/tmp', '/opt']

    expect(await testGetCellCwd(undefined, undefined, files)).toStrictEqual(
      path.dirname(mdFilePath),
    )

    expect(await testGetCellCwd(undefined, '../', files)).toStrictEqual(
      path.dirname(path.dirname(mdFilePath)) + '/',
    )

    expect(await testGetCellCwd(undefined, '/opt', files)).toStrictEqual('/opt')
  })

  test('absolute frontmatter', async () => {
    const files = ['/project/folder', '/project', '/project/', '/tmp', '/opt', '/']
    const frntmtr = '/tmp'

    expect(await testGetCellCwd(frntmtr, undefined, files)).toStrictEqual('/tmp')

    expect(await testGetCellCwd(frntmtr, '../', files)).toStrictEqual('/')

    expect(await testGetCellCwd(frntmtr, '/opt', files)).toStrictEqual('/opt')
  })

  test('relative frontmatter', async () => {
    const files = ['/project/folder', '/project', '/project/', '/tmp', '/opt', '/']
    const frntmtr = '../'

    expect(await testGetCellCwd(frntmtr, undefined, files)).toStrictEqual(
      path.dirname(path.dirname(mdFilePath)) + '/',
    )

    expect(await testGetCellCwd(frntmtr, '../', files)).toStrictEqual('/')

    expect(await testGetCellCwd(frntmtr, '/opt', files)).toStrictEqual('/opt')
  })
})

suite('getCmdShellSeq', () => {
  test('one command', () => {
    const cellText = 'deno task start'
    expect(getCmdShellSeq(cellText, 'darwin')).toMatchSnapshot()
  })

  test('wrapped command', () => {
    // eslint-disable-next-line max-len
    const cellText = Buffer.from(
      // eslint-disable-next-line max-len
      'ZGVubyBpbnN0YWxsIFwKICAgICAgLS1hbGxvdy1yZWFkIC0tYWxsb3ctd3JpdGUgXAogICAgICAtLWFsbG93LWVudiAtLWFsbG93LW5ldCAtLWFsbG93LXJ1biBcCiAgICAgIC0tbm8tY2hlY2sgXAogICAgICAtciAtZiBodHRwczovL2Rlbm8ubGFuZC94L2RlcGxveS9kZXBsb3ljdGwudHMK',
      'base64',
    ).toString('utf-8')

    expect(getCmdShellSeq(cellText, 'darwin')).toMatchSnapshot()
  })

  test('env only', () => {
    const cellText = `export DENO_INSTALL="$HOME/.deno"
      export PATH="$DENO_INSTALL/bin:$PATH"
    `
    expect(getCmdShellSeq(cellText, 'darwin')).toMatchSnapshot()
  })

  test('complex wrapped', () => {
    // eslint-disable-next-line max-len
    const cellText =
      // eslint-disable-next-line max-len
      'curl "https://api-us-west-2.graphcms.com/v2/cksds5im94b3w01xq4hfka1r4/master?query=$(deno run -A query.ts)" --compressed 2>/dev/null \\\n| jq -r \'.[].posts[] | "(.title) - by (.authors[0].name), id: (.id)"\''
    expect(getCmdShellSeq(cellText, 'darwin')).toMatchSnapshot()
  })

  test('linux without pipefail', () => {
    const cellText = 'ls ~/'
    expect(getCmdShellSeq(cellText, 'linux')).toMatchSnapshot()
  })

  test('windows without shell flags', () => {
    const cellText = 'ls ~/'
    expect(getCmdShellSeq(cellText, 'win32')).toMatchSnapshot()
  })

  test('with comments', () => {
    const cellText =
      // eslint-disable-next-line max-len
      'echo "Install deno via installer script"\n# macOS or Linux\ncurl -fsSL https://deno.land/x/install/install.sh | sh'
    expect(getCmdShellSeq(cellText, 'darwin')).toMatchSnapshot()
  })

  test('trailing comment', () => {
    const cellText = 'cd ..\nls / # list dir contents\ncd ..\nls /'
    expect(getCmdShellSeq(cellText, 'darwin')).toMatchSnapshot()
  })

  test('leading prompts', () => {
    const cellText = '$ docker build -t runme/demo .\n$ docker ps -qa'
    expect(getCmdShellSeq(cellText, 'darwin')).toMatchSnapshot()
  })
})

suite('getCmdSeq', () => {
  test('Rejects invalid deno command', () => {
    const cellText = `export DENO_INSTALL="$HOME/.deno"
    export PATH="$DENO_INSTALL/bin:$PATH"
  `
    const result = getCmdSeq(cellText)
    expect(result).toStrictEqual([
      'export DENO_INSTALL="$HOME/.deno"',
      'export PATH="$DENO_INSTALL/bin:$PATH"',
    ])
  })
})
