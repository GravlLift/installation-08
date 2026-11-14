/**
 * reloadManifest.test.ts — the manifest's shape, the weapon tag of a film id, and the library the
 * track plays from it.
 */
import { describe, expect, it, vi } from 'vitest'

import { RELOAD_LEVEL_TARGET_DB } from './reloadLoudness'
import {
  RELOAD_MANIFEST_URL,
  loadReloadManifest,
  parseReloadManifest,
  reloadLibrary,
  takeFilesOf,
  weaponTagOf,
  type ReloadManifest,
} from './reloadManifest'

const MANIFEST: ReloadManifest = {
  version: 1,
  weapons: {
    '2b1824d5': {
      combat: {
        animation: 'combat:rifle:br:reload_1',
        durationMs: 1933,
        sounds: [
          { atMs: 0, takes: [{ file: 'reload_00000001.ogg', durationMs: 300 }, { file: 'reload_00000002.ogg', durationMs: 310 }] },
          { atMs: 333, takes: [{ file: 'reload_00000003.ogg', durationMs: 200 }] },
        ],
      },
      crouch: {
        animation: 'crouch:rifle:br:reload_1',
        durationMs: 1967,
        sounds: [{ atMs: 0, takes: [{ file: 'reload_00000001.ogg', durationMs: 300 }] }],
      },
    },
    '0a1992bc': { combat: { animation: 'combat:rifle:sr:reload_1', durationMs: 2167, sounds: [{ atMs: 0, takes: [{ file: 'reload_00000009.ogg', durationMs: 300 }] }] } },
  },
}

describe('weaponTagOf', () => {
  it('reads the tag of a film weapon id, 64-bit or tag alone, nothing else', () => {
    expect(weaponTagOf('0x2B1824D542C9679F')).toBe('2b1824d5')
    expect(weaponTagOf('0x2B1824D5')).toBe('2b1824d5')
    expect(weaponTagOf('0x2B1824D542')).toBeNull()
    expect(weaponTagOf('hinf_br75')).toBeNull()
  })
})

describe('parseReloadManifest', () => {
  it('accepts the manifest the build writes, refuses anything else', () => {
    expect(parseReloadManifest(MANIFEST)).toBe(MANIFEST)
    expect(parseReloadManifest({ ...MANIFEST, version: 0 })).toBeNull()
    expect(parseReloadManifest({ version: 1 })).toBeNull()
    expect(parseReloadManifest({ version: 1, weapons: { x: { combat: { sounds: [] } } } })).toBeNull()
    expect(parseReloadManifest('nope')).toBeNull()
  })

  it('a 404 or a failed fetch reads as nothing extracted', async () => {
    const notFound = vi.fn(async () => new Response('', { status: 404 }))
    expect(await loadReloadManifest(notFound as unknown as typeof fetch)).toBeNull()
    expect(notFound).toHaveBeenCalledWith(RELOAD_MANIFEST_URL)
    const ok = vi.fn(async () => new Response(JSON.stringify(MANIFEST)))
    expect(await loadReloadManifest(ok as unknown as typeof fetch)).toEqual(MANIFEST)
    expect(await loadReloadManifest(async () => { throw new Error('offline') })).toBeNull()
  })
})

describe('reloadLibrary', () => {
  it('keeps the match weapons only, each animation with its stems and one gain', () => {
    expect(takeFilesOf(MANIFEST, ['2b1824d5'])).toEqual(['reload_00000001.ogg', 'reload_00000002.ogg', 'reload_00000003.ogg'])
    const levels: Record<string, { rmsDb: number; peakDb: number }> = {
      'reload_00000001.ogg': { rmsDb: -18, peakDb: -3 },
      'reload_00000002.ogg': { rmsDb: -18, peakDb: -3 },
      'reload_00000003.ogg': { rmsDb: -22, peakDb: -6 },
    }
    const lib = reloadLibrary(MANIFEST, ['2b1824d5', 'ffffffff'], (f) => levels[f])
    expect([...lib.keys()]).toEqual(['2b1824d5'])
    const combat = lib.get('2b1824d5')?.combat
    expect(combat?.durationMs).toBe(1933)
    expect(combat?.sounds).toEqual([
      { atMs: 0, stems: ['reload_00000001', 'reload_00000002'] },
      { atMs: 333, stems: ['reload_00000003'] },
    ])
    expect(combat?.gainDb).toBeCloseTo(RELOAD_LEVEL_TARGET_DB + 18)
    expect(lib.get('2b1824d5')?.crouch?.sounds).toHaveLength(1)
  })

  it('a take without a level still plays, and counts for nothing in the gain', () => {
    const lib = reloadLibrary(MANIFEST, ['0a1992bc'], () => null)
    expect(lib.get('0a1992bc')?.combat).toMatchObject({ gainDb: 0, sounds: [{ atMs: 0, stems: ['reload_00000009'] }] })
  })
})
