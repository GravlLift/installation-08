// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import { LoadGate } from './loadGate3d'

describe('LoadGate', () => {
  it('waits for chained loads and keeps their result', async () => {
    const gate = new LoadGate()
    let finish!: (value: number) => void
    const first = gate.track(new Promise<number>((resolve) => { finish = resolve }))
    first.then(() => gate.track(new Promise<void>((resolve) => setTimeout(resolve, 10))))
    const idle = gate.idle(1000)
    finish(7)
    expect(await first).toBe(7)
    expect(await idle).toEqual({ timedOut: false })
    expect(gate.pending).toBe(0)
  })
  it('keeps failures, caps the delay, and accepts a cancellation', async () => {
    const gate = new LoadGate()
    await expect(gate.track(Promise.reject(new Error('absent')))).rejects.toThrow('absent')
    gate.track(new Promise(() => {}))
    expect(await gate.idle(5)).toEqual({ timedOut: true })
    const abort = new AbortController()
    abort.abort()
    expect(await gate.idle(1000, abort.signal)).toEqual({ timedOut: false })
  })
  it('counts starts and finishes and removes subscriptions', async () => {
    const gate = new LoadGate()
    const snapshots: number[][] = []
    const unsubscribe = gate.subscribe(() => snapshots.push([gate.started, gate.finished, gate.pending]))
    let finish!: () => void
    const promise = gate.track(new Promise<void>((resolve) => { finish = resolve }))
    finish()
    await promise
    await expect(gate.track(Promise.reject(new Error('absent')))).rejects.toThrow('absent')
    unsubscribe()
    await gate.track(Promise.resolve())
    expect(snapshots).toEqual([[1, 0, 1], [1, 1, 0], [2, 1, 1], [2, 2, 0]])
    expect([gate.started, gate.finished, gate.pending]).toEqual([3, 3, 0])
  })
})
