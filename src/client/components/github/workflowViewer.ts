import { LitElement, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { when } from 'lit/directives/when.js'
import { Disposable } from 'vscode'
import { getContext } from '@runmedev/renderers'

import type { ClientMessage, GitHubState } from '../../../types'
import { closeOutput } from '../../utils'
import { ClientMessages, OutputType, RENDERERS } from '../../../constants'
import { onClientMessage } from '../../../utils/messaging'
import './workflowRun'
import { BranchIcon } from '../icons/branch'
import { WorkflowDispatchType, IWorkflowRun } from '../../../extension/services/github/types'
import { type DropdownListOption, type DropdownListEvent } from '../dropdownlist'

import styles from './styles/workflowViewer.css'

import '../dropdownlist'

/**
 * The maximum number of properties for a workflow dispatch event is 10
 */
const MAX_ALLOWED_INPUTS = 10
const MAX_ALLOWED_INPUTS_DOCS_URL =
  'https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#onworkflow_dispatchinputs'

interface IWorkflow {
  on: {
    workflow_dispatch?: {
      inputs: Record<string, string>
    }
  }
  name: string
}

enum DeploymentStatus {
  triggered,
  error,
  none,
}

@customElement(RENDERERS.GitHubWorkflowViewer)
export class WorkflowViewer extends LitElement {
  @property({ type: Boolean })
  protected isTriggeringWorkflow = false

  @property({ type: Number })
  protected deploymentStatus: DeploymentStatus = DeploymentStatus.none

  @property()
  protected reason?: string

  @property({ type: Object })
  workflowRun?: IWorkflowRun

  @property({ type: Object })
  state: GitHubState = {}

  protected disposables: Disposable[] = []

  private inputs: Record<string, string> = {}

  static styles = styles

  private renderTextField(
    id: string,
    text: string,
    description: string = '',
    placeHolder: string = '',
  ) {
    return html`<vscode-text-field
      id="${id}"
      type="text"
      value="${text}"
      placeholder=${placeHolder}
      @change=${(e: Event) => this.setElementValue(id, e)}
      size="50"
      class="github-workflow-control"
      ><label>${description}</label></vscode-text-field
    >`
  }

  private setElementValue(key: string, event: Event) {
    const inputElement = event.target as HTMLInputElement
    if (!event.defaultPrevented) {
      event.preventDefault()
    }

    // Update input value based on type
    if (this.inputs.hasOwnProperty(key)) {
      if (inputElement.checked !== undefined) {
        this.inputs[key] = inputElement.checked.toString()
      } else {
        this.inputs[key] = inputElement.value
      }
    }
  }

  private renderCheckbox(id: string, label: string, checked: boolean) {
    return html`
      ${when(
        checked,
        () => {
          return html`<vscode-checkbox
            id=${id}
            checked
            required
            class="github-workflow-control"
            @change="${(event: Event) => this.setElementValue(id, event)}"
            >${label}</vscode-checkbox
          >`
        },
        () => {
          return html`<vscode-checkbox
            id=${id}
            required
            class="github-workflow-control"
            @change="${(event: Event) => this.setElementValue(id, event)}"
            >${label}</vscode-checkbox
          >`
        },
      )}
    `
  }

  private sanitizeInputs() {
    const dispatchSquema = this.state.content!.on!.workflow_dispatch.inputs
    const sanitizedInputs = { ...this.inputs }
    for (const input in this.inputs) {
      const currentValue = this.inputs[input]
      if (currentValue === undefined) {
        const { type } = dispatchSquema[input]
        sanitizedInputs[input] = this.getDefaultValueFromType(type).toString()
      }
    }
    return sanitizedInputs
  }

  /**
   * Executes the GitHub Workflow
   */
  private async onRunWorkflow() {
    this.isTriggeringWorkflow = true
    const ctx = getContext()
    if (!ctx.postMessage) {
      return
    }
    const { owner, repo, workflow_id, ref } = this.state
    // TODO: Sanitize the input to use the default values.
    // const sanitizedInputValues = Object.keys(this.inputs).map((key) => this.getDefaultValueFromType())
    ctx.postMessage(<ClientMessage<ClientMessages.githubWorkflowDispatch>>{
      type: ClientMessages.githubWorkflowDispatch,
      output: {
        inputs: this.sanitizeInputs(),
        owner,
        repo,
        workflow_id,
        ref: ref ?? 'main',
        cellId: this.state.cellId,
      },
    })
  }

  connectedCallback(): void {
    super.connectedCallback()
    const ctx = getContext()
    this.disposables.push(
      onClientMessage(ctx, (e) => {
        if (e.type === ClientMessages.githubWorkflowDeploy) {
          const { itFailed, reason, workflowRun, cellId } = e.output
          // Ensure we only render changes for this workflow run
          if (cellId !== this.state.cellId) {
            return
          }
          this.isTriggeringWorkflow = false
          this.deploymentStatus = itFailed ? DeploymentStatus.error : DeploymentStatus.triggered
          this.reason = reason
          this.workflowRun = workflowRun
        } else if (e.type === ClientMessages.githubWorkflowStatusUpdate) {
          const { workflowRun, cellId } = e.output
          if (cellId !== this.state.cellId) {
            return
          }
          this.workflowRun = workflowRun
        }
      }),
    )
  }

  private bindEventProperty(event: CustomEvent<DropdownListEvent>) {
    if (this.inputs.hasOwnProperty(event.detail.key)) {
      this.inputs[event.detail.key] = event.detail.value
    }
  }

  private getDefaultValueFromType(type: WorkflowDispatchType): boolean | number | string {
    switch (type) {
      case 'boolean':
        return false
      case 'number':
        return 0
      default:
        return ''
    }
  }

  private getWorkflowForm() {
    const {
      on: { workflow_dispatch },
    } = this.state.content as unknown as IWorkflow

    if (workflow_dispatch === null) {
      return html`<div>Deploy workflow from: ${this.state.ref}</div>`
    }

    if (workflow_dispatch?.inputs) {
      const yamlDefinition = Object.entries(workflow_dispatch.inputs)
      const inputs = yamlDefinition.filter((p: unknown) => typeof p === 'object')
      const inputItems = inputs.map((option: any) => {
        const [key, { type, options, description, default: defaultValue }] = option
        // Set the default values of the form
        this.inputs[key] = defaultValue
        return html`<div class="row">
          ${when(
            type === 'choice',
            () =>
              html`<dropdown-list
                @onSelectedValue="${(event: CustomEvent<DropdownListEvent>) =>
                  this.bindEventProperty(event)}"
                .key="${key}"
                .options="${options.map((item: string) => {
                  return {
                    text: item,
                    value: item,
                  } as DropdownListOption
                })}"
                label="${description}"
                defaultValue="${defaultValue}"
              ></dropdown-list>`,
            () => html``,
          )}
          ${when(
            type === 'string',
            () => this.renderTextField(key, defaultValue, description),
            () => html``,
          )}
          ${when(
            type === 'boolean',
            () =>
              this.renderCheckbox(
                key,
                description,
                (this.inputs[key] as unknown as boolean) || false,
              ),
            () => html``,
          )}
          ${when(
            type === 'environment' && this.state.environments?.total_count,
            () =>
              html`<dropdown-list
                @onSelectedValue="${(event: CustomEvent<DropdownListEvent>) =>
                  this.bindEventProperty(event)}"
                .key="${key}"
                .options="${this.state.environments!.environments.map((env) => {
                  return {
                    text: env.name,
                    value: env.name,
                  } as DropdownListOption
                })}"
                label="${description}"
                defaultValue="${defaultValue}"
              ></dropdown-list>`,
            () => html``,
          )}
          ${when(
            type === 'number',
            () => this.renderTextField(key, defaultValue, description),
            () => html``,
          )}
        </div>`
      })

      return html`${when(
        inputs.length > MAX_ALLOWED_INPUTS,
        () => {
          return html`<div class="workflow-items-container warning">
            <div class="alert">
              This action is unlikely to be triggered as it exceeds the limit of 10 allowed
              top-level properties. You have a total of ${inputs.length} top-level properties.
              <vscode-link href="${MAX_ALLOWED_INPUTS_DOCS_URL}"> Read more </vscode-link>
            </div>
            ${inputItems}
          </div>`
        },
        () => {
          return html`<div class="workflow-items-container">${inputItems}</div>`
        },
      )}`
    }
  }

  private getWorkflowRunStatus() {
    return when(
      this.deploymentStatus === DeploymentStatus.triggered,
      () => {
        return html`
          <div class="message success-message">
            <h2>Workflow triggered!</h2>
            <p>The workflow is now running, the status will be updated automatically here.</p>
          </div>
          <github-workflow-run
            status="${this.workflowRun?.status || 'queued'}"
            conclusion="${this.workflowRun?.conclusion || ''}"
            runNumber="${this.workflowRun?.run_number || ''}"
            .htmlUrl="${this.workflowRun?.html_url}"
            .displayTitle="${this.workflowRun?.display_title}"
            .avatarUrl="${this.workflowRun?.actor.avatar_url}"
            .githubUserName="${this.workflowRun?.actor.login}"
          ></github-workflow-run>
        `
      },
      () => html``,
    )
  }

  private getFooter() {
    return html` <div class="run-action-footer ${this.isTriggeringWorkflow ? 'deploying' : ''}">
      ${when(
        this.isTriggeringWorkflow,
        () =>
          html`<vscode-progress-ring></vscode-progress-ring>
            <p>Triggering workflow...</p>`,
        () =>
          html` <vscode-button
            style="color: var(--vscode-button-foreground);
                background-color:var(--github-button-background);"
            @click="${this.onRunWorkflow}"
          >
            Run Workflow
          </vscode-button>`,
      )}
    </div>`
  }

  // Render the UI as a function of component state
  render() {
    const workflowForm = this.getWorkflowForm()
    if (workflowForm) {
      return html`
        <div class="github-workflow-item-container ${this.isTriggeringWorkflow ? 'fade' : ''}">
          <div class="branch container">${BranchIcon} Using workflow from main</div>
          ${this.getWorkflowRunStatus()}
          ${when(
            this.deploymentStatus === DeploymentStatus.error,
            () =>
              html`<div class="message error-message">
                Failed to trigger workflow:${this.reason}
              </div>`,
            () => html``,
          )}
          <div class="github-workflow-container">${workflowForm}</div>
          ${this.getFooter()}
          <close-cell-button
            @closed="${() => {
              return closeOutput({
                id: this.state.cellId!,
                outputType: OutputType.github,
              })
            }}"
          ></close-cell-button>
        </div>
      `
    }

    return html` <div class="message error-message">
      <h2>Error</h2>
      <p>
        Unsupported GitHub Workflow, please ensure you are specifying an action with
        workflow_dispatch
      </p>
      <close-cell-button
        @closed="${() => {
          return closeOutput({
            id: this.state.cellId!,
            outputType: OutputType.github,
          })
        }}"
      ></close-cell-button>
    </div>`
  }
}
