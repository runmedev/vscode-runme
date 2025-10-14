import { LitElement, TemplateResult, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { when } from 'lit/directives/when.js'
import { Disposable } from 'vscode'
import { filesize } from 'filesize'
import { getContext } from '@runmedev/renderers'

import { DaggerState, DaggerStateAction } from '../../types'
import { RENDERERS, ClientMessages } from '../../constants'
import { onClientMessage, postClientMessage } from '../../utils/messaging'

import { DaggerIcon, DaggerLogo } from './icons/dagger'
import './spinner'

@customElement(RENDERERS.DaggerCli)
export class DaggerCli extends LitElement {
  protected disposables: Disposable[] = []
  protected actionsMap = new Map<string, DaggerStateAction[]>()

  constructor() {
    super()

    // could be queried from the engine dynamically or at startup
    this.actionsMap.set('Container', [
      { label: 'Platform', action: 'platform' },
      { label: 'Workdir', action: 'workdir' },
      { label: 'Publish', action: 'publish', argument: 'address' },
      { label: 'Terminal', action: 'terminal' },
    ])
    this.actionsMap.set('Directory', [
      { label: 'Entires', action: 'entries' },
      { label: 'Directory', action: 'directory', argument: 'path' },
      { label: 'File', action: 'file', argument: 'path' },
      { label: 'Glob', action: 'glob' },
      // { label: 'Export', action: 'export' },
    ])
    this.actionsMap.set('File', [
      { label: 'Name', action: 'name' },
      { label: 'Size', action: 'size' },
      { label: 'Contents', action: 'contents' },
      { label: 'Export', action: 'export', argument: 'path' },
    ])
    this.actionsMap.set('Secret', [{ label: 'Name', action: 'name' }])
  }

  // Define scoped styles right with your component, in plain CSS
  static styles = css`
    vscode-button {
      color: var(--vscode-button-foreground);
      background-color: var(--vscode-button-background);
      transform: scale(0.9);
    }
    vscode-button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    vscode-button:focus {
      outline: #007fd4 1px solid;
    }
    .logo {
      width: 13px;
      padding-right: 4px;
      scale: 1.5;
    }

    .info {
      margin: 5px 5px;
      font-size: 1.4em;
    }

    .groups {
      display: flex;
      justify-content: space-between;
    }

    .groups span {
      font-family: Courier, monospace;
    }

    section {
      display: flex;
      flex-direction: column;
      gap: 5px;
      position: relative;
    }
  `
  @property({ type: String })
  cellId?: string

  @property({ type: Object })
  state: DaggerState = {}

  public static humandReadableSize(size: number) {
    return filesize(size, { standard: 'jedec' })
  }

  private get actions(): DaggerStateAction[] {
    return this.state?.cli?.actions ?? []
  }

  private get running(): boolean {
    return this.state.cli?.status === 'active'
  }

  private get returnedType(): string | undefined {
    return this.state.cli?.returnType
  }

  private get done(): TemplateResult<1> {
    if (this.state.cli?.returnText !== undefined) {
      let text = this.state.cli.returnText
      const num = Number(text)
      if (isFinite(num)) {
        text = DaggerCli.humandReadableSize(num)
      }
      return html`Result: <span>${text}</span>`
    }
    return html`Done`
  }

  private onAction(a: DaggerStateAction) {
    return (e: Event) => {
      if (e.defaultPrevented) {
        e.preventDefault()
      }

      let command = `${a.command?.trimEnd()} ${a.action}`
      if (a.action === 'terminal') {
        command = command.replace(' --progress=plain', '')
      }

      const ctx = getContext()
      ctx.postMessage &&
        postClientMessage(ctx, ClientMessages.daggerCliAction, {
          cellId: this.cellId!,
          command,
          argument: a.argument,
        })
    }
  }

  #applyState(dagger: any) {
    if (dagger.cellId !== this.cellId) {
      return
    }

    if (dagger.text !== undefined) {
      this.state = <DaggerState>{
        cellId: dagger.cellId,
        cli: {
          status: 'complete',
          returnText: dagger.text,
        },
      }
      return
    }

    const command = dagger.json?.runme.cellText
    const actions = this.actionsMap.get(dagger.json?._type) || []
    actions.forEach((a) => {
      Object.entries(dagger.json).forEach(([k, v]) => {
        if (k === a.action) {
          switch (typeof v) {
            case 'string':
              a.label += `: "${v}"`
              return
            case 'number':
              a.label += `: ${DaggerCli.humandReadableSize(v)}`
              return
            default:
              return
          }
        }
      })
      a.command = command
    })

    this.state = <DaggerState>{
      cellId: dagger.cellId,
      cli: {
        status: 'complete',
        actions,
        returnType: dagger.json?._type,
      },
    }

    this.requestUpdate()
  }

  connectedCallback(): void {
    super.connectedCallback()
    const ctx = getContext()

    if (this.state.output?.json) {
      this.#applyState({
        id: this.cellId,
        cellId: this.cellId,
        json: JSON.parse(this.state.output?.json),
      })
    } else if (this.state.output?.text) {
      this.#applyState({
        id: this.cellId,
        cellId: this.cellId,
        text: this.state.output?.text,
      })
    }

    this.disposables.push(
      onClientMessage(ctx, async (e) => {
        switch (e.type) {
          case ClientMessages.daggerSyncState:
            this.#applyState(e.output)
        }
      }),
    )
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.dispose()
  }

  dispose() {
    this.disposables.forEach(({ dispose }) => dispose())
  }

  // Render the UI as a function of component state
  render() {
    const status = when(
      !this.running && this.returnedType,
      () => html`${this.returnedType} ready`,
      () => (this.running ? html`Running` : this.done),
    )
    return html`<section>
      <div class="groups">
        <div class="info">${DaggerLogo} ${status}</div>
        <div>
          ${when(
            this.running,
            () => html`<vscode-spinner />`,
            () =>
              this.actions.map((a) => {
                return html`<dagger-button label=${a.label} @clicked="${this.onAction(a)}" />`
              }),
          )}
        </div>
      </div>
    </section>`
  }
}

@customElement('dagger-button')
export class CopyButton extends LitElement {
  @property({ type: String })
  label: string = 'Button'

  @property({ type: String })
  icon: TemplateResult<1> = DaggerIcon
  /* eslint-disable */
  static styles = css`
    vscode-button {
      color: var(--vscode-button-foreground);
      background-color: var(--vscode-button-background);
      transform: scale(0.9);
    }
    vscode-button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    vscode-button:focus {
      outline: #007fd4 1px solid;
    }
    .icon {
      width: 13px;
      margin: 0 5px 0 -5px;
      padding: 0;
    }
  `

  private onClick(e: Event) {
    if (e.defaultPrevented) {
      e.preventDefault()
    }
    const event = new CustomEvent('clicked')
    this.dispatchEvent(event)
  }

  render() {
    return html`
      <vscode-button appearance="secondary" @click=${this.onClick}
        >${this.icon} ${this.label}</vscode-button
      >
    `
  }
}
