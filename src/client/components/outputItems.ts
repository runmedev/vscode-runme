import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { getContext } from '@runmedev/renderers'

import '@vscode/webview-ui-toolkit/dist/button/index'

import { closeOutput } from '../utils'
import { ClientMessage } from '../../types'
import { ClientMessages, RENDERERS, OutputType } from '../../constants'

@customElement(RENDERERS.ShellOutputItems)
export class ShellOutputItems extends LitElement {
  // Define scoped styles right with your component, in plain CSS
  static styles = css`
    .output-items {
      display: flex;
      width: 101%;
      justify-content: flex-end;
    }
    vscode-button {
      background: transparent;
      color: #ccc;
      transform: scale(0.9);
    }
    vscode-button:hover {
      background: var(--button-secondary-background);
    }
    vscode-button:focus {
      outline: #007fd4 1px solid;
    }
    .icon {
      width: 13px;
      margin: 0 5px 0 -5px;
      padding: 0;
    }
  `

  @property({ type: String })
  content = ''

  @property({ type: String })
  id!: string

  // Render the UI as a function of component state
  render() {
    return html`<section class="output-items">
    <close-cell-button @closed="${() => {
      return closeOutput({
        id: this.id!,
        outputType: OutputType.outputItems,
      })
    }}"></close-cell-button>
      <vscode-button appearance="secondary" @click="${this.#copy}">
        <svg
          class="icon" width="16" height="16" viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg" fill="currentColor"
        >
          <path fill-rule="evenodd" clip-rule="evenodd"
            d="M4 4l1-1h5.414L14 6.586V14l-1 1H5l-1-1V4zm9 3l-3-3H5v10h8V7z"/>
          <path fill-rule="evenodd" clip-rule="evenodd"
            d="M3 1L2 2v10l1 1V2h6.414l-1-1H3z"/>
        </svg>
        Copy
      </vscode-button>
    </span>`
  }

  #copy() {
    const ctx = getContext()

    if (!ctx.postMessage) {
      return
    }

    return navigator.clipboard.writeText(this.content).catch((err) =>
      ctx.postMessage!(<ClientMessage<ClientMessages.errorMessage>>{
        type: ClientMessages.errorMessage,
        output: `'Failed to copy to clipboard: ${err.message}!'`,
      }),
    )
  }
}
