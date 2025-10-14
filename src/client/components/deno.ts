import { LitElement, css, html } from 'lit'
import { when } from 'lit/directives/when.js'
import { customElement, property } from 'lit/decorators.js'
import '@vscode/webview-ui-toolkit/dist/button/index'
import { getContext } from '@runmedev/renderers'

import { Deployment, Project } from '../../utils/deno/api_types'
import { ClientMessages, RENDERERS } from '../../constants'
import type { ClientMessage, DenoState } from '../../types'

import './spinner'

@customElement(RENDERERS.DenoOutput)
export class DenoOutput extends LitElement {
  #isPromoting = false

  // Define scoped styles right with your component, in plain CSS
  static styles = css`
    :host {
      display: block;
      font-family: Arial;
    }

    section {
      padding: 10px;
      border: 1px solid #444;
      display: flex;
      flex-direction: row;
      gap: 50px;
      align-items: flex-start;
    }

    img {
      width: 100px;
      padding: 20px;
    }

    h4 {
      margin-bottom: 0;
    }

    .btnPromote {
      margin-top: 15px;
      display: block;
      width: fit-content;
    }
  `

  @property({ type: Object })
  state: DenoState = {}

  private get project(): Project {
    return this.state?.project
  }

  private get deployments() {
    return this.state?.deployments
  }

  private get deployed() {
    return this.state?.deployed
  }

  private get promoted() {
    return this.state?.promoted
  }

  // Render the UI as a function of component state
  render() {
    const supportsMessaging = Boolean(getContext().postMessage)
    if (!this.project || !this.deployments || this.deployments.length === 0) {
      return html`Deploying to Deno...`
    }

    const project = this.project!
    const prodDomainMapping = project.productionDeployment?.domainMappings.reduce((acc, curr) =>
      // oldest is prod domain mapping
      acc?.createdAt > curr.createdAt ? curr : acc,
    )
    const deployment = this.deployments[0]
    return html`<section>
      <img src="https://www.svgrepo.com/show/378789/deno.svg" />
      <div>
        <h4>Deployment</h4>
        ${this.deployed
          ? html`
              <vscode-link href="https://${deployment.domainMappings[0].domain}">
                ${deployment.domainMappings[0].domain}
              </vscode-link>
            `
          : html`Pending`}
        <h4>Project</h4>
        <vscode-link href="https://dash.deno.com/projects/${project.name}/deployments">
          ${project.name}
        </vscode-link>
      </div>
      <div>
        <h4>Created At</h4>
        ${this.deployed ? new Date(deployment.createdAt).toString() : 'Pending'}
        <h4>Status</h4>
        ${this.deployed
          ? supportsMessaging && this.promoted
            ? 'Production'
            : 'Preview'
          : html`Deploying <vscode-spinner />`}
        ${when(
          this.deployed && supportsMessaging && !this.promoted,
          () => html`
            <vscode-button
              class="btnPromote"
              @click="${() => this.#promote(deployment)}"
              .disabled=${this.#isPromoting}
            >
              🚀 ${this.#isPromoting ? 'Promoting...' : 'Promote to Production'}
            </vscode-button>
          `,
        )}
        ${when(
          this.deployed && supportsMessaging && this.promoted && project.hasProductionDeployment,
          () => html`
            <p>
              Promoted to 🚀:
              <vscode-link href="https://${prodDomainMapping?.domain}">
                ${prodDomainMapping?.domain}
              </vscode-link>
            </p>
          `,
        )}
      </div>
    </section>`
  }

  #promote(deployment: Deployment) {
    const ctx = getContext()
    if (!ctx.postMessage) {
      return
    }

    this.#isPromoting = true
    this.requestUpdate()
    ctx.postMessage(<ClientMessage<ClientMessages.denoPromote>>{
      type: ClientMessages.denoPromote,
      output: {
        id: deployment.projectId,
        productionDeployment: deployment.id,
      },
    })
  }

  connectedCallback() {
    super.connectedCallback()
    const ctx = getContext()

    if (!ctx.onDidReceiveMessage) {
      return
    }

    ctx.onDidReceiveMessage((e: ClientMessage<ClientMessages>) => {
      if (!e.type.startsWith('deno:')) {
        return
      }

      switch (e.type) {
        case ClientMessages.denoUpdate: {
          const payload = e.output
          this.state = {
            ...this.state,
            ...payload,
          }
        }
      }
      this.requestUpdate()
    })
  }
}
