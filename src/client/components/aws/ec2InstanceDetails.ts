import { Disposable } from 'vscode'
import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { getContext } from '@runmedev/renderers'

import './ec2InstanceActions'
import { EC2Icon } from '../icons/ec2'
import { AWSActionType, AWSEC2Instance } from '../../../types'
import { formatDate } from '../../utils'
import { CloudShellIcon } from '../icons/cloudShell'
import { onClientMessage, postClientMessage } from '../../../utils/messaging'
import { ClientMessages } from '../../../constants'

import { resolveOsUserName } from './ec2Helper'
enum MESSAGE_OPTIONS {
  Yes = 'Yes',
  No = 'No',
}

@customElement('ec2-instance-details')
export class EC2InstanceDetails extends LitElement implements Disposable {
  protected disposables: Disposable[] = []

  @property({ type: Object })
  instance!: AWSEC2Instance

  @property({ type: String })
  owner!: string

  @property({ type: String })
  cellId!: string

  @property({ type: String })
  region!: string

  @state()
  activeTabId: string = 'tab-1'

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

    .integration {
      display: flex;
      margin: 10px 0;
      gap: 2px;
      align-items: center;
    }

    .integration h1,
    h2,
    h3 {
      font-weight: 400;
    }

    .footer {
      display: flex;
      place-content: center flex-end;
      margin-top: 10px;
      align-items: baseline;
    }

    .footer .link {
      font-size: 10px;
      padding: 0 5px;
    }

    .vertical-left-divider {
      border-left: solid 1px var(--link-foreground);
      padding-left: 2px;
    }

    .close-button,
    .close-button:hover {
      border: none;
    }

    .instance-header {
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      background-color: var(--vscode-editorWidget-background);
      border-bottom: solid 1px var(--vscode-editorWidget-border);
      padding: 10px;
    }

    .columns {
      display: flex;
      flex: 1;
      gap: 1;
      flex-wrap: wrap;
      align-content: stretch;
      justify-content: space-between;
      border-bottom: solid 1px var(--vscode-editorWidget-border);
      border-right: solid 1px var(--vscode-editorWidget-border);
    }

    .row {
      display: flex;
      flex-direction: column;
      margin-bottom: 10px;
    }

    .column {
      padding: 10px;
      flex: 1;
      border-left: 1px solid var(--vscode-editorWidget-border);
    }

    .row div:first-child {
      font-weight: bold;
    }

    .instance-state {
      padding: 3px;
      margin: 2px;
      border-radius: 5px;
      text-align: center;
      max-width: 100px;
    }

    .state-running {
      background-color: #128824;
      color: #fff;
    }

    .state-stopping,
    .state-pending,
    .state-shutting_down {
      background-color: #ffd700;
      color: #000;
    }

    .state-stopped,
    .state-terminated {
      color: #fff;
      background-color: #b8383d;
    }

    .header-actions {
      display: flex;
      align-items: center;
      justify-content: space-around;
    }

    .tab,
    .panel {
      color: var(--vscode-editor-foreground);
    }

    .active-tab {
      color: var(--vscode-textLink-activeForeground);
      fill: currentcolor;
      border-bottom: solid 2px var(--vscode-activityBarTop-activeBorder);
    }

    .instance-panels {
      background-color: var(--vscode-editorWidget-background);
    }

    .instance-panels .panels {
      border: 1px solid var(--vscode-editorWidget-border);
    }

    .panel-view {
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      margin-bottom: 10px;
      padding: 0px;
    }

    .panel-view .action-button {
      padding: 5px;
    }
  `

  private getId() {
    return `${this.cellId}-${this.instance.instanceId}`
  }

  private executeAction(action: AWSActionType) {
    const ctx = getContext()
    let title = ''
    switch (action) {
      case AWSActionType.ConnectViaSSH:
        title = `Do you want to connect via SSH to ${this.instance.name}`
    }
    return postClientMessage(ctx, ClientMessages.optionsMessage, {
      title,
      options: Object.values(MESSAGE_OPTIONS),
      modal: true,
      id: this.getId(),
      telemetryEvent: `app.aws.ec2InstanceDetails.${action}`,
    })
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
              action: AWSActionType.ConnectViaSSH,
            })
          }
        }
      }),
    )
  }

  private getResourceLink({
    region,
    section,
    fragment,
  }: {
    region: string
    section: string
    fragment: string
  }) {
    return `https://${region}.console.aws.amazon.com/${section}/home?region=${region}#${fragment}`
  }

  private setActiveTab(tab: string) {
    this.activeTabId = tab
  }

  private getTabClass(tab: string) {
    return this.activeTabId === tab ? 'tab active-tab' : 'tab'
  }

  private renderViewDetailsLink() {
    return html`<div class="action-button">
      <vscode-link
        class="link"
        href="${this.getResourceLink({
          region: this.region,
          section: 'ec2',
          fragment: `InstanceDetails:instanceId=${this.instance.instanceId}`,
        })}"
        >View in AWS Console</vscode-link
      >
    </div>`
  }

  private renderInstance() {
    return html` <div>
      <div class="instance-header">
        <h2>Instance summary for ${this.instance.instanceId} (${this.instance.name})</h2>
        <div class="header-actions">
          <div class="instance-state state-${this.instance.instanceState || 'unknown'}">
            ${this.instance.instanceState}
          </div>
          <vscode-button
            class="control"
            @click="${() => this.executeAction(AWSActionType.ConnectViaSSH)}"
            appearance="icon"
          >
            ${CloudShellIcon}
          </vscode-button>
        </div>
      </div>
      <div class="columns">
        <div class="column">
          <div class="row">
            <div>Instance ID</div>
            <div>${this.instance.instanceId}</div>
          </div>
          <div class="row">
            <div>Launch time</div>
            <div>
              ${this.instance.launchTime ? formatDate(new Date(this.instance.launchTime)) : '-'}
            </div>
          </div>
          <div class="row">
            <div>IPv6 address</div>
            <div>-</div>
          </div>
          <div class="row">
            <div>Hostname type</div>
            <div>IP name: ${this.instance.PrivateDnsName}</div>
          </div>
          <div class="row">
            <div>Answer private resource DNS name</div>
            <div>IPv4 (A)</div>
          </div>
          <div class="row">
            <div>Auto-assigned IP address</div>
            <div>${this.instance.PublicIpAddress}[Public IP]</div>
          </div>
          <div class="row">
            <div>IAM Role</div>
            <div>-</div>
          </div>
          <div class="row">
            <div>IMDSv2</div>
            <div>Required</div>
          </div>
        </div>
        <div class="column">
          <div class="row">
            <div>Public IPv4 address</div>
            <div>${this.instance.publicIp}</div>
          </div>
          <div class="row">
            <div>Private IP DNS name (IPv4 only)</div>
            <div>${this.instance.PrivateDnsName}</div>
          </div>
          <div class="row">
            <div>Instance type</div>
            <div>${this.instance.InstanceType}</div>
          </div>
          <div class="row">
            <div>VPC ID</div>
            <div>
              <vscode-link
                class="link"
                href="${this.getResourceLink({
                  region: this.region,
                  section: 'vpcconsole',
                  fragment: `vpcs:vpcId=${this.instance.VpcId}`,
                })}"
              >
                ${this.instance.VpcId}</vscode-link
              >
            </div>
          </div>
          <div class="row">
            <div>Subnet ID</div>
            <vscode-link
              class="link"
              href="${this.getResourceLink({
                region: this.region,
                section: 'vpcconsole',
                fragment: `subnets:subnetId=${this.instance.SubnetId}`,
              })}"
            >
              ${this.instance.SubnetId}</vscode-link
            >
          </div>
        </div>
        <div class="column">
          <div class="row">
            <div>Private IPv4 addresses</div>
            <div>${this.instance.NetworkInterfaces[0]?.PrivateIpAddress || '-'}</div>
          </div>
          <div class="row">
            <div>Public IPv4 DNS</div>
            <div>${this.instance.PublicDnsName}</div>
          </div>
          <div class="row">
            <div>Elastic IP addresses</div>
            <div>-</div>
          </div>
          <div class="row">
            <div>Auto Scaling Group name</div>
            <div>-</div>
          </div>
        </div>
      </div>
      <div class="instance-panels">
        <vscode-panels class="panels" activeid="${this.activeTabId}">
          <vscode-panel-tab
            id="tab-1"
            class="${this.getTabClass('tab-1')}"
            @click="${() => this.setActiveTab('tab-1')}"
            >Details</vscode-panel-tab
          >
          <vscode-panel-tab
            id="tab-2"
            class="${this.getTabClass('tab-2')}"
            @click="${() => this.setActiveTab('tab-2')}"
            >Status and alarms</vscode-panel-tab
          >
          <vscode-panel-tab
            id="tab-3"
            class="${this.getTabClass('tab-3')}"
            @click="${() => this.setActiveTab('tab-3')}"
            >Monitoring</vscode-panel-tab
          >
          <vscode-panel-tab
            id="tab-4"
            class="${this.getTabClass('tab-4')}"
            @click="${() => this.setActiveTab('tab-4')}"
            >Security</vscode-panel-tab
          >
          <vscode-panel-tab
            id="tab-5"
            class="${this.getTabClass('tab-5')}"
            @click="${() => this.setActiveTab('tab-5')}"
            >Networking</vscode-panel-tab
          >
          <vscode-panel-tab
            id="tab-6"
            class="${this.getTabClass('tab-6')}"
            @click="${() => this.setActiveTab('tab-6')}"
            >Storage</vscode-panel-tab
          >
          <vscode-panel-tab
            id="tab-7"
            class="${this.getTabClass('tab-7')}"
            @click="${() => this.setActiveTab('tab-7')}"
            >Tags</vscode-panel-tab
          >
          <vscode-panel-view id="view-1" class="panel-view">
            <div class="columns">
              <div class="column">
                <div class="row">
                  <div>Platform</div>
                  <div>${this.instance.platform}</div>
                </div>
                <div class="row">
                  <div>Usage operation</div>
                  <div>${this.instance.UsageOperation}</div>
                </div>
              </div>
              <div class="column">
                <div class="row">
                  <div>AMI ID</div>
                  <div>${this.instance.ImageId}</div>
                </div>
                <div class="row">
                  <div>AMI name</div>
                  <div>_</div>
                </div>
                <div class="row">
                  <div>Launch time</div>
                  <div>${this.instance.launchTime}</div>
                </div>
                <div class="row">
                  <div>Lifecycle</div>
                  <div>${this.instance.lifecycle || 'normal'}</div>
                </div>
                <div class="row">
                  <div>Key pair assigned at launch</div>
                  <vscode-link
                    class="link"
                    href="${this.getResourceLink({
                      region: this.region,
                      section: 'ec2',
                      fragment: `KeyPairs:keyName=${this.instance.keyName}`,
                    })}"
                  >
                    ${this.instance.keyName}</vscode-link
                  >
                </div>
                <div class="row">
                  <div>Boot mode</div>
                  ${this.instance.BootMode}
                </div>
              </div>
              <div class="column">
                <div class="row">
                  <div>Monitoring</div>
                  <div>${this.instance.monitoring}</div>
                </div>
                <div class="row">
                  <div>Owner</div>
                  <div>${this.owner}</div>
                </div>
                <div class="row">
                  <div>Current instance boot mode</div>
                  <div>${this.instance.CurrentInstanceBootMode}</div>
                </div>
              </div>
            </div>
          </vscode-panel-view>
          <vscode-panel-view id="view-2" class="panel-view">
            ${this.renderViewDetailsLink()}
          </vscode-panel-view>
          <vscode-panel-view id="view-3" class="panel-view">
            ${this.renderViewDetailsLink()}
          </vscode-panel-view>
          <vscode-panel-view id="view-4" class="panel-view">
            ${this.renderViewDetailsLink()}
          </vscode-panel-view>
          <vscode-panel-view id="view-5" class="panel-view">
            ${this.renderViewDetailsLink()}
          </vscode-panel-view>
          <vscode-panel-view id="view-6" class="panel-view">
            ${this.renderViewDetailsLink()}</vscode-panel-view
          >
          <vscode-panel-view id="view-7" class="panel-view">
            ${this.renderViewDetailsLink()}</vscode-panel-view
          >
        </vscode-panels>
      </div>
    </div>`
  }

  dispose() {
    this.disposables.forEach(({ dispose }) => dispose())
  }

  render() {
    return html`<div class="integration">
        ${EC2Icon}
        <h3>AWS EC2 | Instance ${this.instance.name} | ${this.region}</h3>
      </div>
      ${this.renderInstance()}
      <div class="footer">
        <vscode-link
          class="link"
          href="${this.getResourceLink({
            region: this.region,
            section: 'ec2',
            fragment: `InstanceDetails:instanceId=${this.instance.instanceId}`,
          })}"
          >Details</vscode-link
        ><vscode-link
          class="link vertical-left-divider"
          href="${this.getResourceLink({
            region: this.region,
            section: 'ec2',
            fragment: `ManageInstanceState:instanceId=${this.instance.instanceId}`,
          })}"
        >
          Manage state
        </vscode-link>
      </div>`
  }
}
