import url from 'node:url'

import { window } from 'vscode'
import { expect, vi, test, beforeEach } from 'vitest'

import { ENV_STORE } from '../../../src/extension/constants'
import { retrieveShellCommand } from '../../../src/extension/executors/utils'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

vi.mock('vscode', () => ({
  window: {
    showInputBox: vi.fn(),
    showErrorMessage: vi.fn()
  },
  workspace: {
    getConfiguration: vi.fn()
  }
}))

beforeEach(() => {
  vi.mocked(window.showInputBox).mockClear()
  vi.mocked(window.showErrorMessage).mockClear()
})

test('should support export without quotes', async () => {
  const exec: any = {
    cell: {
      metadata: { executeableCode: 'export foo=bar' },
      document: {
        getText: vi.fn().mockReturnValue('export foo=bar'),
        uri: { fsPath: __dirname }
      }
    }
  }
  vi.mocked(window.showInputBox).mockResolvedValue('barValue')
  const cellText = await retrieveShellCommand(exec)
  expect(cellText).toBe('')
  expect(ENV_STORE.get('foo')).toBe('barValue')
  expect(vi.mocked(window.showInputBox).mock.calls[0][0]?.placeHolder).toBe('bar')
  expect(vi.mocked(window.showInputBox).mock.calls[0][0]?.value).toBe(undefined)
})

test('should populate value if quotes are used', async () => {
  const exec: any = {
    cell: {
      metadata: { executeableCode: 'export foo="bar"' },
      document: {
        getText: vi.fn().mockReturnValue('export foo="bar"'),
        uri: { fsPath: __dirname }
      }
    }
  }
  vi.mocked(window.showInputBox).mockResolvedValue('barValue')
  const cellText = await retrieveShellCommand(exec)
  expect(cellText).toBe('')
  expect(ENV_STORE.get('foo')).toBe('barValue')
  expect(vi.mocked(window.showInputBox).mock.calls[0][0]?.placeHolder).toBe('bar')
  expect(vi.mocked(window.showInputBox).mock.calls[0][0]?.value).toBe('bar')
})

test('can support single quotes', async () => {
  const exec: any = {
    cell: {
      metadata: { executeableCode: 'export foo=\'bar\'' },
      document: {
        getText: vi.fn().mockReturnValue('export foo=\'bar\''),
        uri: { fsPath: __dirname }
      }
    }
  }
  vi.mocked(window.showInputBox).mockResolvedValue('barValue')
  const cellText = await retrieveShellCommand(exec)
  expect(cellText).toBe('')
  expect(ENV_STORE.get('foo')).toBe('barValue')
  expect(vi.mocked(window.showInputBox).mock.calls[0][0]?.placeHolder).toBe('bar')
  expect(vi.mocked(window.showInputBox).mock.calls[0][0]?.value).toBe('bar')
})

test('can handle new lines before and after', async () => {
  const exec: any = {
    cell: {
      metadata: { executeableCode: '\n\nexport foo=bar\n' },
      document: {
        getText: vi.fn().mockReturnValue('\n\nexport foo=bar\n'),
        uri: { fsPath: __dirname }
      }
    }
  }
  const cellText = await retrieveShellCommand(exec)
  expect(cellText).toBe('\n')
})

test('can populate pre-existing envs', async () => {
  const exec: any = {
    cell: {
      metadata: { executeableCode: 'export foo="foo$BARloo"' },
      document: {
        getText: vi.fn().mockReturnValue('export foo="foo$BARloo"'),
        uri: { fsPath: __dirname }
      }
    }
  }
  process.env.BAR = 'rab'
  vi.mocked(window.showInputBox).mockResolvedValue('foo$BAR')
  const cellText = await retrieveShellCommand(exec)
  expect(cellText).toBe('')
  expect(ENV_STORE.get('foo')).toBe('foorab')
})

test('can support expressions', async () => {
  const exec: any = {
    cell: {
      metadata: { executeableCode: 'export foo=$(echo "foo$BAR")' },
      document: {
        getText: vi.fn().mockReturnValue('export foo=$(echo "foo$BAR")'),
        uri: { fsPath: __dirname }
      }
    }
  }
  process.env.BAR = 'bar'
  const cellText = await retrieveShellCommand(exec)
  expect(cellText).toBe('')
  expect(ENV_STORE.get('foo')).toBe('foobar\n')
})

test('returns undefined if expression fails', async () => {
  const exec: any = {
    cell: {
      metadata: { executeableCode: 'export foo=$(FAIL)' },
      document: {
        getText: vi.fn().mockReturnValue('export foo=$(FAIL)'),
        uri: { fsPath: __dirname }
      }
    }
  }
  expect(await retrieveShellCommand(exec)).toBeUndefined()
  expect(window.showErrorMessage).toBeCalledTimes(1)
})

test('supports multiline exports', async () => {
  const exec: any = {
    cell: {
      metadata: { executeableCode: 'export bar=foo\nexport foo="some\nmultiline\nexport"\nexport foobar="barfoo"' },
      document: {
        getText: vi.fn().mockReturnValue(
          'export bar=foo\nexport foo="some\nmultiline\nexport"\nexport foobar="barfoo"'
        ),
        uri: { fsPath: __dirname }
      }
    }
  }
  vi.mocked(window.showInputBox).mockImplementation(({ value, placeHolder }: any) => value || placeHolder)
  const cellText = await retrieveShellCommand(exec)
  expect(cellText).toBe('')
  expect(ENV_STORE.get('bar')).toBe('foo')
  expect(ENV_STORE.get('foo')).toBe('some\nmultiline\nexport')
  expect(ENV_STORE.get('foobar')).toBe('barfoo')
  expect(window.showInputBox).toBeCalledTimes(2)
})
