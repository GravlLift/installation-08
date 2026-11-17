// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * indexField3d.ts — ONE FIELD OF THE WEAPON LIBRARY INDEX (`GET /api/weapons`), read on first use.
 *
 * The index is read once per field. While it cannot be read (library not built yet, or built
 * before the field existed and being rebuilt) the field answers null and the read is retried after
 * `RETRY_MS`. The red-reticle ranges (`reticleRanges3d`) and the team banners (`flagBanner3d`)
 * are fields of it.
 */
import { api } from '@/lib/api/client'
import { isNotFound } from '@/lib/replay/queries'

/** Delay before reading the index again after a failed read (ms). */
const RETRY_MS = 15_000

export type FetchJson = (url: string, signal: AbortSignal) => Promise<unknown>

export const defaultFetchJson: FetchJson = (url, signal) => api.get<unknown>(url, undefined, { signal })

/** IndexField — the field `parse` reads out of the index served at `indexUrl` (null: absent). */
export class IndexField<T> {
  private value: T | null = null
  private loading = false
  private retryAt = 0
  private readonly abort = new AbortController()
  private readonly indexUrl: string
  private readonly parse: (doc: unknown) => T | null
  private readonly fetchJson: FetchJson

  constructor(indexUrl: string, parse: (doc: unknown) => T | null, fetchJson: FetchJson = defaultFetchJson) {
    this.indexUrl = indexUrl
    this.parse = parse
    this.fetchJson = fetchJson
  }

  /** get is the field once read, null before (the first call starts the read). */
  get(): T | null {
    if (!this.value) this.load()
    return this.value
  }

  dispose(): void {
    this.abort.abort()
  }

  private load(): void {
    if (this.loading || performance.now() < this.retryAt) return
    this.loading = true
    this.fetchJson(this.indexUrl, this.abort.signal).then(
      (doc) => {
        this.value = this.parse(doc)
        if (!this.value) this.retryAt = performance.now() + RETRY_MS
      },
      (err: unknown) => {
        if (this.abort.signal.aborted) return
        if (!isNotFound(err)) console.warn('replay 3D: weapon index unreadable', this.indexUrl, err)
        this.retryAt = performance.now() + RETRY_MS
      },
    ).finally(() => { this.loading = false })
  }
}
