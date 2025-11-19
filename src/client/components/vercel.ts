import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { when } from 'lit/directives/when.js'
import { getContext } from '@runmedev/renderers'

import { ClientMessages, RENDERERS, OutputType } from '../../constants'
import type { ClientMessage } from '../../types'
import { closeOutput } from '../utils'

@customElement(RENDERERS.VercelOutput)
export class VercelOutput extends LitElement {
  #isPromoting = false
  #promoted = false

  // Define scoped styles right with your component, in plain CSS
  static styles = css`
    :host {
      display: block;
      font-family: Arial;
    }

    section {
      padding: 10px;
      border: 1px solid #444;
      display: flex;
      flex-direction: row;
      gap: 50px;
      align-items: flex-start;
      position: relative;
    }

    img {
      width: 100px;
      padding: 20px;
    }

    h4 {
      margin-bottom: 0;
    }
  `

  // Declare reactive properties
  @property({ type: Object })
  content?: any

  // Render the UI as a function of component state
  render() {
    const supportsMessaging = Boolean(getContext().postMessage)
    if (!this.content) {
      return html`⚠️ Ups! Something went wrong displaying the result!`
    }

    const errorMessages = this.content.outputItems.filter((item: string) =>
      item.startsWith('Error: '),
    )
    const hasFailed = errorMessages.length > 0
    const deployUrl = this.content.outputItems.find(
      (item: string) => item.indexOf('vercel.app') > -1,
    )
    if (!deployUrl) {
      if (hasFailed) {
        return errorMessages.map((error: string) => html`<div>${error}</div>`)
      }
      return html`Starting Vercel Deployment...`
    }

    const deployed = this.content.payload.status.toLowerCase() === 'complete'
    const prod = this.content.payload.prod === true

    if (deployed && prod) {
      this.#promoted = true
      this.requestUpdate()
    }

    return html` <section>
      <img src="https://www.svgrepo.com/show/354512/vercel.svg" />
      <div>
        <h4>Deployment</h4>
        <vscode-link href="${deployUrl}">${deployUrl}</vscode-link>
        <h4>Project Name</h4>
        ${this.content.payload.projectName}
      </div>
      <div>
        <h4>Stage</h4>
        ${when(
          hasFailed,
          () => html`⚠️ Deploy Failed`,
          () =>
            when(
              deployed,
              () => (supportsMessaging && this.#promoted ? 'production' : 'preview'),
              () => html`pending <vscode-spinner />`,
            ),
        )}
        <h4>Status</h4>
        ${when(
          hasFailed,
          () => errorMessages.map((error: string) => html`<div>${error}</div>`),
          () => when(!deployed, () => html`${this.content.payload.status.toLowerCase()}`),
        )}
        ${when(
          deployed && supportsMessaging && !this.#promoted,
          () => html`
            <vscode-button
              class="btnPromote"
              @click="${() => {
                this.#promote()
              }}"
              .disabled=${this.#isPromoting}
            >
              🚀 ${this.#isPromoting ? 'Promoting...' : 'Promote to Production'}
            </vscode-button>
          `,
        )}
        ${when(deployed && supportsMessaging && this.#promoted, () => html` 👌 Promoted `)}
      </div>
      <close-cell-button
        @closed="${() => {
          return closeOutput({
            id: this.content.payload.id,
            outputType: OutputType.vercel,
          })
        }}"
      ></close-cell-button>
    </section>`
  }

  #promote() {
    const ctx = getContext()
    if (!ctx.postMessage) {
      return
    }

    this.#isPromoting = true
    this.requestUpdate()
    ctx.postMessage(<ClientMessage<ClientMessages.vercelProd>>{
      type: ClientMessages.vercelProd,
      output: { cellIndex: this.content.payload.index },
    })
  }
}
