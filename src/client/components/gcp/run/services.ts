import { LitElement, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { when } from 'lit/directives/when.js'
import { Disposable } from 'vscode'
import { getContext } from '@runmedev/renderers'

import { GCPCloudRunActionType, type GcpCloudRunService } from '../../../../types'
import '../../loadingBar'
import { ClusterIcon } from '../../icons/cluster'
import { CloudLogsIcon } from '../../icons/cloudLogs'
import { ClientMessages } from '../../../../constants'
import { onClientMessage, postClientMessage } from '../../../../utils/messaging'
import { formatDateWithTimeAgo } from '../../../utils'
import { CloudRunIcon } from '../../icons/cloudRunIcon'
import { PassIcon } from '../../icons/pass'
import { ErrorIcon } from '../../icons/error'
import { GCloudIcon } from '../../icons/gcloud'
import { Revision } from '../../../../extension/executors/gcp/run/types'

import commonStyles from './styles/common.css'

const HIDDEN_COLUMNS = ['statusMessage', 'clusterId', 'clusterLink']
const COLUMNS = [
  {
    text: 'Status',
  },
  {
    text: 'Name',
  },
  {
    text: 'Req/sec',
  },
  {
    text: 'Region',
  },
  {
    text: 'Authentication',
  },
  {
    text: 'Ingress',
  },
  {
    text: 'Recommendation',
  },
  {
    text: 'Last deployed',
  },
  {
    text: 'Deployed by',
  },
  {
    text: 'Actions',
  },
]
@customElement('gcp-run-services')
export class Services extends LitElement implements Disposable {
  protected disposables: Disposable[] = []

  @property({ type: Array })
  services!: GcpCloudRunService[]

  @property({ type: String })
  cellId!: string

  @property({ type: String })
  projectId!: string

  @state()
  private _displayResourceInNewCell: boolean = true

  @state()
  private _selectedResource: GcpCloudRunService | null | undefined

  @state()
  private _selectedResourceRevisions: Revision | undefined

  @state()
  private _authorMode: boolean = true

  @state()
  private _currentRegion: string | undefined

  @state()
  private _loading: boolean = true

  @state()
  private _error?: string | undefined

  static styles = commonStyles

  connectedCallback(): void {
    super.connectedCallback()
    const ctx = getContext()
    this.services = []
    // Request services from all available regions
    postClientMessage(ctx, ClientMessages.gcpLoadServices, {
      cellId: this.cellId,
      project: this.projectId,
    })
    this.disposables.push(
      onClientMessage(ctx, (e) => {
        if (e.type === ClientMessages.onAuthorModeChange) {
          this._authorMode = e.output.isAuthorMode
          return
        }

        // Re-render each time a new service is available
        if (e.type === ClientMessages.gcpServicesLoaded && e.output.cellId === this.cellId) {
          if (e.output.allRegionsLoaded) {
            this._loading = false
          }

          if (e.output.hasError) {
            this._error = e.output.error
          }

          this._currentRegion = e.output.region
          if (e.output.services?.length) {
            this.services = this.services.concat(e.output.services)
          }

          this.requestUpdate()
        }
      }),
    )
  }

  private viewRevisions(resource: GcpCloudRunService) {
    const ctx = getContext()
    this._selectedResource = resource
    if (this._authorMode) {
      return postClientMessage(ctx, ClientMessages.gcpCloudRunAction, {
        cellId: this.cellId,
        resource: resource.serviceName,
        project: this.projectId,
        action: GCPCloudRunActionType.ViewRevisions,
        region: resource.region,
      })
    } else {
      this._displayResourceInNewCell = false
      this.requestUpdate()
    }
  }

  private renderServices() {
    const serviceDetailsPath = 'https://console.cloud.google.com/run/detail'
    const logsPath = `logs?project=${this.projectId}`

    return html` <div>
      <table-view
        .columns="${COLUMNS}"
        .rows="${this.services.map((service) => {
          const updateTime = Number(service.updateTime)
          return {
            status: service.isHealthy,
            name: service.serviceName,
            requestsPerSecond: 0,
            region: service.region,
            authentication: 'Allow unauthenticated',
            ingress: service.ingressDisplayName,
            recommendation: '',
            lastDeployed: Number.isNaN(updateTime)
              ? 'unknown'
              : formatDateWithTimeAgo(new Date(updateTime * 1000)),
            deployedBy: service.lastModifier,
            actions: [
              {
                name: 'Logs',
                render: () =>
                  html`<vscode-link
                    class="link"
                    href="${`${serviceDetailsPath}/${service.region}/${service.serviceName}/${logsPath}`}"
                    >${CloudLogsIcon}</vscode-link
                  >`,
              },
              {
                name: 'Details',
                render: () =>
                  html`<vscode-button
                    class="control"
                    appearance="icon"
                    @click="${() => this.viewRevisions(service)}"
                  >
                    Revisions
                  </vscode-button>`,
              },
            ],
          }
        })}"
        .displayable="${(row: GcpCloudRunService, field: string) => {
          return !HIDDEN_COLUMNS.includes(field)
        }}"
        .renderer="${(row: GcpCloudRunService, field: string) => {
          switch (field) {
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

  render() {
    return html`<div class="integration">
        ${CloudRunIcon}
        <h3>Google Cloud Run | Services</h3>
      </div>
      ${when(
        this._error,
        () => html`<div class="error-message">${this._error}</div>`,
        () => html``,
      )}

      ${when(
        this._currentRegion,
        () =>
          html`<div class="current-region">
            ${GCloudIcon}
            <div>
              Searching services for region: <span class="bold">${this._currentRegion}</span>
            </div>
          </div>`,
        () => html``,
      )}
       ${when(
         this._loading,
         () => html`<loading-bar></loading-bar>`,
         () => html``,
       )}
      ${when(
        this._displayResourceInNewCell === false && this._selectedResource,
        () => html``,
        () => this.renderServices(),
      )}
      <div class="footer">
        <vscode-link
          class="link"
          href="${`https://console.cloud.google.com/run?project=${this.projectId}`}"
          >${ClusterIcon}${this.projectId}</vscode-link
        >
      </div>
      </div>
      `
  }
}
