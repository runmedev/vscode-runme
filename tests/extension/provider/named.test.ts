import { vi, suite, test, expect, beforeEach } from 'vitest'

import { getAnnotations } from '../../../src/extension/utils'
import { NamedStatusBarItem } from '../../../src/extension/provider/cellStatusBar/items/named'
import { Kernel } from '../../../src/extension/kernel'

vi.mock('vscode-telemetry')
vi.mock('vscode')

vi.mock('../../../src/extension/utils', () => ({
  getAnnotations: vi.fn(),
}))

suite('NamedStatusBarItem Test Suite', () => {
  const kernel = new Kernel({} as any)

  beforeEach(() => {
    vi.mocked(getAnnotations).mockClear()
  })

  test('suggest to Add Name if name is generated and unchanged', () => {
    vi.mocked(getAnnotations).mockReturnValueOnce({
      name: 'echo-hello',
      'runme.dev/name': 'echo-hello',
      'runme.dev/nameGenerated': true,
    } as any)
    const p = new NamedStatusBarItem(kernel)
    const item = p.getStatusBarItem({ kind: 2 } as any)
    // eslint-disable-next-line quotes
    expect(item?.text).toMatchInlineSnapshot(`"$(add) Add Name"`)
    expect(item?.tooltip).toMatchInlineSnapshot(
      // eslint-disable-next-line quotes
      `"Add name to important cells"`,
    )
    expect(getAnnotations).toBeCalledTimes(1)
  })

  test('offer changing name if name is not generated', () => {
    vi.mocked(getAnnotations).mockReturnValueOnce({
      name: 'say-hello',
      'runme.dev/name': 'echo-hello',
      'runme.dev/nameGenerated': true,
    } as any)
    const p = new NamedStatusBarItem(kernel)
    const item = p.getStatusBarItem({ kind: 2 } as any)
    // eslint-disable-next-line quotes
    expect(item?.text).toMatchInlineSnapshot(`"$(file-symlink-file) say-hello"`)
    expect(item?.tooltip).toMatchInlineSnapshot(
      // eslint-disable-next-line quotes
      `"Be careful changing the name of an important cell"`,
    )
    expect(getAnnotations).toBeCalledTimes(1)
  })
})
