// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it, vi } from 'vitest'
import { serialize } from './serialiser3d'

describe('serialize', () => {
  it('batches requests made during a run and waits for the last one', async () => {
    const ends: (() => void)[] = []
    const work = vi.fn(() => new Promise<void>((resolve) => ends.push(resolve)))
    const run = serialize(work)
    const first = run()
    const next = run()
    const last = run()
    expect(work).toHaveBeenCalledTimes(1)
    ends.shift()!()
    await first
    await Promise.resolve()
    expect(work).toHaveBeenCalledTimes(2)
    let done = false
    void last.then(() => { done = true })
    await Promise.resolve()
    expect(done).toBe(false)
    ends.shift()!()
    await Promise.all([next, last])
    expect(work).toHaveBeenCalledTimes(2)
  })
})
