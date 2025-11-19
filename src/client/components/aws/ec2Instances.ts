import { Disposable } from 'vscode'
import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { when } from 'lit/directives/when.js'

import './ec2InstanceActions'
import { EC2Icon } from '../icons/ec2'
import { AWSEC2Instance } from '../../../types'
import { formatDate } from '../../utils'

const HIDDEN_COLUMNS = ['instanceId', 'imageName']
const COLUMNS = [
  {
    text: 'Name',
  },
  {
    text: 'Instance state',
  },
  {
    text: 'Instance type',
  },
  {
    text: 'Availability Zone',
  },
  {
    text: 'Public IPv4 DNS',
  },
  {
    text: 'Public IPv4 address',
  },
  {
    text: 'Monitoring',
  },
  {
    text: 'Security group name',
  },
  {
    text: 'Key name',
  },
  {
    text: 'Launch time',
  },
  {
    text: 'Platform',
  },
  {
    text: 'Actions',
  },
]
@customElement('ec2-instances')
export class EC2Instances extends LitElement implements Disposable {
  protected disposables: Disposable[] = []

  @property({ type: Array })
  instances!: AWSEC2Instance[]

  @property({ type: String })
  cellId!: string

  @property({ type: String })
  region!: string

  /* eslint-disable */
  static styles = css`
    vscode-button {
      color: var(--vscode-button-foreground);
      background-color: var(--vscode-button-background);
      transform: scale(0.9);
    }
    vscode-button:hover {
      background: var(--vscode-list-hoverBackground);
    }
    table {
      box-sizing: border-box;
      margin: 0px;
      padding: 0px;
      font-weight: 400;
      line-height: 20px;
      text-indent: 0px;
      vertical-align: baseline;
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
  `

  private renderInstances() {
    return html` <div>
      <table-view
        .columns="${COLUMNS}"
        .rows="${this.instances.map((instance: AWSEC2Instance) => {
          return {
            name: instance.name,
            instanceId: instance.instanceId,
            instanceState: instance.instanceState,
            type: instance.type,
            zone: instance.zone,
            publicDns: instance.publicDns,
            publicIp: instance.publicIp,
            monitoring: instance.monitoring,
            securityGroup: instance.securityGroup,
            keyName: instance.keyName,
            launchTime: instance.launchTime ? formatDate(new Date(instance.launchTime)) : '',
            platform: instance.platform,
            imageName: instance.imageName,
            actions: '',
          }
        })}"
        .displayable="${(row: AWSEC2Instance, field: string) => {
          return !HIDDEN_COLUMNS.includes(field)
        }}"
        .renderer="${(row: AWSEC2Instance, field: string) => {
          switch (field) {
            case 'name':
              return html`<div class="grouped-row">
                <vscode-link
                  href="${`https://${this.region}.console.aws.amazon.com/ec2/home?region=${this.region}#InstanceDetails:instanceId=${row.instanceId}`}"
                  >${row[field]}</vscode-link
                >
                <div>
                  <span class="long-word">${row.instanceId}</span>
                </div>
              </div>`
            case 'actions':
              return html`<aws-instance-actions
                .cellId="${this.cellId}"
                .instance="${row}"
                .region="${this.region}"
              ></aws-instance-actions>`
            default:
              return html`${row[field]}`
          }
        }}"
      ></table-view>
    </div>`
  }

  dispose() {
    this.disposables.forEach(({ dispose }) => dispose())
  }

  render() {
    return html`<div class="integration">
        ${EC2Icon}
        <h3>AWS EC2 | Instances | ${this.region}</h3>
      </div>
      ${when(
        this.instances.length,
        () => this.renderInstances(),
        () => html`<div>Could not find instances for ${this.region}</div>`,
      )}
      <div class="footer">
        <vscode-link
          class="link"
          href="${`https://${this.region}.console.aws.amazon.com/ec2/home?region=${this.region}#Instances:`}"
          >Instances</vscode-link
        ><vscode-link
          class="link vertical-left-divider"
          href=${`https://${this.region}.console.aws.amazon.com/ec2/home?region=${this.region}#LaunchInstances:`}
        >
          Launch instance at ${this.region}
        </vscode-link>
        <vscode-link
          class="link vertical-left-divider"
          href="${`https://${this.region}.console.aws.amazon.com/ec2/home?region=${this.region}#Home:`}"
          >EC2 Dashboard</vscode-link
        >
      </div>
      </div>
      `
  }
}
