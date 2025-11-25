import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { Disposable } from 'vscode'

import '../resourceStatus'
import './vmInstanceActions'

import { type GcpGceVMInstance } from '../../../../types'
import { ClusterIcon } from '../../icons/cluster'
import { GCEIcon } from '../../icons/gceIcon'

const HIDDEN_COLUMNS = ['networkName', 'networkLink']

const COLUMNS = [
  {
    text: 'Status',
  },
  {
    text: 'Name',
  },
  {
    text: 'Zone',
  },
  {
    text: 'In use by',
  },
  {
    text: 'Internal IP',
  },
  {
    text: 'External IP',
  },
  {
    text: 'Actions',
  },
]
@customElement('vm-instances')
export class VMInstances extends LitElement implements Disposable {
  protected disposables: Disposable[] = []

  @property({ type: Array })
  instances!: GcpGceVMInstance[]

  @property({ type: String })
  cellId!: string

  @property({ type: String })
  projectId!: string

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

    .close-button,
    .close-button:hover {
      border: none;
    }
  `

  private renderVMInstances() {
    return html` <div>
      <table-view
        .columns="${COLUMNS}"
        .rows="${this.instances.map((vmInstance) => {
          return {
            status: vmInstance.status,
            name: vmInstance.name,
            zone: vmInstance.zone,
            inUseBy: vmInstance.pools,
            internalIp: vmInstance.network.internal.ip,
            externalIp: vmInstance.network.external.ip,
            networkName: vmInstance.network.name,
            networkLink: vmInstance.network.interfaceLink,
            actions: '',
          }
        })}"
        .displayable="${(row: GcpGceVMInstance, field: string) => {
          return !HIDDEN_COLUMNS.includes(field)
        }}"
        .renderer="${(row: GcpGceVMInstance, field: string) => {
          switch (field) {
            case 'name':
              return html`<vscode-link
                href="https://console.cloud.google.com/compute/instancesDetail/zones/${row.zone}/instances/${row.name}?project=${this
                  .projectId}"
                >${row[field]}</vscode-link
              >`
            case 'status':
              return html`<resource-status
                status="${row.status}"
                resourceId="${row.name}"
                cellId=${this.cellId}
              ></resource-status>`
            case 'internalIp':
              return html`<div class="flex-column">
                <span>${row[field]}</span
                ><vscode-link href="${row['networkLink']}">${row['networkName']}</vscode-link>
              </div>`
            case 'externalIp':
              return html`<div class="flex-column">
                <span> ${row[field]} </span
                ><vscode-link href="${row['networkLink']}">${row['networkName']}</vscode-link>
              </div>`
            case 'actions':
              return html`<vm-instance-actions
                .instance="${row}"
                cellId="${this.cellId}"
                projectId="${this.projectId}"
              ></vm-instance-actions>`
            case 'inUseBy':
              return html`<ul class="list">
                ${row[field].map(
                  (field: any) =>
                    html`<li><vscode-link href="${field.link}">${field.name}</vscode-link></li>`,
                )}
              </ul>`
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
        ${GCEIcon}
        <h3>Google Cloud Compute Engine | VM instances</h3>
      </div>
      ${this.renderVMInstances()}
      <div class="footer">
        <vscode-link
          class="link"
          href="https://console.cloud.google.com/compute/instances?project=${this.projectId}"
          >${ClusterIcon}${this.projectId}</vscode-link
        >
      </div>
      </div>
      `
  }
}
