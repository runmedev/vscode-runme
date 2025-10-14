import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { Disposable } from 'vscode'
import { getContext } from '@runmedev/renderers'

import '../resourceStatus'

import { GceActionType, InstanceStatusType, type GcpGceVMInstance } from '../../../../types'
import { ClientMessages } from '../../../../constants'
import { onClientMessage, postClientMessage } from '../../../../utils/messaging'
import { CloudShellIcon } from '../../icons/cloudShell'
import { StopIcon } from '../../icons/stop'
import { SuspendIcon } from '../../icons/suspend'
import { StartIcon } from '../../icons/start'

enum MESSAGE_OPTIONS {
  Yes = 'Yes',
  No = 'No',
}

const INTERMEDIATE_INSTANCE_STATUS = [
  InstanceStatusType.Provisioning,
  InstanceStatusType.Repairing,
  InstanceStatusType.Staging,
  InstanceStatusType.Stopping,
  InstanceStatusType.Suspending,
]

const ACTION_MESSAGES = {
  [GceActionType.StartVMInstance]: 'start',
  [GceActionType.StopVMInstance]: 'stop',
  [GceActionType.SuspendVMInstance]: 'suspend',
  [GceActionType.ConnectViaSSH]: 'connect via SSH',
}

@customElement('vm-instance-actions')
export class VMInstanceActions extends LitElement implements Disposable {
  protected disposables: Disposable[] = []

  @property({ type: Object })
  instance!: GcpGceVMInstance

  @property({ type: String })
  cellId!: string

  @property({ type: String })
  projectId!: string

  @state()
  private _updatingStatus: boolean = false

  @state()
  private _expectedFinalStatus: InstanceStatusType | undefined

  @state()
  private _selectedAction: GceActionType | undefined

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
    }
  `

  private getId() {
    return `${this.cellId}-${this.instance.name}`
  }

  connectedCallback(): void {
    super.connectedCallback()
    const ctx = getContext()
    this._updatingStatus = INTERMEDIATE_INSTANCE_STATUS.includes(this.instance.status)
    this.disposables.push(
      onClientMessage(ctx, (e) => {
        if (
          ![ClientMessages.onOptionsMessage, ClientMessages.gcpResourceStatusChanged].includes(
            e.type,
          )
        ) {
          return
        }

        if (e.type === ClientMessages.gcpResourceStatusChanged) {
          if (this.instance.name !== e.output.resourceId || this.cellId !== e.output.cellId) {
            return
          }

          if (e.output.hasErrors) {
            return postClientMessage(
              ctx,
              ClientMessages.errorMessage,
              `Failed to run operation: ${this._selectedAction}, error: ${e.output.error}`,
            )
          }

          if (this.instance.status !== e.output.status) {
            this.instance.status = e.output.status as InstanceStatusType
            if (e.output.status === this._expectedFinalStatus) {
              this._updatingStatus = false
            }
            this.requestUpdate()
            return
          }
        }

        if (e.type === ClientMessages.onOptionsMessage) {
          if (this.getId() !== e.output.id || !e.output.option) {
            return
          }

          if (e.output.option === MESSAGE_OPTIONS.Yes && this._selectedAction) {
            if (this._selectedAction !== GceActionType.ConnectViaSSH) {
              this._updatingStatus = true
            }
            postClientMessage(ctx, ClientMessages.gcpVMInstanceAction, {
              cellId: this.cellId,
              instance: this.instance?.name!,
              zone: this.instance?.zone!,
              project: this.projectId,
              action: this._selectedAction,
              status: this.instance?.status!,
            })
          }
        }
      }),
    )
  }

  dispose() {
    this.disposables.forEach(({ dispose }) => dispose())
  }

  private executeAction(action: GceActionType) {
    const ctx = getContext()
    this._selectedAction = action
    switch (action) {
      case GceActionType.StopVMInstance: {
        this._expectedFinalStatus = InstanceStatusType.Terminated
        break
      }
      case GceActionType.SuspendVMInstance: {
        this._expectedFinalStatus = InstanceStatusType.Suspended
        break
      }
      case GceActionType.StartVMInstance: {
        this._expectedFinalStatus = InstanceStatusType.Running
        break
      }
    }
    return postClientMessage(ctx, ClientMessages.optionsMessage, {
      title: `Are you sure you want to ${ACTION_MESSAGES[action]} ${this.instance.name}?`,
      options: Object.values(MESSAGE_OPTIONS),
      modal: true,
      id: this.getId(),
      telemetryEvent: `app.gcp.vmInstance.${action}`,
    })
  }

  render() {
    const stopAction = {
      name: 'Stop',
      render: () =>
        html`<vscode-button
          class="control"
          appearance="icon"
          .disabled="${this._updatingStatus}"
          @click="${() => this.executeAction(GceActionType.StopVMInstance)}"
        >
          ${StopIcon}
        </vscode-button>`,
    }
    const runningActions = [
      stopAction,
      {
        name: 'Suspend',
        render: () =>
          html`<vscode-button
            class="control"
            appearance="icon"
            .disabled="${this._updatingStatus}"
            @click="${() => this.executeAction(GceActionType.SuspendVMInstance)}"
          >
            ${SuspendIcon}
          </vscode-button>`,
      },
    ]

    const nonRunningActions = [
      {
        name: 'Start / Resume',
        render: () =>
          html`<vscode-button
            class="control"
            appearance="icon"
            .disabled="${this._updatingStatus}"
            @click="${() => this.executeAction(GceActionType.StartVMInstance)}"
          >
            ${StartIcon}
          </vscode-button>`,
      },
    ]

    if (this.instance.status === InstanceStatusType.Suspended) {
      nonRunningActions.push(stopAction)
    }

    const actions = [
      {
        name: 'Connect via SSH',
        render: () =>
          html`<vscode-button
            class="control"
            appearance="icon"
            .disabled="${this._updatingStatus}"
            @click="${() => this.executeAction(GceActionType.ConnectViaSSH)}"
          >
            ${CloudShellIcon}
          </vscode-button>`,
      },
    ]
    return html`<div class="actions">
      ${(this.instance.status === InstanceStatusType.Running
        ? actions.concat(runningActions)
        : actions.concat(nonRunningActions)
      ).map((action) => {
        return html`${action.render()}`
      })}
    </div>`
  }
}
