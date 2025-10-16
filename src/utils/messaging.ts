/**
 * @deprecated This file is deprecated and will be removed in a future release.
 */

import { Disposable } from 'vscode'

import { ClientMessages } from '../constants'
import { ClientMessage, ClientMessagePayload } from '../types'

interface Messaging {
  postMessage(msg: unknown): Thenable<boolean> | Thenable<void> | void

  onDidReceiveMessage(cb: (message: any) => void): Disposable
}

export async function postClientMessage<T extends ClientMessages>(
  messaging: Partial<Messaging>,
  type: T,
  payload: ClientMessagePayload[T],
) {
  const msg = {
    type,
    output: payload,
  } as ClientMessage<T>

  return await messaging.postMessage?.(msg)
}

export function onClientMessage(
  messaging: Partial<Messaging>,
  cb: (message: ClientMessage<ClientMessages>) => void,
): Disposable {
  return messaging.onDidReceiveMessage?.(cb) ?? { dispose: () => {} }
}
