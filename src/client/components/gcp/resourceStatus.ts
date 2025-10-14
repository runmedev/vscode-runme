import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { Disposable } from 'vscode'
import { getContext } from '@runmedev/renderers'

import './statusIcon'

import { ClientMessages } from '../../../constants'
import { onClientMessage, postClientMessage } from '../../../utils/messaging'

@customElement('resource-status')
export class ResourceStatus extends LitElement {
  protected disposables: Disposable[] = []

  @property({ type: String })
  resourceId!: string

  @property({ type: String })
  status!: string

  @property({ type: String })
  cellId!: string

  /* eslint-disable */
  static styles = css`
    @keyframes rotate {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }

    .loading {
      display: inline-block;
      height: 16px;
      width: 16px;
      animation: rotate 1s linear infinite;
    }

    .status {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      place-content: stretch space-evenly;
    }

    .status-message {
      font-size: 10px;
    }
  `

  connectedCallback(): void {
    super.connectedCallback()
    const ctx = getContext()
    this.disposables.push(
      onClientMessage(ctx, (e) => {
        if (e.type === ClientMessages.gcpResourceStatusChanged) {
          if (this.resourceId !== e.output.resourceId || this.cellId !== e.output.cellId) {
            return
          }

          if (e.output.hasErrors) {
            return postClientMessage(
              ctx,
              ClientMessages.errorMessage,
              e.output.error || 'failed to get resource status',
            )
          }
          if (this.status !== e.output.status) {
            this.status = e.output.status
            this.requestUpdate()
          }
        }
      }),
    )
  }

  render() {
    return html`<status-icon status="${this.status}"></status-icon>`
  }
}
