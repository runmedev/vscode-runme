import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'

import { expect, test, vi } from 'vitest'

import { OutputType } from '../../../src/constants'
import { sh } from '../../../src/extension/executors/shell'

vi.mock('vscode')
vi.mock('node:child_process')
vi.mock('../../../src/extension/utils', () => ({
  getAnnotations: vi.fn().mockReturnValue({}),
}))

test('runs vercel as an ordinary shell command', async () => {
  const child = new EventEmitter() as EventEmitter & {
    pid: number
    stdin: { destroy: ReturnType<typeof vi.fn> }
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  child.pid = 42
  child.stdin = { destroy: vi.fn() }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn().mockReturnValue(true)
  vi.mocked(spawn).mockReturnValue(child as any)

  const replaceOutputs = vi.fn()
  const execution = sh({
    exec: {
      cell: { metadata: {} },
      token: { onCancellationRequested: vi.fn() },
    },
    outputs: { replaceOutputs },
    script: 'vercel',
    cwd: '/workspace',
    env: {},
  } as any)

  child.stdout.emit('data', Buffer.from('https://example.vercel.app'))
  child.emit('exit', 0)

  await expect(execution).resolves.toBe(true)
  expect(spawn).toHaveBeenCalledWith('vercel', {
    cwd: '/workspace',
    shell: true,
    env: {},
  })
  expect(replaceOutputs).toHaveBeenCalledOnce()
  expect(replaceOutputs.mock.calls[0][0][0].items[0].mime).toBe(OutputType.outputItems)
})
