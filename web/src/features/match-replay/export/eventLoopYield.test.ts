// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * eventLoopYield.test.ts — the primitive does yield, and through the unthrottled channel.
 *
 * WHAT CANNOT BE TESTED HERE: the throttling itself. It only exists in a hidden tab of a real
 * browser — jsdom has no notion of tab visibility. The measurement justifying this module is
 * recorded in its header (673 ms versus 0.06 ms); this test locks in what is verifiable: the
 * promise resolves, and it goes through `MessageChannel` when available.
 */
import { describe, expect, it, vi } from 'vitest'

import { yieldToEvents } from './eventLoopYield'

describe('yieldToEvents', () => {
  it('yields control, then resumes', async () => {
    let resumed = false
    const wait = yieldToEvents().then(() => {
      resumed = true
    })
    // The resumption is ASYNCHRONOUS: it has not happened by the time the call returns.
    expect(resumed).toBe(false)
    await wait
    expect(resumed).toBe(true)
  })

  it('goes through MessageChannel, not a timer', async () => {
    const timer = vi.spyOn(globalThis, 'setTimeout')
    await yieldToEvents()
    // THE POINT OF THIS TEST: a `setTimeout` here would be throttled to one second in a
    // hidden tab, which is exactly the bug this module fixes.
    expect(timer).not.toHaveBeenCalled()
    timer.mockRestore()
  })

  it('falls back to a timer where MessageChannel does not exist', async () => {
    const real = globalThis.MessageChannel
    // @ts-expect-error — simulating an environment without the primitive.
    delete globalThis.MessageChannel
    try {
      await expect(yieldToEvents()).resolves.toBeUndefined()
    } finally {
      globalThis.MessageChannel = real
    }
  })
})
