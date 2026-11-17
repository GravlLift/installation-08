// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * clientLog.ts — the page's errors go to the server's log (`POST /api/client-log`, written to
 * server.log as "viewer error"). A tester never opens the window's devtools, so without this a
 * failure in the page left server.log clean: test.18/test.19 hung every match on "Decoding
 * materials" with nothing to show for it.
 *
 * `reportClientError` sends one entry (deduplicated, at most `MAX_REPORTS` a page load);
 * `installClientErrorReporting` adds the window's uncaught-error and unhandled-rejection
 * listeners once. Sending never throws and never reports its own failure.
 */
import { resolve } from './api/client'

const MAX_REPORTS = 30
const MAX_FIELD = 2000

const sent = new Set<string>()
let count = 0
let installed = false

function clip(s: string): string {
  return s.length > MAX_FIELD ? `${s.slice(0, MAX_FIELD)}…` : s
}

/** describeError turns anything thrown into a message and a detail (the stack when there is one). */
export function describeError(err: unknown): { message: string; detail: string } {
  if (err instanceof Error) return { message: `${err.name}: ${err.message}`, detail: err.stack ?? '' }
  if (typeof err === 'string') return { message: err, detail: '' }
  try {
    return { message: JSON.stringify(err) ?? String(err), detail: '' }
  } catch {
    return { message: String(err), detail: '' }
  }
}

/** reportClientError logs one page error on the server. `kind` names where it came from. */
export function reportClientError(kind: string, err: unknown, extra?: string): void {
  const { message, detail } = describeError(err)
  const key = `${kind}|${message}`
  if (sent.has(key) || count >= MAX_REPORTS) return
  sent.add(key)
  count++
  const body = JSON.stringify({
    kind: clip(kind),
    message: clip(message),
    detail: clip([extra, detail].filter(Boolean).join('\n')),
    page: clip(typeof location !== 'undefined' ? location.hash : ''),
  })
  try {
    void fetch(resolve('/api/client-log'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // No fetch, or it threw synchronously: nothing else to do.
  }
}

/** installClientErrorReporting reports the window's uncaught errors and unhandled rejections. */
export function installClientErrorReporting(target: Window = window): void {
  if (installed) return
  installed = true
  target.addEventListener('error', (event) => {
    const where = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : ''
    reportClientError('uncaught', event.error ?? event.message, where)
  })
  target.addEventListener('unhandledrejection', (event) => {
    reportClientError('unhandled-rejection', event.reason)
  })
}

/** Test seam: forget what was sent and whether the listeners are installed. */
export function resetClientLogForTests(): void {
  sent.clear()
  count = 0
  installed = false
}
