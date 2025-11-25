import { customElement, property } from 'lit/decorators.js'
import { ConsoleView } from '@runmedev/renderers'

import { RENDERERS } from '../../constants'

@customElement(RENDERERS.TerminalView)
export class TerminalView extends ConsoleView {
  @property({ type: String })
  override theme: 'dark' | 'light' | 'vscode' = 'vscode'
}
