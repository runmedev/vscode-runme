import { LitElement, TemplateResult, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { Disposable } from 'vscode'
import { when } from 'lit/directives/when.js'
import { getContext } from '@runmedev/renderers'

import { ClientMessage, type GcpGkeCluster } from '../../../../types'
import { PassIcon } from '../../icons/pass'
import { SyncIcon } from '../../icons/sync'
import { ErrorIcon } from '../../icons/error'
import { WarningIcon } from '../../icons/warning'
import { TrashIcon } from '../../icons/trash'
import { ClientMessages } from '../../../../constants'
import { onClientMessage } from '../../../../utils/messaging'
import { InfoIcon } from '../../icons/info'
import { UnknownIcon } from '../../icons/unknown'

@customElement('gcp-gke-cluster-status')
export class ClusterStatus extends LitElement implements Disposable {
  protected disposables: Disposable[] = []

  @property({ type: Object })
  cluster!: GcpGkeCluster

  @property({ type: String })
  cellId!: string

  @property({ type: String })
  projectId!: string

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

  private statusIcon(icon: TemplateResult, label?: string | undefined) {
    return when(
      label,
      () => html`<div class="status">${icon}<span class="status-message">${label}</span></div>`,
      () => html`<div class="status">${icon}</div>`,
    )
  }

  private mapClusterStatusIcon(status: string) {
    switch (status) {
      case 'STATUS_UNSPECIFIED':
        return this.statusIcon(UnknownIcon, 'Unknown')
      case 'PROVISIONING':
        return this.statusIcon(html`<span class="loading">${SyncIcon}</span>`, 'Provisioning')
      case 'RUNNING':
        return this.statusIcon(PassIcon)
      case 'RECONCILING':
        return this.statusIcon(
          html`<span class="loading">${SyncIcon}</span>${InfoIcon}`,
          'Reconciling',
        )
      case 'STOPPING':
        return this.statusIcon(
          html`<span class="loading">${SyncIcon}</span>${WarningIcon}`,
          'Stopping',
        )
      case 'ERROR':
        return this.statusIcon(ErrorIcon)
      case 'DEGRADED':
        return this.statusIcon(WarningIcon, 'Degraded')
      case 'STOPPED' /** Custom status to detect a cluster was removed */:
        return this.statusIcon(TrashIcon, 'Deleted')
    }
  }

  private checkClusterStatus() {
    const ctx = getContext()
    if (!ctx.postMessage) {
      return
    }
    ctx.postMessage(<ClientMessage<ClientMessages.gcpClusterCheckStatus>>{
      type: ClientMessages.gcpClusterCheckStatus,
      output: {
        cellId: this.cellId,
        clusterId: this.cluster.clusterId,
        status: this.cluster.status,
        clusterName: this.cluster.name,
        location: this.cluster.location,
        projectId: this.projectId,
      },
    })
  }

  connectedCallback(): void {
    super.connectedCallback()
    const ctx = getContext()
    this.checkClusterStatus()
    this.disposables.push(
      onClientMessage(ctx, (e) => {
        if (e.type === ClientMessages.gcpResourceStatusChanged) {
          if (this.cluster.clusterId !== e.output.resourceId || this.cellId !== e.output.cellId) {
            return
          }

          if (this.cluster.status !== e.output.status) {
            this.cluster.status = e.output.status
            this.requestUpdate()
          }
        }
      }),
    )
  }

  dispose() {
    this.disposables.forEach(({ dispose }) => dispose())
  }

  render() {
    return html`${this.mapClusterStatusIcon(this.cluster.status)} `
  }
}
