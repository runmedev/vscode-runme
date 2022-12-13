import { vi, describe, expect, beforeEach, it } from 'vitest'

import { getExecutionProperty, getTerminalByCell } from '../../../src/extension/utils'
import {
  ShowTerminalProvider,
  BackgroundTaskProvider,
  StopBackgroundTaskProvider
} from '../../../src/extension/provider/background'

vi.mock('vscode', () => ({
  default: {
    NotebookCellStatusBarItem: class {
      constructor (public label: string, public position: number) {}
    },
    NotebookCellStatusBarAlignment: {
      Right: 'right'
    }
  }
}))

vi.mock('../../../src/extension/utils', () => ({
  getExecutionProperty: vi.fn(),
  getTerminalByCell: vi.fn()
}))

describe('ShowTerminalProvider', () => {
  beforeEach(() => {
    vi.mocked(getExecutionProperty).mockClear()
    vi.mocked(getTerminalByCell).mockClear()
  })

  it('dont show pid if cell is non interactive', async () => {
    vi.mocked(getExecutionProperty).mockReturnValueOnce(false)
    const p = new ShowTerminalProvider()
    expect(await p.provideCellStatusBarItems('cell' as any)).toBe(undefined)
    expect(getExecutionProperty).toBeCalledTimes(1)
    expect(getTerminalByCell).toBeCalledTimes(0)
    expect(getExecutionProperty).toBeCalledWith('interactive', 'cell')
  })

  it('dont show pid if terminal could not be found', async () => {
    vi.mocked(getExecutionProperty).mockReturnValueOnce(true)
    vi.mocked(getTerminalByCell).mockReturnValueOnce(undefined)
    const p = new ShowTerminalProvider()
    expect(await p.provideCellStatusBarItems('cell' as any)).toBe(undefined)
    expect(getTerminalByCell).toBeCalledTimes(1)
    expect(getTerminalByCell).toBeCalledWith('cell')
  })

  it('return status item with pid ', async () => {
    vi.mocked(getExecutionProperty).mockReturnValueOnce(true)
    vi.mocked(getTerminalByCell).mockReturnValueOnce({ processId: Promise.resolve(123) } as any)
    const p = new ShowTerminalProvider()
    const item = await p.provideCellStatusBarItems('cell' as any)
    expect(item).toEqual({
      label: '$(terminal) Open Terminal (PID: 123)',
      command: 'runme.openTerminal',
      position: 'right'
    })
  })
})

describe('BackgroundTaskProvider', () => {
  const cell: any = {
    metadata: { background: undefined }
  }

  beforeEach(() => {
    vi.mocked(getExecutionProperty).mockClear()
    vi.mocked(getTerminalByCell).mockClear()
  })

  it('dont show bg task label if cell is non a background task', async () => {
    const p = new BackgroundTaskProvider()
    expect(await p.provideCellStatusBarItems(cell as any)).toBe(undefined)
    expect(getExecutionProperty).toBeCalledTimes(0)
  })

  it('dont show bg task label if cell is non interactive', async () => {
    cell.metadata.background = 'true'
    vi.mocked(getExecutionProperty).mockReturnValueOnce(false)
    const p = new BackgroundTaskProvider()
    expect(await p.provideCellStatusBarItems(cell as any)).toBe(undefined)
    expect(getExecutionProperty).toBeCalledTimes(1)
    expect(getExecutionProperty).toBeCalledWith('interactive', cell)
  })

  it('return status item with pid ', async () => {
    vi.mocked(getExecutionProperty).mockReturnValueOnce(true)
    const p = new BackgroundTaskProvider()
    const item = await p.provideCellStatusBarItems(cell as any)
    expect(item).toEqual({
      label: 'Background Task',
      position: 'right'
    })
  })
})

describe('StopBackgroundTaskProvider', () => {
  const cell: any = {
    metadata: { background: undefined },
    executionSummary: { success: undefined }
  }

  beforeEach(() => {
    vi.mocked(getExecutionProperty).mockClear()
    vi.mocked(getTerminalByCell).mockClear()
  })

  it('dont show bg task label if cell is non a background task', async () => {
    const p = new StopBackgroundTaskProvider()
    expect(await p.provideCellStatusBarItems(cell as any)).toBe(undefined)
    expect(getExecutionProperty).toBeCalledTimes(0)
  })

  it('dont show bg task label if cell is non interactive', async () => {
    cell.metadata.background = 'true'
    vi.mocked(getExecutionProperty).mockReturnValueOnce(false)
    const p = new StopBackgroundTaskProvider()
    expect(await p.provideCellStatusBarItems(cell as any)).toBe(undefined)
    expect(getExecutionProperty).toBeCalledTimes(1)
    expect(getExecutionProperty).toBeCalledWith('interactive', cell)
  })

  it('dont show if cell was not yet executed', async () => {
    cell.metadata.background = 'true'
    cell.executionSummary.success = false
    const p = new StopBackgroundTaskProvider()
    expect(await p.provideCellStatusBarItems(cell as any)).toBe(undefined)
    expect(getExecutionProperty).toBeCalledTimes(1)
    expect(cell.executionSummary.success).toBe(false)
  })

  it('return with button to close', async () => {
    cell.metadata.background = 'true'
    cell.executionSummary.success = true
    vi.mocked(getExecutionProperty).mockReturnValueOnce(true)
    const p = new StopBackgroundTaskProvider()
    const item = await p.provideCellStatusBarItems(cell)
    expect(item).toEqual({
      label: '$(circle-slash) Stop Task',
      position: 'right',
      command: 'runme.stopBackgroundTask'
    })
  })
})
