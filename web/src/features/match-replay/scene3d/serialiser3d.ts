// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** One run at a time; concurrent requests share the next one. */
export function serialiser(travail: () => Promise<void>): () => Promise<void> {
  let active: Promise<void> | null = null
  let next: Promise<void> | null = null
  const run = (): Promise<void> => {
    if (active) {
      next ??= active.then(() => { next = null; return run() })
      return next
    }
    const current = (async () => travail())()
    active = current.finally(() => { active = null })
    return active
  }
  return run
}
