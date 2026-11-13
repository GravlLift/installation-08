/**
 * _logger.ts — standalone stand-in for LevelUp's accessibility module logger.
 *
 * Same shape as the real one (`log.info/warn/error/debug`, warn/error deduplicated by
 * key) so `layers/canvasInk.ts` and `layers/fxInk.ts` need no edits.
 */

const PREFIX = '[accessibility]'

const warned = new Set<string>()
const errored = new Set<string>()

export const log = {
  info(msg: string, ...args: unknown[]): void {
    console.info(`${PREFIX} ${msg}`, ...args)
  },

  warn(key: string, msg: string, ...args: unknown[]): void {
    if (warned.has(key)) return
    warned.add(key)
    console.warn(`${PREFIX} ${msg}`, ...args)
  },

  error(key: string, msg: string, ...args: unknown[]): void {
    if (errored.has(key)) return
    errored.add(key)
    console.error(`${PREFIX} ${msg}`, ...args)
  },

  debug(msg: string, ...args: unknown[]): void {
    if (!import.meta.env.DEV) return
    console.debug(`${PREFIX} ${msg}`, ...args)
  },
}
