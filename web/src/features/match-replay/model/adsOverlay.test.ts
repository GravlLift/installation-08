import { describe, expect, it } from 'vitest'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import { ADS_MINIMAL, ADS_OVERLAYS, adsAmmoText, adsLevelIndex, adsOverlayFor } from './adsOverlay'
import { LUNETTE_PAR_DEFAUT, specLunette, zoomAt } from './scopeLogic'

const SCOPE = { kind: 'scope' } as const

// adsOverlayFor: the captured overlay by weapon label key, then by model key; a scoped weapon
// nobody captured gets the neutral minimal overlay, never another weapon's.
describe('adsOverlayFor', () => {
  it('finds each captured weapon by its label key', () => {
    expect(adsOverlayFor(null, 'hinf_s7_sniper', SCOPE)?.design).toBe('s7')
    expect(adsOverlayFor(null, 'hinf_br75', SCOPE)?.design).toBe('br75')
    expect(adsOverlayFor(null, 'hinf_bandit', { kind: 'bandit' })?.design).toBe('bandit')
    expect(adsOverlayFor(null, 'hinf_vestige_carbine', SCOPE)?.design).toBe('vestige')
  })

  it('gives the six small arms the same smart-link frame', () => {
    for (const key of ['hinf_sidekick', 'hinf_ma40_ar', 'hinf_cqs48_bulldog', 'hinf_disruptor', 'hinf_mangler', 'hinf_plasma_pistol']) {
      expect(adsOverlayFor(null, key, LUNETTE_PAR_DEFAUT)?.design).toBe('smartLink')
    }
  })

  it('falls back on the model key when the label is missing', () => {
    expect(adsOverlayFor('0A1992BC', null, SCOPE)).toBe(ADS_OVERLAYS.hinf_s7_sniper)
    expect(adsOverlayFor('2fb21c87', undefined, { kind: 'bandit' })).toBe(ADS_OVERLAYS.hinf_bandit)
  })

  it('gives an uncaptured scoped weapon the minimal overlay', () => {
    expect(adsOverlayFor('deadbeef', 'hinf_unknown_scope', SCOPE)).toBe(ADS_MINIMAL)
    expect(ADS_MINIMAL.ownReticle).toBe(true)
    expect(ADS_MINIMAL.fidelity).toBe('fallback')
  })

  it('draws nothing for an uncaptured smart-link weapon: it keeps its hip reticle', () => {
    expect(adsOverlayFor('6b049244', 'hinf_needler', LUNETTE_PAR_DEFAUT)).toBeNull()
  })

  it('every captured overlay names at least one level', () => {
    for (const spec of Object.values(ADS_OVERLAYS)) expect(spec.levels.length).toBeGreaterThan(0)
  })
})

// adsLevelIndex: the film's zoom level picks the face of a two-level scope.
describe('adsLevelIndex', () => {
  const s7 = ADS_OVERLAYS.hinf_s7_sniper
  const br = ADS_OVERLAYS.hinf_br75

  it('draws the level the film gives', () => {
    expect(adsLevelIndex(s7, 1)).toBe(0)
    expect(adsLevelIndex(s7, 2)).toBe(1)
    expect(s7.levels[adsLevelIndex(s7, 2)].label).toBe('10x')
  })

  it('draws the last level past the declared ones', () => {
    expect(adsLevelIndex(br, 2)).toBe(0)
  })

  it('draws the first level when the film gives none', () => {
    expect(adsLevelIndex(s7, 0)).toBe(0)
    expect(adsLevelIndex(s7, Number.NaN)).toBe(0)
  })
})

describe('adsAmmoText', () => {
  it('prints two digits like the game', () => {
    expect(adsAmmoText(7)).toBe('07')
    expect(adsAmmoText(36)).toBe('36')
    expect(adsAmmoText(0)).toBe('00')
  })

  it('prints nothing when the magazine is unknown', () => {
    expect(adsAmmoText(undefined)).toBeNull()
    expect(adsAmmoText(null)).toBeNull()
  })
})

// zoomAt.shownLevel: a 10x scope fading out keeps its 10x face, it does not flash level 1.
describe('zoomAt shownLevel', () => {
  const doc = {
    frameIntervalMs: 20,
    tracks: [
      {
        slot: 1,
        team: -1,
        xuid: 'A',
        startFrame: 0,
        endFrame: 1000,
        points: [
          { t: 0, x: 0, y: 0, h: 0, s: 2 },
          { t: 20, x: 0, y: 0, h: 0, s: 0 },
        ],
      },
    ],
  } as ReplayDocumentReady
  const spec = specLunette('0a1992bc', null)

  it('is the level while zoomed', () => {
    const z = zoomAt(doc, 'A', 10, spec, [5, 10])
    expect(z.level).toBe(2)
    expect(z.shownLevel).toBe(2)
  })

  it('is the level left while the zoom fades out', () => {
    const z = zoomAt(doc, 'A', 21, spec, [5, 10])
    expect(z.level).toBe(0)
    expect(z.amount).toBeGreaterThan(0)
    expect(z.shownLevel).toBe(2)
  })

  it('is 0 once the fade is over', () => {
    const z = zoomAt(doc, 'A', 200, spec, [5, 10])
    expect(z.amount).toBe(0)
    expect(z.shownLevel).toBe(0)
  })
})
