import { LitElement, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { Disposable } from 'vscode'
import { when } from 'lit/directives/when.js'
import { getContext } from '@runmedev/renderers'

import '../statusIcon'

import { ClientMessages } from '../../../../constants'
import { ClientMessage, GcpGkeCluster } from '../../../../types'
import { onClientMessage } from '../../../../utils/messaging'
import { ArrowLeft } from '../../icons/arrowLeft'
import { ClusterIcon } from '../../icons/cluster'

import { clusterStyles } from './styles'

@customElement('gcp-gke-cluster')
export class Clusters extends LitElement implements Disposable {
  protected disposables: Disposable[] = []

  @property({ type: String })
  cluster?: string | undefined

  @property({ type: Object })
  clusterData?: any

  @property({ type: String })
  location!: string | undefined

  @property({ type: String })
  cellId!: string

  @property({ type: String })
  projectId!: string

  @state()
  _clusterDetails: any

  @state()
  loading: boolean = false

  @state()
  activeTabId: string = 'tab-1'

  @state()
  executedInNewCell?: boolean | undefined

  static styles = clusterStyles

  private getClusterDetails() {
    const ctx = getContext()
    if (!ctx.postMessage) {
      return
    }
    ctx.postMessage(<ClientMessage<ClientMessages.gcpClusterDetails>>{
      type: ClientMessages.gcpClusterDetails,
      output: {
        cellId: this.cellId,
        cluster: this.cluster,
        location: this.location,
        projectId: this.projectId,
      },
    })
  }

  connectedCallback(): void {
    super.connectedCallback()
    const ctx = getContext()
    if (!this.clusterData && this.cluster) {
      this.loading = true
      this.getClusterDetails()
    } else {
      this._clusterDetails = this.clusterData.data
    }
    this.disposables.push(
      onClientMessage(ctx, (e) => {
        if (e.type === ClientMessages.gcpClusterDetailsResponse) {
          if (this.cluster !== e.output.cluster || this.cellId !== e.output.cellId) {
            return
          }
          this.loading = false
          this._clusterDetails = e.output.data
          this.executedInNewCell = e.output.executedInNewCell
          this.requestUpdate()
        }
      }),
    )
  }

  private onBackClick(e: Event) {
    if (e.defaultPrevented) {
      e.preventDefault()
    }
    const event = new CustomEvent('onBack')
    this.dispatchEvent(event)
  }

  private renderClusterBasics() {
    const { clusterBasics } = this._clusterDetails
    return html`<table-view
      .columns="${[
        {
          text: 'Cluster basics',
          colspan: 3,
        },
      ]}"
      .rows="${[
        {
          key: 'Name',
          value: clusterBasics.name,
        },
        {
          key: 'Location type',
          value: clusterBasics.locationType,
        },
        {
          key: 'Control plane zone',
          value: clusterBasics.locationType,
        },
        {
          key: 'Default node zones',
          value: clusterBasics.locationType,
        },
        {
          key: 'Release channel',
          value: clusterBasics.releaseChannel,
        },
        {
          key: 'Version',
          value: clusterBasics.version,
        },
        {
          key: 'Total size',
          value: clusterBasics.totalSize,
        },
        {
          key: 'External endpoint',
          value: clusterBasics.externalEndpoint,
        },
        {
          key: 'Internal endpoint',
          value: clusterBasics.privateEndpoint,
        },
      ]}"
      .displayable="${(_row: GcpGkeCluster, _field: string) => {
        return true
      }}"
      .renderer="${(row: GcpGkeCluster, field: string) => {
        return html`${row[field]}`
      }}"
    ></table-view>`
  }

  private renderClusterAutomation() {
    const { automation } = this._clusterDetails
    return html`<table-view
      .columns="${[
        {
          text: 'Automation',
          colspan: 3,
        },
      ]}"
      .rows="${[
        {
          key: 'Maintenance window',
          value: automation.maintenance?.policy,
        },
        {
          key: 'Maintenance exclusions',
          value: automation.locationType,
        },
        {
          key: 'Notifications',
          value: this.displayFeatureStatus(automation.notifications?.enabled),
        },
        {
          key: 'Topic ID',
          value: automation.notifications?.topic,
        },
        {
          key: 'Vertical Pod Autoscaling',
          value: this.displayFeatureStatus(automation.verticalPodAutoscaling),
        },
        {
          key: 'Node auto-provisioning',
          value: this.displayFeatureStatus(automation.enableNodeAutoprovisioning),
        },
        {
          key: 'Auto-provisioning network tags',
          value: [],
        },
        {
          key: 'Autoscaling profile',
          value: automation.autoscaling?.autoscalingProfile,
        },
      ]}"
      .displayable="${(_row: GcpGkeCluster, _field: string) => {
        return true
      }}"
      .renderer="${(row: GcpGkeCluster, field: string) => {
        return html`${row[field]}`
      }}"
    ></table-view>`
  }

  private displayFeatureStatus(value: boolean | undefined | null) {
    return !value ? 'Disabled' : 'Enabled'
  }

  private renderClusterNetworking() {
    const { networking } = this._clusterDetails
    return html`<table-view
      .columns="${[
        {
          text: 'Networking',
          colspan: 3,
        },
      ]}"
      .rows="${[
        {
          key: 'Private cluster',
          value: this.displayFeatureStatus(networking.privateCluster?.enablePrivateNodes),
        },
        {
          key: 'Control plane global access',
          value: this.displayFeatureStatus(networking.privateCluster?.masterGlobalAccessConfig),
        },
        {
          key: 'Network',
          value: networking.network,
        },
        {
          key: 'Subnet',
          value: networking.subnetwork,
        },
        {
          key: 'Stack type',
          value: networking.stackType,
        },
        {
          key: 'Private control plane’s endpoint subnet',
          value: networking.privateEndpointSubnetwork,
        },
        {
          key: 'VPC-native traffic routing',
          value: '-default-',
        },
        {
          key: 'Cluster Pod IPv4 range (default)',
          value: networking.subnetDetails?.clusterIpv4Cidr,
        },
        {
          key: 'Cluster Pod IPv4 ranges (additional)',
          value: '-None-',
        },
        {
          key: 'Maximum pods per node',
          value: '110',
        },
        {
          key: 'IPv4 service range',
          value: networking.subnetDetails?.servicesIpv4CidrBlock,
        },
        {
          key: 'Intranode visibility',
          value: this.displayFeatureStatus(networking.intranodeVisibility),
        },
        {
          key: 'HTTP Load Balancing',
          value: this.displayFeatureStatus(networking.httpLoadBalancingEnabled),
        },
        {
          key: 'Subsetting for L4 Internal Load Balancers',
          value: this.displayFeatureStatus(
            networking.subnetDetails?.subsettingL4InternalLoadBalancers,
          ),
        },
        {
          key: 'Control plane authorized networks',
          value: '-Disabled-',
        },
        {
          key: 'Calico Kubernetes Network policy',
          value: '-Disabled-',
        },
        {
          key: 'Dataplane V2',
          value: '-Disabled-',
        },
        {
          key: 'DNS provider',
          value: networking.dns || 'Kube-dns',
        },
        {
          key: 'NodeLocal DNSCache',
          value: '-Disabled-',
        },
        {
          key: 'Gateway API',
          value: this.displayFeatureStatus(networking.gatewayApi),
        },
        {
          key: 'Multi-networking',
          value: this.displayFeatureStatus(networking.multinetworking),
        },
      ]}"
      .displayable="${(_row: GcpGkeCluster, _field: string) => {
        return true
      }}"
      .renderer="${(row: GcpGkeCluster, field: string) => {
        return html`${row[field]}`
      }}"
    ></table-view>`
  }

  private resolveNodeLink(nodeName: string) {
    return `https://console.cloud.google.com/kubernetes/node/${this.location}/${this.cluster}/${nodeName}/summary?project=${this.projectId}`
  }

  private resolveNodePoolLink(nodePoolName: string) {
    return `https://console.cloud.google.com/kubernetes/nodepool/${this.location}/${this.cluster}/${nodePoolName}?project=${this.projectId}`
  }

  private renderClusterNodePools() {
    const basePath = `https://console.cloud.google.com/kubernetes/clusters/details/${this.location}/${this.cluster}`

    const {
      clusterBasics: { nodePools, clusterNodes },
    } = this._clusterDetails
    return html`<div>
      <vscode-link href="${basePath}/nodes?project=${this.projectId}">
        <h3>Node Pools</h3>
      </vscode-link>
      <table-view
        .columns="${[
          {
            text: 'Status',
            key: 'status',
          },
          {
            text: 'Name',
            key: 'name',
          },
          {
            text: 'Version',
          },
          {
            text: 'Number of nodes',
          },
          {
            text: 'Machine type',
          },
          {
            text: 'Image type',
          },
        ]}"
        .rows="${nodePools.map((nodePool: any) => {
          return {
            status: nodePool.status,
            name: nodePool.name,
            version: nodePool.version,
            numberOfNodes: nodePool.numberOfNodes,
            machineType: nodePool.machineType,
            imageType: nodePool.imageType,
          }
        })}"
        .displayable="${(_row: GcpGkeCluster, _field: string) => {
          return true
        }}"
        .renderer="${(row: GcpGkeCluster, field: string) => {
          switch (field) {
            case 'name':
              return html`<vscode-link href="${this.resolveNodePoolLink(row[field])}"
                >${row[field]}</vscode-link
              >`
            case 'status':
              return html`<status-icon .status="${row[field]}"></status-icon>`
            default:
              return html`${row[field]}`
          }
        }}"
      ></table-view>
      <vscode-link href="${basePath}/nodes?project=${this.projectId}">
        <h3>Nodes</h3>
      </vscode-link>
      <table-view
        .columns="${[
          {
            text: 'Status',
          },
          {
            text: 'Name',
          },
          {
            text: 'CPU Requested',
          },
          {
            text: 'CPU Allocatable',
          },
          {
            text: 'Memory Requested',
          },
          {
            text: 'Memory Allocatable',
          },
          {
            text: 'Storage Requested',
          },
          {
            text: 'Storage Allocatable',
          },
        ]}"
        .rows="${clusterNodes.map((node: any) => {
          return {
            instanceStatus: node.instanceStatus,
            name: node.name,
            cpuRequested: node.cpuRequested,
            cpuAllocatable: node.cpuAllocatable,
            memoryRequested: node.memoryRequested,
            memoryAllocatable: node.memoryAllocatable,
            storageRequested: node.storageRequested,
            storageAllocatable: node.storageAllocatable,
          }
        })}"
        .displayable="${(_row: GcpGkeCluster, _field: string) => {
          return true
        }}"
        .renderer="${(row: GcpGkeCluster, field: string) => {
          switch (field) {
            case 'name':
              return html`<vscode-link href="${this.resolveNodeLink(row[field])}"
                >${row[field]}</vscode-link
              >`
            case 'instanceStatus':
              return html`<status-icon .status="${row[field]}"></status-icon>`
            default:
              return html`${row[field]}`
          }
        }}"
      ></table-view>
    </div>`
  }

  private getTabClass(tab: string) {
    return this.activeTabId === tab ? 'tab active-tab' : 'tab'
  }

  private setActiveTab(tab: string) {
    this.activeTabId = tab
  }

  private renderCluster() {
    const basePath = `https://console.cloud.google.com/kubernetes/clusters/details/${this.location}/${this.cluster}`
    return html`
      <div>
        <div class="cluster-actions">
          ${when(
            this.clusterData,
            () => {
              return html``
            },
            () => {
              return html` <vscode-button @click="${(e: Event) => this.onBackClick(e)}"
                >${ArrowLeft}</vscode-button
              >`
            },
          )}
          <h3>Clusters</h3>
          <vscode-link
            class="link"
            href="${`https://console.cloud.google.com/kubernetes/clusters/details/${this.location}/${this.cluster}/details?project=${this.projectId}`}"
            >${ClusterIcon}${this.cluster}</vscode-link
          >
          <gcp-gke-cluster-status
            .cluster="${this._clusterDetails}"
            .projectId="${this.projectId}"
            .cellId="${this.cellId}"
          ></gcp-gke-cluster-status>
          <vscode-link
            class="link"
            href=${`https://console.cloud.google.com/monitoring/dashboards/resourceList/kubernetes?project=${this.projectId}&pageState=(%22interval%22:(),%22gcpTableState%22:(%22t%22:%22CLUSTER%22,%22vA%22:false,%22fS%22:(%22cF%22:(%22pN%22:%22projects%2F${this.projectId}%22,%22l%22:%22${this.location}%22,%22n%22:%22${this.cluster}%22))))`}
          >
            View metrics
          </vscode-link>
          <vscode-link
            class="link"
            href="${`https://console.cloud.google.com/logs/query;query=%2528resource.type%3D%22k8s_cluster%22%2529%0Aresource.labels.cluster_name%3D%22${this.cluster}%22;?project=${this.projectId}`}"
            >View logs</vscode-link
          >
        </div>
        <vscode-panels activeid="${this.activeTabId}">
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
            >Nodes</vscode-panel-tab
          >
          <vscode-panel-tab
            id="tab-3"
            class="${this.getTabClass('tab-3')}"
            @click="${() => this.setActiveTab('tab-3')}"
            >Storage</vscode-panel-tab
          >
          <vscode-panel-tab
            id="tab-4"
            class="${this.getTabClass('tab-4')}"
            @click="${() => this.setActiveTab('tab-4')}"
            >Observability</vscode-panel-tab
          >
          <vscode-panel-tab
            id="tab-5"
            class="${this.getTabClass('tab-5')}"
            @click="${() => this.setActiveTab('tab-5')}"
            >Logs</vscode-panel-tab
          >
          <vscode-panel-view id="view-1" class="panel">
            <section class="cluster-view">
              ${this.renderClusterBasics()} ${this.renderClusterAutomation()}
              ${this.renderClusterNetworking()}
            </section>
          </vscode-panel-view>
          <vscode-panel-view id="view-2" class="panel">
            <section class="cluster-view flex flex-column">
              ${this.renderClusterNodePools()}
            </section>
          </vscode-panel-view>
          <vscode-panel-view id="view-3" class="panel">
            <vscode-link href="${basePath}/storage?project=${this.projectId}">
              View storage
            </vscode-link>
          </vscode-panel-view>
          <vscode-panel-view id="view-4" class="panel">
            <vscode-link href="${basePath}/observability?project=${this.projectId}">
              View observability
            </vscode-link>
          </vscode-panel-view>
          <vscode-panel-view id="view-5" class="panel">
            <vscode-link href="${basePath}/logs?project=${this.projectId}"> View logs </vscode-link>
          </vscode-panel-view>
        </vscode-panels>
      </div>
    `
  }

  dispose() {
    this.disposables.forEach(({ dispose }) => dispose())
  }

  render() {
    if (this.clusterData) {
      return this.renderCluster()
    }
    return when(
      this.loading,
      () =>
        html`<div class="loading">
          <vscode-progress-ring></vscode-progress-ring>
          <p>Loading cluster details...</p>
        </div>`,
      () => this.renderCluster(),
    )
  }
}
