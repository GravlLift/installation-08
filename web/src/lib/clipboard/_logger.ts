// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * _logger.ts — namespaced logger for the clipboard module.
 *
 * Same pattern as `lib/accessibility/_logger.ts`: each key is logged
 * only once per session (a refused clipboard write happens on every click, and we do not
 * want to flood the console).
 *
 * Stable keys:
 *   - `clipboard:write_failed` — `navigator.clipboard.writeText` rejected
 *     (insecure context, permission denied, API absent).
 */

const PREFIX = '[clipboard]'

const _warned = new Set<string>()
const _errored = new Set<string>()

export const log = {
  info(msg: string, ...args: unknown[]): void {
    console.info(`${PREFIX} ${msg}`, ...args)
  },

  warn(key: string, msg: string, ...args: unknown[]): void {
    if (_warned.has(key)) return
    _warned.add(key)
    console.warn(`${PREFIX} ${msg}`, ...args)
  },

  error(key: string, msg: string, ...args: unknown[]): void {
    if (_errored.has(key)) return
    _errored.add(key)
    console.error(`${PREFIX} ${msg}`, ...args)
  },

  debug(msg: string, ...args: unknown[]): void {
    if (!import.meta.env.DEV) return
    console.debug(`${PREFIX} ${msg}`, ...args)
  },

  /** Resets deduplication (test use only). */
  _resetForTests(): void {
    _warned.clear()
    _errored.clear()
  },
}
