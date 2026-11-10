import { spawn } from 'node:child_process'

import { NotebookCellOutput, NotebookCellOutputItem } from 'vscode'

import { OutputType } from '../../constants'
import type { CellOutputPayload } from '../../types'
import { getAnnotations } from '../utils'
import getLogger from '../logger'

import { IKernelExecutorOptions } from '.'

const MIME_TYPES_WITH_CUSTOM_RENDERERS = ['text/plain']
const log = getLogger('shellExecutor')

interface IKernelShellExecutorOptions extends IKernelExecutorOptions {
  script: string
  cwd: string
  env: Record<string, string>
}

type IKernelShellExecutor = (executor: IKernelShellExecutorOptions) => Promise<boolean>

const shellExecutor: IKernelShellExecutor = async (executor) => {
  const { exec, outputs, script, cwd, env } = executor
  const outputItems: Buffer[] = []
  const child = spawn(script, { cwd, shell: true, env })
  log.info(`Started process on pid ${child.pid}`)
  /**
   * this needs more work / specification
   */
  const annotations = getAnnotations(exec.cell)
  const mime = annotations?.mimeType || ('text/plain' as const)
  /**
   * handle output for stdout and stderr
   */
  async function handleOutput(data: Buffer) {
    outputItems.push(data)
    let item: NotebookCellOutputItem

    if (MIME_TYPES_WITH_CUSTOM_RENDERERS.includes(mime)) {
      item = NotebookCellOutputItem.json(
        <CellOutputPayload<OutputType.outputItems>>{
          type: OutputType.outputItems,
          output: {
            content: Buffer.concat(outputItems).toString('base64'),
            mime,
          },
        },
        OutputType.outputItems,
      )
    } else {
      item = new NotebookCellOutputItem(Buffer.concat(outputItems), mime)
    }

    outputs.replaceOutputs([new NotebookCellOutput([item])])
  }

  child.stdout.on('data', handleOutput)
  child.stderr.on('data', handleOutput)
  return !Boolean(
    await new Promise<number>((resolve) => {
      /**
       * register cancellation handler
       * ToDo(Christian): maybe better to kill with SIGINT signal but that doesn't stop the
       * prcoess afterall
       */
      exec.token.onCancellationRequested(() => {
        child.stdin.destroy()
        child.stdout.off('data', handleOutput)
        child.stderr.off('data', handleOutput)

        if (child.pid) {
          process.kill(child.pid, 'SIGHUP')
        }
        resolve(child.kill('SIGHUP') ? 0 : 1)
      })

      child.on('exit', resolve)
    }),
  )
}

export const sh = shellExecutor
export const bash = shellExecutor
