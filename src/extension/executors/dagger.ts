import { updateCellMetadata } from '../cell'
import { OutputType } from '../../constants'

import { bash } from './task'

import type { IKernelExecutor } from '.'

export const dagger: IKernelExecutor = async (executor) => {
  const { exec, outputs, runScript } = executor

  try {
    return runScript?.() ?? bash(executor)
  } catch (_err: any) {
    updateCellMetadata(exec.cell, {
      'runme.dev/daggerState': {},
    })
    outputs.showOutput(OutputType.daggerCall)

    return false
  }
}
