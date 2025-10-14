import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { Disposable } from 'vscode'
import { getContext } from '@runmedev/renderers'

import { ClientMessages } from '../../../constants'
import { onClientMessage, postClientMessage } from '../../../utils/messaging'
import { CloudShellIcon } from '../icons/cloudShell'
import { AWSActionType, AWSEC2Instance } from '../../../types'
import { ClusterIcon } from '../icons/cluster'

import { resolveOsUserName } from './ec2Helper'

enum MESSAGE_OPTIONS {
  Yes = 'Yes',
  No = 'No',
}

@customElement('aws-instance-actions')
export class AWSInstanceActions extends LitElement implements Disposable {
  protected disposables: Disposable[] = []

  @property({ type: Object })
  instance!: AWSEC2Instance

  @property({ type: String })
  cellId!: string

  @property({ type: String })
  region!: string

  @state()
  private _selectedAction: AWSActionType | undefined

  /* eslint-disable */
  static styles = css`
    vscode-button {
      color: var(--vscode-button-foreground);
      background-color: var(--vscode-button-background);
      transform: scale(0.9);
    }
    vscode-button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .close-button,
    .close-button:hover {
      border: none;
    }

    .actions {
      display: flex;
      gap: 1;
      align-items: center;
      justify-content: center;
    }
  `

  private getId() {
    return `${this.cellId}-${this.instance.instanceId}`
  }

  connectedCallback(): void {
    super.connectedCallback()
    const ctx = getContext()
    this.disposables.push(
      onClientMessage(ctx, (e) => {
        if (![ClientMessages.onOptionsMessage].includes(e.type)) {
          return
        }

        if (e.type === ClientMessages.onOptionsMessage) {
          if (this.getId() !== e.output.id || !e.output.option) {
            return
          }

          if (e.output.option === MESSAGE_OPTIONS.Yes) {
            postClientMessage(ctx, ClientMessages.awsEC2InstanceAction, {
              cellId: this.cellId,
              instance: this.instance?.instanceId!,
              osUser: resolveOsUserName(this.instance?.imageName),
              region: this.region,
              action: this._selectedAction!,
            })
          }
        }
      }),
    )
  }

  dispose() {
    this.disposables.forEach(({ dispose }) => dispose())
  }

  private executeAction(action: AWSActionType) {
    const ctx = getContext()
    let title = ''
    this._selectedAction = action
    switch (action) {
      case AWSActionType.ConnectViaSSH:
        title = `Do you want to connect via SSH to ${this.instance.name}`
        break
      case AWSActionType.EC2InstanceDetails:
        title = `Do you want to display the instance details for ${this.instance.name}?`
        break
    }
    return postClientMessage(ctx, ClientMessages.optionsMessage, {
      title,
      options: Object.values(MESSAGE_OPTIONS),
      modal: true,
      id: this.getId(),
      telemetryEvent: `app.aws.ec2Instance.${action}`,
    })
  }

  render() {
    const actions = [
      {
        name: 'Connect via SSH',
        render: () =>
          html`<vscode-button
            class="control"
            appearance="icon"
            @click="${() => this.executeAction(AWSActionType.ConnectViaSSH)}"
          >
            ${CloudShellIcon}
          </vscode-button>`,
      },
      {
        name: 'Details',
        render: () =>
          html`<vscode-button
            class="control"
            appearance="icon"
            @click="${() => this.executeAction(AWSActionType.EC2InstanceDetails)}"
          >
            ${ClusterIcon}
          </vscode-button>`,
      },
    ]
    return html`<div class="actions">
      ${actions.map((action) => {
        return html`${action.render()}`
      })}
    </div>`
  }
}
