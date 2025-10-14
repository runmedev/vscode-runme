import { getContext } from '@runmedev/renderers'

import { postClientMessage } from '../utils/messaging'
import { ClientMessages, OutputType } from '../constants'

export function closeOutput({ id, outputType }: { id: string; outputType: OutputType }) {
  const ctx = getContext()
  ctx.postMessage &&
    postClientMessage(ctx, ClientMessages.closeCellOutput, {
      id,
      outputType,
    })
}

export function formatDate(date: Date) {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

/**
 * Calculates the time difference from the current date and transform the result in a time ago format,
 * it supports: minutes, days, hours.
 * @param date
 * @returns A formatted date,
 * examples:
 *  - now
 *  - 6 days ago
 *  - Yesterday
 *  - 1 hour ago
 *  - 1 Minute ago
 */
export function formatDateWithTimeAgo(date: Date) {
  const now = new Date()
  const diffInMilliseconds = now.getTime() - date.getTime()
  const diffInSeconds = Math.floor(diffInMilliseconds / 1000) * -1

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  if (Math.abs(diffInSeconds) < 60) {
    return rtf.format(Math.round(diffInSeconds), 'second')
  } else if (Math.abs(diffInSeconds) < 3600) {
    return rtf.format(Math.round(diffInSeconds / 60), 'minute')
  } else if (Math.abs(diffInSeconds) < 86400) {
    return rtf.format(Math.round(diffInSeconds / 3600), 'hour')
  } else {
    return rtf.format(Math.round(diffInSeconds / 86400), 'day')
  }
}
