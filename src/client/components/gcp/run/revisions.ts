import { LitElement, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { when } from 'lit/directives/when.js'
import { Disposable } from 'vscode'
import { getContext } from '@runmedev/renderers'

import { ClientMessages } from '../../../../constants'
import { onClientMessage } from '../../../../utils/messaging'
import { formatDateWithTimeAgo } from '../../../utils'
import { ClusterIcon } from '../../icons/cluster'
import { CloudLogsIcon } from '../../icons/cloudLogs'
import { CloudRunIcon } from '../../icons/cloudRunIcon'
import { PassIcon } from '../../icons/pass'
import { ErrorIcon } from '../../icons/error'
import { type GcpCloudRunService } from '../../../../types'
import './revisionDetails'
import { Revision } from '../../../../extension/executors/gcp/run/types'

const HIDDEN_COLUMNS = ['statusMessage', 'clusterId', 'clusterLink', 'serviceName']
const COLUMNS = [
  {
    text: 'Name',
  },
  {
    text: 'Deployed',
  },
  {
    text: 'Actions',
  },
]
@customElement('gcp-run-revisions')
export class Revisions extends LitElement implements Disposable {
  protected disposables: Disposable[] = []
  protected maxRevisionCount = 15

  @property({ type: Array })
  revisions!: Revision[]

  @property({ type: String })
  cellId!: string

  @property({ type: String })
  projectId!: string

  @property({ type: String })
  serviceId!: string

  @property({ type: String })
  region!: string

  @state()
  private more = false

  @state()
  private _selectedResource: Revision | null | undefined

  @state()
  private _authorMode: boolean = true

  /* eslint-disable */
  static styles = css`
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
      justify-content: space-between;
    }

    .flex {
      display: flex;
      align-items: center;
      gap: 2px;
    }

    .integration h1,
    h2,
    h3 {
      font-weight: 400;
    }

    .footer {
      display: flex;
      margin-top: 10px;
      justify-content: space-between;
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

    .bold {
      font-weight: bold;
    }
  `

  connectedCallback(): void {
    super.connectedCallback()
    const ctx = getContext()
    this.disposables.push(
      onClientMessage(ctx, (e) => {
        if (e.type === ClientMessages.onAuthorModeChange) {
          this._authorMode = e.output.isAuthorMode
        }
      }),
    )
  }

  private toggleMore(e: Event) {
    if (!e.defaultPrevented) {
      e.preventDefault()
    }
    this.more = !this.more
    this.requestUpdate()
  }

  private viewRevisionDetails(revision: Revision) {
    this._selectedResource = revision
    this.requestUpdate()
  }

  private getRevisionLogsUrl(revision: Revision) {
    return `https://console.cloud.google.com/logs/query;query=resource.type%3D%22cloud_run_revision%22%0Aresource.labels.service_name%3D%22${revision.service}%22%0Aresource.labels.revision_name%3D%22${revision.name}%22;duration=PT1H?project=${this.projectId}`
  }

  private renderRevisions() {
    const revisions = this.more ? this.revisions : this.revisions.slice(0, this.maxRevisionCount)

    return html` <div>
      <table-view
        .columns="${COLUMNS}"
        .rows="${revisions.map((revision) => {
          const createTime = Number(revision.createTime)
          return {
            name: revision.name,
            serviceName: revision.service,
            deployed: Number.isNaN(createTime)
              ? 'unknown'
              : formatDateWithTimeAgo(new Date(createTime * 1000)),
            actions: [
              {
                name: 'Details',
                render: () =>
                  html`<vscode-button
                    class="control"
                    appearance="icon"
                    @click="${() => this.viewRevisionDetails(revision)}"
                  >
                    Details
                  </vscode-button>`,
              },
              {
                name: 'Logs',
                render: () =>
                  html`<vscode-link class="link" href="${this.getRevisionLogsUrl(revision)}"
                    >${CloudLogsIcon}</vscode-link
                  >`,
              },
            ],
          }
        })}"
        .displayable="${(row: GcpCloudRunService, field: string) => {
          return !HIDDEN_COLUMNS.includes(field)
        }}"
        .renderer="${(row: GcpCloudRunService, field: string) => {
          switch (field) {
            case 'name':
              return html`<vscode-link
                class="link"
                href="${`https://console.cloud.google.com/run/detail/${this.region}/${row.serviceName}/revisions?project=${this.projectId}`}"
                >${row[field]}</vscode-link
              >`
            case 'status':
              return when(
                row.status,
                () => html`<div class="status">${PassIcon}</div>`,
                () => html`<div class="status">${ErrorIcon}</div>`,
              )
            case 'actions':
              return html`<div class="actions">
                ${row['actions'].map((action: any) => html`${action.render()}`)}
              </div>`
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

  resetSelectedRevision() {
    this._selectedResource = null
  }

  renderFooter() {
    if (this.revisions.length <= this.maxRevisionCount) {
      return html`<div />`
    }

    return html`<vscode-link class="link" @click="${this.toggleMore}"
      >${when(
        this.more,
        () => 'Show less',
        () => 'Show more',
      )}</vscode-link
    >`
  }

  render() {
    return html`<div class="integration">
        <div class="flex">
          ${CloudRunIcon}
          <h3>Google Cloud Run | Revisions for <span class="bold">${this.serviceId}</span></h3>
        </div>
        <vscode-link
          class="link"
          href="${`https://console.cloud.google.com/run/detail/${this.region}/${this.serviceId}/revisions?project=${this.projectId}`}"
          >${ClusterIcon}${this.projectId}</vscode-link
        >
      </div>
      ${when(
        this._selectedResource,
        () => {
          return html`<revision-details
            cellId="${this.cellId}"
            projectId="${this.projectId}"
            .revision="${this._selectedResource!}"
            region="${this.region}"
            @onBack="${() => this.resetSelectedRevision()}"
          ></revision-details>`
        },
        () => this.renderRevisions(),
      )}
      <div class="footer">
        ${this.renderFooter()}
        <vscode-link
          class="link"
          href="${`https://console.cloud.google.com/run/detail/${this.region}/${this.serviceId}/revisions?project=${this.projectId}`}"
          >${ClusterIcon}${this.projectId}</vscode-link
        >
      </div>
      </div>
      `
  }
}
