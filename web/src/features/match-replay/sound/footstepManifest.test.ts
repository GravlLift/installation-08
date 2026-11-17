// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * footstepManifest.test.ts — the shape of the extracted foot sounds, and their absence.
 *
 * A well-formed manifest reads its surfaces, actions and movement sounds; a missing one (a 404)
 * and a malformed one read as "nothing was extracted" — the footsteps stay silent, without an
 * error.
 */
import { describe, expect, it, vi } from 'vitest'

import { FOOTSTEP_MANIFEST_URL, footStems, loadFootstepManifest, movementStems, parseFootstepManifest } from './footstepManifest'

const GOOD = {
  version: 1,
  feet: { default: { walk: { takes: [{ file: 'foot_00000001.ogg', media: 1, durationMs: 180 }, { file: 'foot_00000002.ogg', media: 2, durationMs: 175 }] } } },
  movement: { jumpup: { takes: [{ file: 'foot_000000ff.ogg', media: 255, durationMs: 200 }] } },
}

describe('parseFootstepManifest', () => {
  it('reads a well-formed manifest', () => {
    const m = parseFootstepManifest(GOOD)
    expect(m).not.toBeNull()
    expect(footStems(m!, 'default', 'walk')).toEqual(['foot_00000001', 'foot_00000002'])
    expect(movementStems(m!, 'jumpup')).toEqual(['foot_000000ff'])
  })

  it('reads as nothing when a surface action has no takes', () => {
    const m = parseFootstepManifest({ version: 1, feet: { default: { walk: { takes: [] } } }, movement: {} })
    expect(footStems(m!, 'default', 'walk')).toBeNull()
  })

  it('reads as nothing when a surface is missing', () => {
    const m = parseFootstepManifest(GOOD)
    expect(footStems(m!, 'dirt', 'walk')).toBeNull()
  })

  it.each([
    'not an object',
    'no version',
    'an old version',
    'no feet',
    'no movement',
    'a bad take',
  ])('reads as nothing on: %s', (caseName) => {
    const bad = (() => {
      switch (caseName) {
        case 'not an object':
          return 'x'
        case 'no version':
          return { feet: {}, movement: {} }
        case 'an old version':
          return { version: 0, feet: {}, movement: {} }
        case 'no feet':
          return { version: 1, movement: {} }
        case 'no movement':
          return { version: 1, feet: {} }
        case 'a bad take':
          return { version: 1, feet: { default: { walk: { takes: [{ file: 'foot_x.ogg', media: 1 }] } } }, movement: {} }
      }
    })()
    expect(parseFootstepManifest(bad)).toBeNull()
  })
})

describe('loadFootstepManifest', () => {
  it('reads the manifest from the sound route', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => GOOD })) as unknown as typeof fetch
    const m = await loadFootstepManifest(fetchMock)
    expect(fetchMock).toHaveBeenCalledWith(FOOTSTEP_MANIFEST_URL)
    expect(m).not.toBeNull()
  })

  it('a 404 (nothing extracted) reads as nothing, without an error', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch
    expect(await loadFootstepManifest(fetchMock)).toBeNull()
  })
})
