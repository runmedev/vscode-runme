import { LitElement, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { Disposable } from 'vscode'
import { getContext } from '@runmedev/renderers'

import { ClientMessages } from '../../../constants'
import { postClientMessage } from '../../../utils/messaging'
import { AWSActionType } from '../../../types'
import { ClusterIcon } from '../icons/cluster'
import { IndexableCluster } from '../../../extension/executors/aws/types'

import styles from './styles/clusterActions.css'

@customElement('eks-cluster-actions')
export class EKSClusterActions extends LitElement implements Disposable {
  protected disposables: Disposable[] = []

  @property({ type: Object })
  cluster!: IndexableCluster

  @property({ type: String })
  cellId!: string

  @property({ type: String })
  region!: string

  /* eslint-disable */
  static styles = styles

  dispose() {
    this.disposables.forEach(({ dispose }) => dispose())
  }

  private executeAction(action: AWSActionType) {
    const ctx = getContext()
    return postClientMessage(ctx, ClientMessages.awsEKSClusterAction, {
      cellId: this.cellId,
      cluster: this.cluster?.name!,
      region: this.region,
      action,
    })
  }

  render() {
    const actions = [
      {
        name: 'Details',
        render: () =>
          html`<vscode-button
            class="control"
            appearance="icon"
            @click="${() => this.executeAction(AWSActionType.EKSClusterDetails)}"
          >
            ${ClusterIcon}
          </vscode-button>`,
      },
    ]
    return html`<div class="actions">
      ${actions.map((action) => {
        return html`${action.render()}`
      })}
    </div>`
  }
}
