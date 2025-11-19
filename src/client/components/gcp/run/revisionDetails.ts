import { LitElement, TemplateResult, css, html } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { Disposable } from 'vscode'
import { when } from 'lit/directives/when.js'
import { getContext } from '@runmedev/renderers'

import { ArrowLeft } from '../../icons/arrowLeft'
import { ClusterIcon } from '../../icons/cluster'
import { ArtifactRegistryIcon } from '../../icons/artifactRegistry'
import { DockerIcon } from '../../icons/docker'
import { postClientMessage } from '../../../../utils/messaging'
import { ClientMessages } from '../../../../constants'
import { GCPCloudRunActionType } from '../../../../types'
import { CloudRunContainer, Revision } from '../../../../extension/executors/gcp/run/types'

enum RevisionCommands {
  VisualizeYAML,
  DownloadYAML,
  Back,
}

@customElement('revision-details')
export class RevisionDetails extends LitElement implements Disposable {
  protected disposables: Disposable[] = []

  @property({ type: Object })
  revision?: Revision

  @property({ type: String })
  region!: string | undefined

  @property({ type: String })
  _selectedAction: GCPCloudRunActionType | undefined

  @property({ type: String })
  cellId!: string

  @property({ type: String })
  projectId!: string

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
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .action-notice {
      position: relative;
      border-bottom: 2px solid var(--vscode-settings-rowHoverBackground);
      animation-name: action-notice;
      animation-duration: 2s;
      animation-iteration-count: 2;
    }

    @keyframes action-notice {
      0% {
        border-color: var(--vscode-settings-rowHoverBackground);
      }

      50% {
        border-color: var(--github-button-background);
      }

      100% {
        border-color: var(--vscode-settings-rowHoverBackground);
      }
    }

    .integration {
      display: flex;
      margin: 10px 0;
      gap: 10px;
      align-items: center;
      font-weight: 400;
      font-size: 18px;
    }

    .footer {
      display: flex;
      place-content: center flex-end;
      margin-top: 10px;
      align-items: baseline;
    }

    .control-link {
      padding: 0px;
    }

    .footer .link {
      font-size: 10px;
      padding: 0 5px;
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

    .cluster-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      border-top: solid 1px var(--vscode-editorInlayHint-foreground);
      border-bottom: solid 1px var(--vscode-editorInlayHint-foreground);
      border-left: none;
      border-right: none;
    }

    tbody tr {
      text-align: left;
    }

    .loading {
      display: flex;
      align-items: center;
      gap: 10px;
      place-content: center;
    }

    .bold {
      font-weight: bold;
    }

    .flex {
      display: flex;
      align-items: baseline;
      gap: 1px;
    }

    .middle {
      align-items: center;
    }

    .divide {
      border-bottom: 1px solid var(--vscode-editorInlayHint-foreground);
    }

    .space {
      padding: 0.5rem;
    }

    .column {
      display: flex;
      flex-wrap: nowrap;
      flex-direction: row;
      justify-content: stretch;
    }

    .wide {
      min-width: 140px;
    }

    .long-word {
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 80%;
    }

    .header {
      background-color: var(--vscode-editor-inactiveSelectionBackground);
    }

    .container-section {
      margin-left: 0.5rem;
      padding: 0.5rem;
      border: solid 1px var(--vscode-editorInlayHint-foreground);
    }

    .command {
      background-color: var(--vscode-notebook-cellEditorBackground);
      padding: 0.5rem;
      border: solid 1px var(--vscode-notebook-selectedCellBorder);
      margin-left: 1rem;
    }

    .command-button {
      padding: 5px;
    }
  `

  private onBackClick(e: Event) {
    if (e.defaultPrevented) {
      e.preventDefault()
    }
    const event = new CustomEvent('onBack')
    this.dispatchEvent(event)
  }

  private getTabClass(tab: string) {
    return this.activeTabId === tab ? 'tab active-tab' : 'tab'
  }

  private setActiveTab(tab: string) {
    this.activeTabId = tab
  }

  private renderSection(
    title: string,
    values: Record<string, any>,
    headerIcon?: TemplateResult<1>,
  ) {
    const keys = Object.keys(values)
    const keyValues = Object.values(values)
    const numberOfKeys = keys.length
    const numberOfValues = keyValues.length

    return html`<h3 class="divide header space">
        ${when(
          headerIcon,
          () => html`${headerIcon}`,
          () => html``,
        )}
        ${title}
      </h3>
      <div class="column">
        <div class="wide">
          ${keys.map((key, index) =>
            when(
              values[key],
              () =>
                html`<div
                  class="${when(
                    index === numberOfKeys - 1,
                    () => 'bold space',
                    () => 'bold divide space',
                  )}"
                >
                  ${key}
                </div>`,
              () => html``,
            ),
          )}
        </div>
        <div>
          ${keyValues.map((value, index) =>
            when(
              value,
              () =>
                html`<div
                  class="${when(
                    index === numberOfValues - 1,
                    () => 'space',
                    () => 'divide space',
                  )}"
                >
                  ${value}
                </div>`,
              () => html``,
            ),
          )}
        </div>
      </div>`
  }

  private renderContainerDetails(container: CloudRunContainer) {
    return html`${this.renderSection(container.name, {
      Port: container.port,
      CPU: container.cpu,
      Memory: container.memory,
      'Image URL': html`
        <div class="flex">
          ${DockerIcon}
          <vscode-link class="control-link" href="${container.artifactRegistryUrl}">
            <div class="long-word">${container.image}</div>
          </vscode-link>
        </div>
      `,
    })}`
  }

  private renderContainerEnvVars(container: CloudRunContainer) {
    const columns = [
      {
        text: 'Name',
      },
      {
        text: 'Value',
      },
    ]
    if (!container.env) {
      return html``
    }
    return html`<table-view
      .columns="${columns}"
      .rows="${container.env.map((env) => {
        return {
          name: env.name,
          value: env.value,
        }
      })}"
      .displayable="${() => true}"
      .renderer="${(row: any, field: string) => {
        return html`${row[field]}`
      }}"
    ></table-view>`
  }

  private runCommand(command: RevisionCommands) {
    const ctx = getContext()
    if (!ctx.postMessage) {
      return
    }
    switch (command) {
      case RevisionCommands.DownloadYAML:
        this._selectedAction = GCPCloudRunActionType.DownloadYAML
        break
      case RevisionCommands.VisualizeYAML:
        this._selectedAction = GCPCloudRunActionType.DescribeYAML
    }
    return postClientMessage(ctx, ClientMessages.gcpCloudRunAction, {
      cellId: this.cellId,
      resource: this.revision?.name!,
      action: this._selectedAction!,
      resourceType: 'revisions',
      project: this.projectId,
      region: this.region,
    })
  }

  private renderViewInBrowser() {
    return html` <vscode-link
      class="control-link"
      href="${`https://console.cloud.google.com/run/detail/${this.region}/${this.revision?.service}/revisions?project=${this.projectId}`}"
    >
      View in browser
    </vscode-link>`
  }

  private renderDetails() {
    return html`
      <div>
        <div class="cluster-actions">
          <vscode-button @click="${(e: Event) => this.onBackClick(e)}">${ArrowLeft}</vscode-button>
          <h3>${this.revision?.name}</h3>
          <vscode-link class="link" href="${`${this.revision?.logUri}`}"
            >${ClusterIcon}</vscode-link
          >
        </div>
        <vscode-panels activeid="${this.activeTabId}">
          <vscode-panel-tab
            id="tab-1"
            class="${this.getTabClass('tab-1')}"
            @click="${() => this.setActiveTab('tab-1')}"
            >Containers</vscode-panel-tab
          >
          <vscode-panel-tab
            id="tab-2"
            class="${this.getTabClass('tab-2')}"
            @click="${() => this.setActiveTab('tab-2')}"
            >Volumes</vscode-panel-tab
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
            >Networking</vscode-panel-tab
          >
          <vscode-panel-tab
            id="tab-5"
            class="${this.getTabClass('tab-5')}"
            @click="${() => this.setActiveTab('tab-5')}"
            >Security</vscode-panel-tab
          >
          <vscode-panel-tab
            id="tab-6"
            class="${this.getTabClass('tab-6')}"
            @click="${() => this.setActiveTab('tab-6')}"
            >YAML</vscode-panel-tab
          >
          <vscode-panel-view id="view-1" class="panel">
            <section class="flex">
              <div>
                ${this.renderSection('General', {
                  'CPU allocation': 'CPU is only allocated during request processing',
                  'Startup CPU boost':
                    this.revision?.containers?.length && this.revision.containers[0].startupCpuBoost
                      ? 'Enabled'
                      : 'Disabled',
                  Concurrency: this.revision?.concurrency,
                  'Request timeout': `${this.revision?.timeout} seconds`,
                  'Execution environment': this.revision?.executionEnvironment,
                })}
                ${this.renderSection('Autoscaling', {
                  'Min instances': this.revision?.autoScaling.minInstances,
                  'Max instances': this.revision?.autoScaling.maxInstances,
                })}
                <div class="integration">
                  ${ArtifactRegistryIcon}
                  <h3>Containers</h3>
                </div>
                ${html`${this.revision?.containers?.map((container) => {
                  return html`${this.renderContainerDetails(container)}
                  ${when(
                    container.env?.length,
                    () => {
                      return html`<div class="container-section">
                        <h3>Environment variables (${container.env?.length})</h3>
                        ${this.renderContainerEnvVars(container)}
                      </div>`
                    },
                    () => html``,
                  )} `
                })}`}
              </div>
            </section>
          </vscode-panel-view>
          <vscode-panel-view id="view-2" class="panel">
            ${this.renderViewInBrowser()}
          </vscode-panel-view>
          <vscode-panel-view id="view-3" class="panel">
            ${this.renderViewInBrowser()}
          </vscode-panel-view>
          <vscode-panel-view id="view-4" class="panel">
            ${this.renderViewInBrowser()}
          </vscode-panel-view>
          <vscode-panel-view id="view-5" class="panel">
            ${this.renderViewInBrowser()}
          </vscode-panel-view>
          <vscode-panel-view id="view-6" class="panel">
            ${html`<div>
              <h2>YAML</h2>
              <p>
                By running one of the following options, a new cell will be added running the
                specified gcloud command.
              </p>
              <h3>Visualize</h3>
              <div class="flex middle">
                <div class="command">
                  gcloud run revisions describe ${this.revision?.name} --format yaml --project
                  ${this.projectId} --region ${this.region}
                </div>
                <vscode-button
                  class="command-button"
                  @click="${() => this.runCommand(RevisionCommands.VisualizeYAML)}"
                  >Run</vscode-button
                >
              </div>
              <h3>Download</h3>
              <div class="flex middle">
                <div class="command">
                  gcloud run revisions describe ${this.revision?.name} --project ${this.projectId}
                  --region ${this.region} --format yaml > ${this.revision?.name}.yaml
                </div>
                <vscode-button
                  class="command-button"
                  @click="${() => this.runCommand(RevisionCommands.DownloadYAML)}"
                  >Run</vscode-button
                >
              </div>
            </div>`}
          </vscode-panel-view>
        </vscode-panels>
      </div>
    `
  }

  dispose() {
    this.disposables.forEach(({ dispose }) => dispose())
  }

  render() {
    return this.renderDetails()
  }
}
