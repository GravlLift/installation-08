import { describe, expect, it, vi } from 'vitest'
import { magsPourArme } from './scopeLogic'

// magsPourArme resolves the held weapon's magnifications: the index's mags when they carry a zoom
// above 1, the named hand fallback for the weapons whose tags declare no magnification above 1,
// otherwise null.
describe('magsPourArme', () => {
  it('returns the index mags when they carry a zoom above 1', () => {
    expect(magsPourArme('0a1992bc', [4, 9])).toEqual([4, 9])
    expect(magsPourArme('2b1824d5', [2])).toEqual([2])
  })

  it('falls back to the hand value when the index mags are all 1, for the named keys', () => {
    // Shock Rifle: the tag says [1, 1]; the hand table's two-stage scope is restored.
    expect(magsPourArme('1a22fee6', [1])).toEqual([2.5, 5])
    // Both Bandits: the tag says [1]; the hand table's light zoom is restored.
    expect(magsPourArme('6acdc44d', [1])).toEqual([1.6])
    expect(magsPourArme('2fb21c87', [1])).toEqual([1.6])
    // The fallback also covers the key with no index mags at all (the index still loading).
    expect(magsPourArme('1a22fee6', null)).toEqual([2.5, 5])
  })

  it('lets the index win when the named key does answer a zoom above 1', () => {
    // If the tag ever answers the Shock Rifle above 1, the index value is used, not the fallback.
    expect(magsPourArme('1a22fee6', [3])).toEqual([3])
  })

  it('does not invent a fallback for a key the hand table never named', () => {
    // A weapon the tags answer as [1] but the hand table does not list: no zoom, no warning spam.
    expect(magsPourArme('6b049244', [1])).toEqual([1])
  })

  it('warns once and returns null for a key with no mags and no fallback', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(magsPourArme('6b049244', null)).toBeNull()
    expect(magsPourArme('6b049244', null)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
