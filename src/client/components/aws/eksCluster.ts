import { Disposable } from 'vscode'
import { LitElement, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { when } from 'lit/directives/when.js'

import './ec2InstanceActions'
import './clusterStatus'

import { type IndexableCluster } from '../../../extension/executors/aws/types'
import { EKSIcon } from '../icons/eks'
import { InfoIcon } from '../icons/info'
import { formatDateWithTimeAgo } from '../../utils'

import styles from './styles/clusterDetails.css'

interface Tab {
  name: string
}

@customElement('eks-cluster')
export class EKSCluster extends LitElement implements Disposable {
  protected disposables: Disposable[] = []

  @property({ type: Object })
  cluster: IndexableCluster | undefined

  @property({ type: String })
  cellId!: string

  @property({ type: String })
  region!: string

  @state()
  activeTabId: string = 'tab-1'

  @state()
  copyText: string = 'Copy'

  static styles = styles

  private setActiveTab(tab: string) {
    this.activeTabId = tab
  }

  private getTabClass(tab: string) {
    return this.activeTabId === tab ? 'tab active-tab' : 'tab'
  }

  private getAWSConsolePath(fragment?: string | undefined) {
    return `https://${this.region}.console.aws.amazon.com${fragment ?? ''}`
  }

  private getResourceLink({
    region,
    cluster,
    section,
    fragment,
  }: {
    region: string
    cluster: string
    section: string
    fragment: string
  }) {
    return `${this.getAWSConsolePath(fragment)}?region=${region}#/clusters/${cluster}?selectedTab=${section}`
  }

  private renderViewDetailsLink(section: string) {
    return html`<div class="action-button">
      <vscode-link
        class="link"
        href="${this.getResourceLink({
          region: this.region,
          cluster: this.cluster?.name || '',
          section,
          fragment: '/eks/home',
        })}"
        >View in AWS EKS Console</vscode-link
      >
    </div>`
  }

  private renderTab(name: string, id: string) {
    return html` <vscode-panel-tab
      id="tab-${id}"
      class="${this.getTabClass(`tab-${id}`)}"
      @click="${() => this.setActiveTab(`tab-${id}`)}"
      >${name}</vscode-panel-tab
    >`
  }

  private renderTabs(tabs: Tab[]) {
    return html`${tabs.map((tab: Tab, index) => this.renderTab(tab.name, (index + 1).toString()))}`
  }

  #copy(content: string) {
    return navigator.clipboard.writeText(content)
  }

  private renderCluster() {
    return html` <div>
      <div class="instance-header flex items-center space-between row font-lg">
        <div>${this.cluster?.name}</div>
        <vscode-link
          href="${this.getAWSConsolePath(
            `/eks/home?region=${this.region}#/clusters/${this.cluster?.name}`,
          )}"
        >
          <div class="flex flex-center">
            ${InfoIcon}
            <span>View details</span>
          </div>
        </vscode-link>
      </div>
      <div class="columns">
        <div class="column">
          <div class="row">
            <div>Status</div>
            <div>
              <cluster-status
                .displayStatusText="${true}"
                status="${this.cluster?.status as string}"
              ></cluster-status>
            </div>
          </div>
        </div>
        <div class="column">
          <div class="row">
            <div>Kubernetes version</div>
            <div>${this.cluster?.version}</div>
          </div>
        </div>
        <div class="column">
          <div class="row">
            <div>Support period</div>
            <div>
              <vscode-link
                href="${'https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html'}"
              >
                <div class="flex flex-center">
                  ${InfoIcon}
                  <span>Read more</span>
                </div>
              </vscode-link>
            </div>
          </div>
        </div>
        <div class="column">
          <div class="row">
            <div>Provider</div>
            <div>EKS</div>
          </div>
        </div>
      </div>
      <div class="instance-panels">
        <vscode-panels class="panels" activeid="${this.activeTabId}">
          ${this.renderTabs([
            {
              name: 'Overview',
            },
            {
              name: 'Resources',
            },
            {
              name: 'Compute',
            },
            {
              name: 'Networking',
            },
            {
              name: 'Add-ons',
            },
            {
              name: 'Access',
            },
            {
              name: 'Observability',
            },
            {
              name: 'Upgrade insights',
            },
            {
              name: 'Update history',
            },
            {
              name: 'Tags',
            },
          ])}
          <vscode-panel-view id="view-1" class="panel-view">
            <div>
              <div class="instance-header font-md">Details</div>
              <div class="columns">
                <div class="column">
                  <div class="row">
                    <div class="bold">API Server endpoint</div>
                    <div>${this.cluster?.endpoint}</div>
                  </div>
                  <div class="row">
                    <div class="bold">Certificate authority</div>
                    <div class="flex space-between items-center">
                      <div class="long-word">${this.cluster?.certificateAuthority?.data}</div>
                      <copy-button
                        copyText="${this.copyText}"
                        @onCopy="${async () => {
                          this.#copy(this.cluster?.certificateAuthority?.data || '')
                          this.copyText = 'Copied!'
                          setTimeout(() => {
                            this.copyText = 'Copy'
                          }, 1000)
                        }}"
                      ></copy-button>
                    </div>
                  </div>
                </div>
                <div class="column">
                  <div class="row">
                    <div class="bold">OpenID Connect provider URL</div>
                    <div>${this.cluster?.identity?.oidc?.issuer || 'none'}</div>
                  </div>
                  <div class="row">
                    <div class="bold">Cluster IAM role ARN</div>
                    <div class="flex">
                      <span> ${this.cluster?.roleArn} </span>
                      <vscode-link
                        href="${this.getAWSConsolePath(
                          `/iam/home?region=${this.region}#/roles/kubernetes`,
                        )}"
                      >
                        <div class="flex flex-center">
                          ${InfoIcon}
                          <span>View in IAM</span>
                        </div>
                      </vscode-link>
                    </div>
                  </div>
                </div>
                <div class="column">
                  <div class="row">
                    <div class="bold">Created</div>
                    <div>
                      ${this.cluster?.createdAt
                        ? formatDateWithTimeAgo(new Date(this.cluster?.createdAt))
                        : '-'}
                    </div>
                  </div>
                  <div class="row">
                    <div class="bold">Cluster ARN</div>
                    <div>${this.cluster?.arn}</div>
                  </div>
                  <div class="row">
                    <div class="flex">
                      <div class="bold">Platform version</div>
                      <vscode-link
                        class="link"
                        href="${'https://docs.aws.amazon.com/eks/latest/userguide/platform-versions.html'}"
                      >
                        Info</vscode-link
                      >
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </vscode-panel-view>
          <vscode-panel-view id="view-2" class="panel-view">
            <div>
              <div class="instance-header font-md">Resources</div>
              ${this.renderViewDetailsLink('cluster-resources')}
            </div>
          </vscode-panel-view>
          <vscode-panel-view id="view-3" class="panel-view">
            <div>
              <div class="instance-header font-md">Compute</div>
              ${this.renderViewDetailsLink('compute-tab')}
            </div>
          </vscode-panel-view>
          <vscode-panel-view id="view-4" class="panel-view">
            <div>
              <div class="instance-header font-md">Networking</div>
              ${this.renderViewDetailsLink('cluster-networking-tab')}
            </div>
          </vscode-panel-view>
          <vscode-panel-view id="view-5" class="panel-view">
            <div>
              <div class="instance-header font-md">Add-ons</div>
              ${this.renderViewDetailsLink('cluster-add-ons-tab')}
            </div>
          </vscode-panel-view>
          <vscode-panel-view id="view-6" class="panel-view">
            <div>
              <div class="instance-header font-md">Access</div>
              ${this.renderViewDetailsLink('cluster-access-tab')}
            </div>
          </vscode-panel-view>
          <vscode-panel-view id="view-7" class="panel-view">
            <div>
              <div class="instance-header font-md">Observability</div>
              ${this.renderViewDetailsLink('cluster-logging-tab')}
            </div>
          </vscode-panel-view>
          <vscode-panel-view id="view-8" class="panel-view">
            <div>
              <div class="instance-header font-md">Upgrade insights</div>
              ${this.renderViewDetailsLink('cluster-upgrade-insights-tab')}
            </div>
          </vscode-panel-view>
          <vscode-panel-view id="view-9" class="panel-view">
            <div>
              <div class="instance-header font-md">Update history</div>
              ${this.renderViewDetailsLink('cluster-updates-tab')}
            </div>
          </vscode-panel-view>
          <vscode-panel-view id="view-10" class="panel-view">
            <div>
              <div class="instance-header font-md">Tags</div>
              ${this.renderViewDetailsLink('cluster-tags-tab')}
            </div>
          </vscode-panel-view>
        </vscode-panels>
      </div>
    </div>`
  }

  dispose() {
    this.disposables.forEach(({ dispose }) => dispose())
  }

  render() {
    return html`<div class="integration">
        ${EKSIcon}
        <h3>AWS EKS | Cluster details</h3>
      </div>
      ${when(
        this.cluster,
        () => this.renderCluster(),
        () => html`<div>Could not find the specified cluster</div>`,
      )} `
  }
}
