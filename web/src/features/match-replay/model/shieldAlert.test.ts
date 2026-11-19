// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import { HEALTH_BAR_W, healthStripBox, healthStripHalf, healthStripShown, SHIELD_BURST_H, SHIELD_BURST_MS, SHIELD_BURST_W, shieldBurstAt, shieldBurstBox, shieldFrameFlash, shieldGlowShown } from './shieldAlert'

describe('shieldAlert', () => {
  it('shows the glow only while the shield is broken', () => {
    expect(shieldGlowShown('broken')).toBe(true)
    for (const s of ['full', 'damaged', 'low', 'recharging']) expect(shieldGlowShown(s)).toBe(false)
  })

  it('loops the frame flash 0 -> 1 -> 0 every 666 ms', () => {
    expect(shieldFrameFlash(0)).toBe(0)
    expect(shieldFrameFlash(333)).toBeCloseTo(1, 2)
    expect(shieldFrameFlash(666)).toBeCloseTo(0, 5)
    expect(shieldFrameFlash(666 + 333)).toBeCloseTo(1, 2)
  })

  it('plays the burst over 766 ms with the dump keyframes', () => {
    expect(shieldBurstAt(-1)).toBeNull()
    expect(shieldBurstAt(SHIELD_BURST_MS)).toBeNull()
    expect(shieldBurstAt(0)).toEqual({ scaleX: 1, scaleY: 1, drop: 0, opacity: 1 })
    expect(shieldBurstAt(433)?.opacity).toBe(1)
    const late = shieldBurstAt(765)!
    expect(late.scaleX).toBeCloseTo(9, 1)
    expect(late.scaleY).toBeCloseTo(5, 1)
    expect(Math.abs(late.drop - 555)).toBeLessThan(1)
    expect(late.opacity).toBeLessThan(0.01)
  })

  it('scales the burst about its own center', () => {
    const box = shieldBurstBox({ scaleX: 2, scaleY: 3, drop: 0, opacity: 1 }, 470, 40)
    expect(box.w).toBe(SHIELD_BURST_W * 2)
    expect(box.h).toBe(SHIELD_BURST_H * 3)
    expect(box.x + box.w / 2).toBe(470)
    expect(box.y + box.h / 2).toBe(40 - 20 + SHIELD_BURST_H / 2)
  })

  it('shows the health strip while the shield is not full, draining toward the center', () => {
    expect(healthStripShown('full', 0.5)).toBe(false)
    expect(healthStripShown('broken', null)).toBe(false)
    expect(healthStripShown('damaged', 1)).toBe(true)
    expect(healthStripHalf(1)).toBe(HEALTH_BAR_W / 2)
    expect(healthStripHalf(0.5)).toBe(HEALTH_BAR_W / 4)
    expect(healthStripHalf(-1)).toBe(0)
    const box = healthStripBox(470, 80)
    expect(box.x + box.w / 2).toBe(470)
    expect(box.y + box.h / 2).toBeCloseTo(0.78 * 80, 6)
  })
})
