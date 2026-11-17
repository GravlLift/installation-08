// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it, vi } from 'vitest'
import { etiquetteDe, magsPourArme, specLunette } from './scopeLogic'
import { testReplayDoc } from '../test/testDoc'

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

// etiquetteDe resolves the label key of the model key in the document's weaponLabels: the
// cooked artifacts write the keys `0x%08X` (uppercase, prefixed), the model key is lowercase
// without the prefix — the match must cross the two writings, or the label table is dead.
describe('etiquetteDe', () => {
  const doc = testReplayDoc({
    weaponLabels: {
      '0xDAF193C7': { en: 'Stalker Rifle', fr: 'Fusil traqueur', key: 'hinf_stalker_rifle' },
      '0xDAF193C742C9679F': { en: 'Stalker Rifle', fr: 'Fusil traqueur', key: 'hinf_stalker_rifle' },
      '0x0D20C469': { en: 'Skewer', fr: 'Empaleur', key: 'hinf_skewer' },
    },
  })

  it('finds the label key through the uppercase prefixed key of the artifacts', () => {
    expect(etiquetteDe(doc, 'daf193c7')).toBe('hinf_stalker_rifle')
    expect(etiquetteDe(doc, '0d20c469')).toBe('hinf_skewer')
  })

  it('returns null for a family the document does not name', () => {
    expect(etiquetteDe(doc, '6b049244')).toBeNull()
  })

  it('returns null for a document without a weaponLabels table', () => {
    expect(etiquetteDe(testReplayDoc(), 'daf193c7')).toBeNull()
  })
})

// specLunette: the Stalker Rifle's model key is not in the model table, so its scope must
// come through the label table — the default scope keeps the first-person gun on screen.
describe('specLunette', () => {
  const doc = testReplayDoc({
    weaponLabels: { '0xDAF193C7': { en: 'Stalker Rifle', fr: 'Fusil traqueur', key: 'hinf_stalker_rifle' } },
  })

  it('gives the Stalker Rifle a scope through the label table', () => {
    expect(specLunette('daf193c7', etiquetteDe(doc, 'daf193c7'))).toEqual({ kind: 'scope' })
  })

  it('prefers the model table when the model key is listed', () => {
    // The S7 is listed in both tables; a foreign label key must not shadow the model entry.
    expect(specLunette('0a1992bc', 'hinf_skewer')).toEqual({ kind: 'scope' })
  })

  it('gives the Skewer a scope so the first-person gun is hidden while zoomed', () => {
    // The Skewer's model key is not in the model table, so it resolves through the label table.
    // It is a `scope` (not a `smartLink`): in game the zoomed Skewer is fully out of focus at
    // center (the overlay's red haze stands for it), so the sharp hip weapon must leave the screen.
    expect(specLunette('0d20c469', 'hinf_skewer')).toEqual({ kind: 'scope' })
  })

  it('falls back to the default scope for a weapon no table lists', () => {
    expect(specLunette('6b049244', null)).toEqual({ kind: 'smartLink' })
  })
})
