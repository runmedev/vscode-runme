import { LitElement, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { when } from 'lit/directives/when.js'
import { getContext } from '@runmedev/renderers'

import type {
  ClientMessage,
  CellAnnotations,
  CellAnnotationsErrorResult,
  Settings,
} from '../../../types'
import { CellAnnotationsSchema, AnnotationSchema } from '../../../schema'
import {
  ClientMessages,
  NOTEBOOK_AVAILABLE_CATEGORIES,
  OutputType,
  RENDERERS,
  CATEGORY_SEPARATOR,
} from '../../../constants'
import { closeOutput } from '../../utils'
import { postClientMessage, onClientMessage } from '../../../utils/messaging'
import { ExternalLinkIcon } from '../icons/external'

import './categorySelector'
import styles from './styles'

type AnnotationsMutation = Partial<CellAnnotations>
type AnnotationsKey = keyof typeof AnnotationSchema
type Target = {
  target: {
    id: AnnotationsKey
    checked: boolean
    value: string
    type: string
  }
}

interface configDetails {
  description: string
}

interface DropdownListOption {
  text: string
  value: string
  enumNum?: number
}

@customElement(RENDERERS.EditAnnotations)
export class Annotations extends LitElement {
  static styles = styles

  readonly #details: { [id: string]: configDetails } = {
    background: {
      description: 'Run the cell as background process.',
    },
    interactive: {
      description: 'Run cell inside terminal to allow for interactive input.',
    },
    closeTerminalOnSuccess: {
      description: 'Hide terminal panel after cell successful execution.',
    },
    openTerminalOnError: {
      description: 'open terminal panel after cell execution error.',
    },
    promptEnv: {
      description: 'Prompt user input for exported environment variables.',
    },
    mimeType: {
      description: "Cell's output MIME type (non-interactive); skips auto-detection.",
    },
    name: {
      description: 'Cell name or environment variable name to export the cell output (see docs).',
    },
    cwd: {
      description: 'Optionally run the cell in different working directory (cwd).',
    },
    interpreter: {
      description: 'Inserted into shebang (aka #!) line.',
    },
    category: {
      description: 'Execute this code cell within a tag (no comma or spaces allowed).',
    },
    excludeFromRunAll: {
      description: 'Prevent executing this cell during the "Run All" operation.',
    },
    terminalRows: {
      description: 'Number of rows to display in the notebook terminal.',
    },
  }

  // Declare reactive properties
  @property({ type: Object, reflect: true })
  annotations?: CellAnnotations

  @property({ type: Object, reflect: true })
  validationErrors?: CellAnnotationsErrorResult

  @property({ type: Array })
  categories: string[] = []

  @property({ type: Object })
  settings: Settings = {}

  #getTargetValue(e: Target) {
    switch (e.target.type) {
      case 'text':
        return e.target.value
      default:
        return e.target.checked.toString()
    }
  }

  #onChange(e: MouseEvent & Target) {
    if (!this.annotations || !e.target) {
      return
    }

    const propVal: any = { 'runme.dev/id': this.annotations['runme.dev/id'] }
    const propName = e.target.id
    const targetValue = this.#getTargetValue(e)

    const parseResult = CellAnnotationsSchema.safeParse({
      [propName]: targetValue,
    })

    if (!parseResult.success) {
      const { fieldErrors } = parseResult.error.flatten()
      // TODO: Revisit this implementation to prevent mutating this object
      if (this.validationErrors && !this.validationErrors?.errors) {
        this.validationErrors.errors = {}
      }
      if (this.validationErrors?.errors && !this.validationErrors.errors[propName]) {
        this.validationErrors.errors[propName] = fieldErrors[propName]
      }
      // Re-render the form
      return this.requestUpdate()
    }

    if (this.validationErrors?.errors && this.validationErrors.errors[propName]) {
      delete this.validationErrors.errors[propName]
      this.requestUpdate()
    }

    switch (e.target.type) {
      case 'text':
        ;(this.annotations as any)[propName] = targetValue
        propVal[propName] = targetValue
        return this.#dispatch(propVal)
      default:
        ;(this.annotations as any)[e.target.id] = targetValue
        propVal[propName] = targetValue
        return this.#dispatch(propVal)
    }
  }

  #dispatch(prop: AnnotationsMutation) {
    const ctx = getContext()
    if (!ctx.postMessage) {
      return
    }

    ctx.postMessage(<ClientMessage<ClientMessages.mutateAnnotations>>{
      type: ClientMessages.mutateAnnotations,
      output: { annotations: prop },
    })
  }

  renderCheckbox(id: string, isChecked: boolean, isReadOnly: boolean) {
    const details = this.#details?.[id]

    return html`<vscode-checkbox
      id="${id}"
      @change="${this.#onChange}"
      checked="${isReadOnly ? true : isChecked}"
      @blur="${this.#onChange}"
      readonly=${isReadOnly}
      class="annotation-item"
      >${details.description}</vscode-checkbox
    >`
  }

  private setControlValue(key: string, e: Target) {
    const propVal: any = { 'runme.dev/id': this.annotations!['runme.dev/id'] }
    propVal[key] = e.target?.value
    return this.#dispatch(propVal)
  }

  private renderDropdownList(
    group: string,
    groupLabel: string,
    options: DropdownListOption[],
    defaultValue: string,
  ) {
    return html`
      <div class="dropdown-container">
        <label slot="label">${groupLabel}</label>
        <div class="setting-item-control select-container">
          <select @change=${(e: Target) => this.setControlValue(group, e)}>
            ${options.map(({ text, value, enumNum }: DropdownListOption) => {
              enumNum ??= Number.POSITIVE_INFINITY
              return value === defaultValue || enumNum === Number(defaultValue)
                ? html`<option value="${value}" selected>${text}</option>`
                : html`<option value="${value}">${text}</option>`
            })}
          </select>
        </div>
      </div>
    `
  }

  renderTextField(id: string, text: string, placeHolder: string = '') {
    const details = this.#details?.[id] as any

    return html`<vscode-text-field
      id="${id}"
      type="text"
      value="${text}"
      @change="${this.#onChange}"
      @keyup="${this.#onChange}"
      placeholder=${placeHolder}
      size="50"
      class="annotation-item"
      ><div style="margin-top:2px;margin-bottom:10px;">
        ${details.description}
      </div></vscode-text-field
    >`
  }

  renderErrors(errorMessages: string[]) {
    return html`<ul>
      ${errorMessages.map((error: string) => {
        return html`<li class="error-item">${error}</li>`
      })}
    </ul>`
  }

  renderCurrentValueError(value: string) {
    return html`<p class="error-item current-value-error">Received value: ${value}</p>`
  }

  renderDocsLink(id: string) {
    const link = `${this.settings?.docsUrl}/r/extension/${id}`
    return html`<vscode-link href="${link}">(docs ${ExternalLinkIcon})</vscode-link>`
  }

  renderCheckboxTabEntry(id: AnnotationsKey) {
    const value = this.annotations?.[id]

    return html`<div>
      <div class="themeText" style="font-weight:600">${id} ${this.renderDocsLink(id)}</div>
      <div style="padding-top:4px">${this.renderCheckbox(id, value as boolean, false)}</div>
    </div> `
  }

  renderDropdownListTabEntry(id: AnnotationsKey, options: DropdownListOption[]) {
    const value = this.annotations?.[id] || ''
    const details = this.#details?.[id]

    return html`<div>
      <div class="themeText" style="font-weight:600">${id} ${this.renderDocsLink(id)}</div>
      <div style="padding-top:4px">
        ${this.renderDropdownList(id, details.description, options, value?.toString())}
      </div>
    </div> `
  }

  renderTextFieldTabEntry(id: AnnotationsKey) {
    let value = this.annotations?.[id]
    let nameGenerated = this.annotations?.['runme.dev/nameGenerated']

    const errors: string[] = this.validationErrors?.errors
      ? this.validationErrors.errors[id as keyof CellAnnotations] || []
      : []
    const originalValue = errors.length
      ? this.validationErrors?.originalAnnotations[id as keyof CellAnnotations]
      : value

    let placeHolder = ''
    if (id === 'name' && nameGenerated && value === this.annotations?.['runme.dev/name']) {
      placeHolder = value as string
      value = ''
    }

    return html`<div>
        <div style="font-weight:600" class="themeText">${id} ${this.renderDocsLink(id)}</div>
        <div style="padding-top:4px">${this.renderTextField(id, value as string, placeHolder)}</div>
      </div>

      ${when(errors.length, () => this.renderErrors(errors))}
      ${when(
        typeof value === 'boolean' && errors.length,
        () => this.renderCurrentValueError(originalValue as string),
        () => html``,
      )} `
  }

  renderCategoryTabEntry(id: AnnotationsKey) {
    const value = this.annotations?.[id]
    const details = this.#details?.[id]

    return html`<div>
      <div>
        <category-selector
          categories="${this.categories}"
          createNewCategoryText="Add tag"
          selectCategoryText="Select tag"
          selectedCategory="${value!}"
          description="${details.description}"
          identifier="${id}"
          @onChange=${this.onCategorySelectorChange}
          @onCreateNewCategory=${this.createNewCategoryClick}
          @settings=${this.settings}
        ></category-selector>
      </div>
    </div>`
  }

  private getCellId() {
    return (this.annotations && this.annotations['runme.dev/id']) || ''
  }

  protected onCategorySelectorChange(e: CustomEvent) {
    this.categories = e.detail.categories.split(CATEGORY_SEPARATOR)
    this.setCategory()
  }

  protected createNewCategoryClick() {
    const ctx = getContext()
    ctx.postMessage &&
      postClientMessage(ctx, ClientMessages.displayPrompt, {
        placeholder: 'Tag name',
        isSecret: false,
        title: 'New cell execution tag',
        id: this.getCellId(),
      })
  }

  connectedCallback(): void {
    super.connectedCallback()
    const ctx = getContext()
    const id = this.getCellId()
    ctx.postMessage &&
      postClientMessage(ctx, ClientMessages.getState, {
        state: NOTEBOOK_AVAILABLE_CATEGORIES,
        id,
      })
    onClientMessage(ctx, (e) => {
      switch (e.type) {
        case ClientMessages.onPrompt:
          const answer = e.output.answer
          if (!answer || e.output.id !== id) {
            return
          }
          for (const newCategory of answer.split(CATEGORY_SEPARATOR)) {
            if (!this.categories.includes(newCategory)) {
              this.categories.push(newCategory)
            }
          }
          ctx.postMessage &&
            postClientMessage(ctx, ClientMessages.setState, {
              state: NOTEBOOK_AVAILABLE_CATEGORIES,
              value: this.categories,
              id,
            })
          return this.setCategory(answer)
        case ClientMessages.onGetState:
          if (e.output.state === NOTEBOOK_AVAILABLE_CATEGORIES && e.output.id === id) {
            this.categories = e.output.value as unknown as string[]
            this.requestUpdate()
          }
          break
        default:
          return
      }
    })
  }

  private setCategory(category?: string) {
    if (this.annotations) {
      this.annotations.category = category || this.annotations.category
      this.requestUpdate()

      /**
       * make VS Code display warn message to save document
       */
      const ctx = getContext()
      postClientMessage(ctx, ClientMessages.onCategoryChange, undefined)

      return this.#dispatch({
        'runme.dev/id': this.annotations['runme.dev/id'],
        category: this.categories.join(CATEGORY_SEPARATOR),
      })
    }
  }

  // Render the UI as a function of component state
  render() {
    if (!this.annotations) {
      return html`⚠️ Whoops! Something went wrong displaying the editing UI!`
    }

    const markup = html`<div style="width:100%;">
      <vscode-panels>
        <vscode-panel-tab id="tab-1" class="themeText noSelect">GENERAL</vscode-panel-tab>
        <vscode-panel-tab id="tab-2" class="themeText noSelect">ADVANCED</vscode-panel-tab>
        <vscode-panel-view id="view-1">
          <div class="grid">
            <div class="box">${this.renderTextFieldTabEntry('name')}</div>
            <div class="box">
              ${this.renderDropdownListTabEntry('promptEnv', [
                { text: 'Auto', value: 'auto', enumNum: 0 },
                { text: 'Always', value: 'always', enumNum: 1 },
                { text: 'Never', value: 'never', enumNum: 2 },
              ])}
            </div>
            <div class="box">${this.renderTextFieldTabEntry('cwd')}</div>
            <div class="box">${this.renderCheckboxTabEntry('interactive')}</div>
          </div>
        </vscode-panel-view>
        <vscode-panel-view id="view-2">
          <div class="grid">
            <div class="box">${this.renderCheckboxTabEntry('background')}</div>
            <div class="box">${this.renderTextFieldTabEntry('interpreter')}</div>
            <div class="box">${this.renderTextFieldTabEntry('mimeType')}</div>
            <div class="box">${this.renderTextFieldTabEntry('terminalRows')}</div>
            <div class="box">${this.renderCategoryTabEntry('category')}</div>
            <div class="box">${this.renderCheckboxTabEntry('excludeFromRunAll')}</div>
          </div>
        </vscode-panel-view>
      </vscode-panels>
    </div>`

    const errorArr = Object.keys(this.#details).map((key) => {
      const errors: string[] = this.validationErrors?.errors
        ? this.validationErrors.errors[key as keyof CellAnnotations] || []
        : []
      return errors.length
    })

    const errorCount = errorArr.reduce(function (a, b) {
      return a + b
    })

    return html` <section class="annotation-container ${errorCount ? 'has-errors' : ''}">
      ${markup}
      <close-cell-button
        @closed="${() => {
          return closeOutput({
            id: (this.annotations && this.annotations['runme.dev/id']) || '',
            outputType: OutputType.annotations,
          })
        }}"
      ></close-cell-button>
      ${when(
        errorCount,
        () =>
          html` <p class="error-item">
            This configuration block contains errors, using the default values instead
          </p>`,
        () => html``,
      )}
    </section>`
  }
}
