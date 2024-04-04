import { NotebookCell } from 'vscode'
import { suite, vi, test, expect } from 'vitest'

import { handleCellOutputMessage } from '../../../src/extension/messages/cellOutput'
import { ClientMessages, OutputType } from '../../../src/constants'
import { Kernel } from '../../../src/extension/kernel'

vi.mock('vscode')
vi.mock('vscode-telemetry')
vi.mock('../../../src/extension/runner', () => ({}))

vi.mock('../../../src/extension/grpc/runner/v1', () => ({
  ResolveProgramRequest_Mode: vi.fn(),
}))

suite('Handle CellOutput messages', () => {
  const mockOutput = (type: OutputType) => {
    const cell = {
      outputs: [
        {
          items: [{ id: '', items: [], metadata: {}, mime: type }],
        },
      ],
      executionSummary: {
        success: false,
      },
      metadata: {},
    } as unknown as NotebookCell
    const kernel = new Kernel({} as any)
    const showOutput = vi.fn().mockImplementation(() => {})
    const showTerminal = vi.fn().mockImplementation(() => {})
    kernel.getCellOutputs = vi.fn().mockResolvedValue({
      showTerminal,
      showOutput,
    })

    return {
      showTerminal,
      showOutput,
      kernel,
      cell,
    }
  }

  const expectOutput = async (type: OutputType) => {
    const { kernel, cell, showOutput, showTerminal } = mockOutput(type)
    await handleCellOutputMessage({
      kernel,
      cell,
      outputType: type,
      message: {
        type: ClientMessages.closeCellOutput,
        output: {
          id: '01HGVC65A3FV1960XEFGTMM8YG',
          outputType: type,
        },
      },
    })
    if ([OutputType.terminal, OutputType.outputItems].includes(type)) {
      expect(showTerminal).toBeCalledTimes(1)
      expect(showTerminal).toBeCalledWith(false)
    } else {
      expect(showOutput).toBeCalledTimes(1)
      expect(showOutput).toBeCalledWith(type, false)
    }
  }

  test('Annotations cell output', async () => {
    return expectOutput(OutputType.annotations)
  })

  test('Terminal cell output', async () => {
    return expectOutput(OutputType.terminal)
  })

  test('OutputItems cell output', async () => {
    return expectOutput(OutputType.outputItems)
  })

  test('Vercel cell output', async () => {
    return expectOutput(OutputType.vercel)
  })
})
