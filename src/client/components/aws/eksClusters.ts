import { Disposable } from 'vscode'
import { LitElement, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { when } from 'lit/directives/when.js'

import './eksClusterActions'
import './clusterStatus'
import './eksCluster'

import { type IndexableCluster } from '../../../extension/executors/aws/types'
import { formatDateWithTimeAgo } from '../../utils'
import { EKSIcon } from '../icons/eks'
import { InfoIcon } from '../icons/info'

import styles from './styles/clusters.css'

const COLUMNS = [
  {
    text: 'Cluster name',
  },
  {
    text: 'Status',
  },
  {
    text: 'Kubernetes version',
  },
  {
    text: 'Provider',
  },
  {
    text: 'Created at',
  },
  {
    text: 'Actions',
  },
]
@customElement('eks-clusters')
export class EKSClusters extends LitElement implements Disposable {
  protected disposables: Disposable[] = []

  @property({ type: Array })
  clusters: IndexableCluster[] | undefined

  @property({ type: Object })
  cluster: IndexableCluster | undefined

  @property({ type: String })
  cellId!: string

  @property({ type: String })
  region!: string

  static styles = styles

  private getEKSHomePath() {
    return `https://${this.region}.console.aws.amazon.com/eks/home`
  }

  private renderClusters() {
    return html` <div>
      <table-view
        .columns="${COLUMNS}"
        .rows="${this.clusters!.map((cluster: IndexableCluster) => {
          return {
            name: cluster.name,
            status: cluster.status,
            kubernetesVersion: cluster.version,
            provider: 'EKS',
            createdAt: cluster.createdAt,
            actions: '',
          }
        })}"
        .displayable="${() => {
          return true
        }}"
        .renderer="${(row: IndexableCluster, field: string) => {
          switch (field) {
            case 'name':
              return html`<div class="grouped-row">
                <vscode-link
                  href="${`${this.getEKSHomePath()}?region=${this.region}#/clusters/${row.name}`}"
                  >${row[field]}</vscode-link
                >
              </div>`
            case 'kubernetesVersion':
              return html`<div class="flex flex-center">
                <span> ${row[field]}</span>
                <vscode-link
                  href="${'https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html'}"
                >
                  <div class="flex flex-center">
                    ${InfoIcon}
                    <span>Read more</span>
                  </div>
                </vscode-link>
              </div>`
            case 'status':
              return html`<div class="flex">
                <cluster-status status="${row.status as string}"></cluster-status>
              </div>`
            case 'createdAt':
              return html`<div>${formatDateWithTimeAgo(new Date(row.createdAt!))}</div>`
            case 'actions':
              return html`<eks-cluster-actions
                .cellId="${this.cellId}"
                .cluster="${row}"
                .region="${this.region}"
              ></eks-cluster-actions>`
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
    return html`
      ${when(
        this.clusters?.length,
        () =>
          html`<div class="integration">
              ${EKSIcon}
              <h3>AWS EKS | Clusters | ${this.region}</h3>
            </div>
            ${this.renderClusters()}`,
        () => {
          if (this.cluster) {
            return html`<eks-cluster
              .cluster="${this.cluster}"
              region="${this.region}"
            ></eks-cluster>`
          }
          return html`<div>Could not find clusters for ${this.region}</div>`
        },
      )}
      <div class="footer">
        <vscode-link
          class="link"
          href="${`https://${this.region}.console.aws.amazon.com/eks/home?region=${this.region}#/clusters`}"
          >Clusters</vscode-link
        ><vscode-link
          class="link vertical-left-divider"
          href=${`https://${this.region}.console.aws.amazon.com/eks/home?region=${this.region}#/cluster-create`}
        >
          Create new cluster at ${this.region}
        </vscode-link>
      </div>
      </div>
      `
  }
}
