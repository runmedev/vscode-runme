import type { ActivationFunction, RendererContext } from 'vscode-notebook-renderer'

import { OutputType, RENDERERS } from '../constants'
import type { CellOutput } from '../types'

import { setContext } from './utils'
import './components'

// ----------------------------------------------------------------------------
// This is the entrypoint to the notebook renderer's webview client-side code.
// This contains some boilerplate that calls the `render()` function when new
// output is available. You probably don't need to change this code; put your
// rendering logic inside of the `render()` function.
// ----------------------------------------------------------------------------

export const activate: ActivationFunction = (context: RendererContext<void>) => {
  setContext(context)
  return {
    renderOutputItem(outputItem, element) {
      const payload: CellOutput = outputItem.json()

      switch (payload.type) {
        case OutputType.vercel:
          if (payload.output.error) {
            renderError(payload.output.error)
            break
          }

          const vercelElem = document.createElement(RENDERERS.VercelOutput)
          vercelElem.setAttribute('content', JSON.stringify(payload.output))
          element.appendChild(vercelElem)
          break
        case OutputType.deno:
          if (payload.output?.error) {
            renderError(payload.output.error)
            break
          }

          const deno = payload.output || {}
          const denoElem = document.createElement(RENDERERS.DenoOutput)

          denoElem.setAttribute('state', JSON.stringify(deno))

          element.appendChild(denoElem)
          break
        case OutputType.outputItems:
          const content = decodeURIComponent(escape(window.atob(payload.output.content)))
          /**
           * shell output
           */
          const shellElem = document.createElement(RENDERERS.ShellOutput)
          shellElem.innerHTML = content
          element.appendChild(shellElem)
          /**
           * output items, e.g. copy to clipboard
           */
          const outputItemElem = document.createElement(RENDERERS.ShellOutputItems)
          outputItemElem.setAttribute('uuid', payload.output.uuid)
          outputItemElem.setAttribute('content', content)
          element.appendChild(outputItemElem)
          break
        case OutputType.annotations:
          const annoElem = document.createElement(RENDERERS.EditAnnotations)
          annoElem.setAttribute('annotations', JSON.stringify(payload.output.annotations ?? []))
          annoElem.setAttribute(
            'validationErrors',
            JSON.stringify(payload.output.validationErrors ?? []),
          )
          element.appendChild(annoElem)
          break
        case OutputType.terminal:
          const terminalElement = document.createElement(RENDERERS.TerminalView)
          terminalElement.setAttribute('uuid', payload.output['runme.dev/uuid'])
          terminalElement.setAttribute('fontFamily', payload.output.fontFamily)
          if (typeof payload.output.fontSize === 'number') {
            terminalElement.setAttribute('fontSize', payload.output.fontSize.toString())
          }
          if (payload.output.cursorStyle) {
            terminalElement.setAttribute('cursorStyle', payload.output.cursorStyle)
          }
          if (typeof payload.output.cursorBlink === 'boolean') {
            terminalElement.setAttribute(
              'cursorBlink',
              payload.output.cursorBlink ? 'true' : 'false',
            )
          }
          if (typeof payload.output.cursorWidth === 'number') {
            terminalElement.setAttribute('cursorWidth', payload.output.cursorWidth.toString())
          }
          if (typeof payload.output.smoothScrollDuration === 'number') {
            terminalElement.setAttribute(
              'smoothScrollDuration',
              payload.output.smoothScrollDuration.toString(),
            )
          }
          if (typeof payload.output.scrollback === 'number') {
            terminalElement.setAttribute('scrollback', payload.output.scrollback.toString())
          }
          if (payload.output.enableShareButton) {
            terminalElement.setAttribute(
              'enableShareButton',
              payload.output.enableShareButton.toString(),
            )
          }
          if (payload.output.initialRows !== undefined) {
            terminalElement.setAttribute('initialRows', payload.output.initialRows.toString())
          }

          if (payload.output.content !== undefined) {
            terminalElement.setAttribute('initialContent', payload.output.content)
          }

          if (payload.output.isAutoSaveEnabled) {
            terminalElement.setAttribute(
              'isAutoSaveEnabled',
              payload.output.isAutoSaveEnabled.toString(),
            )
          }

          element.appendChild(terminalElement)
          break
        case OutputType.error:
          renderError(payload.output)
          break
        case OutputType.github:
          const githubElement = document.createElement(RENDERERS.GitHubWorkflowViewer)
          if (payload.output?.content) {
            githubElement.setAttribute('state', JSON.stringify(payload.output))
          }
          element.appendChild(githubElement)
          break
        default:
          element.innerHTML = 'No renderer found!'
      }

      function renderError(message: string) {
        element.innerHTML = `⚠️ ${message}`
      }
    },
    disposeOutputItem(/* outputId */) {
      // Do any teardown here. outputId is the cell output being deleted, or
      // undefined if we're clearing all outputs.
    },
  }
}
