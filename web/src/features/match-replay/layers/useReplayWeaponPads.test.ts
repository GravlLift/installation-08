// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useReplayWeaponPads.test.ts — THE NAME RESOLUTION OF A PEDESTAL (`padNameFor`), and the
 * readable writing of an identifier no table names (`displayKeyOf`).
 *
 * Since the equipment replays (2026-11) the film mounts the carried equipment on
 * pedestals, publishing its FAMILY (`repulsor`, `wall`, ...), and a pad whose key no
 * table names must never show its raw key: a weapon keeps its hexadecimal (the only true
 * thing one can write), a family key takes its readable writing.
 */
import { describe, expect, it } from 'vitest'

import { REPLAY_TEXT } from '../i18n/i18n'
import { displayKeyOf, padEquipmentFamilyOf } from '../model/weaponPadFamilies'
import { isWeaponHexIdentifier, padIconRefFor, padNameFor, weaponLabelKeyOf } from './useReplayWeaponPads'

/** A document whose catalog names nothing: the fallbacks are then the only answer. */
const NO_LABELS: undefined = undefined

describe('padEquipmentFamilyOf', () => {
  it('names the equipment families the film mounts on pedestals', () => {
    for (const key of [
      'repulsor',
      'translocator_beacon',
      'wall',
      'grapple',
      'sensor',
      'thruster',
      'shroud_screen',
      'powerup_camo',
      'powerup_overshield',
    ]) {
      expect(padEquipmentFamilyOf(key)).toBe(key)
    }
  })

  it('rejects a key that is not a family (a weapon, an unknown key)', () => {
    expect(padEquipmentFamilyOf('0xF408190F')).toBeNull()
    expect(padEquipmentFamilyOf('some_future_key')).toBeNull()
    expect(padEquipmentFamilyOf('')).toBeNull()
  })
})

describe('padNameFor', () => {
  it('names every known equipment family in the language of the reader', () => {
    expect(padNameFor('repulsor', NO_LABELS, REPLAY_TEXT.en, 'en')).toBe('Repulsor')
    expect(padNameFor('translocator_beacon', NO_LABELS, REPLAY_TEXT.en, 'en')).toBe('Translocator')
    expect(padNameFor('wall', NO_LABELS, REPLAY_TEXT.en, 'en')).toBe('Drop wall')
    expect(padNameFor('grapple', NO_LABELS, REPLAY_TEXT.en, 'en')).toBe('Grappleshot')
    expect(padNameFor('sensor', NO_LABELS, REPLAY_TEXT.en, 'en')).toBe('Threat sensor')
    expect(padNameFor('thruster', NO_LABELS, REPLAY_TEXT.en, 'en')).toBe('Thruster')
    expect(padNameFor('shroud_screen', NO_LABELS, REPLAY_TEXT.en, 'en')).toBe('Shroud screen')
    expect(padNameFor('powerup_camo', NO_LABELS, REPLAY_TEXT.en, 'en')).toBe('Active camouflage')
    expect(padNameFor('powerup_overshield', NO_LABELS, REPLAY_TEXT.en, 'en')).toBe('Overshield')
  })

  it('prefers the catalog name of the document over any fallback', () => {
    const labels = {
      [weaponLabelKeyOf('f408190f')]: { en: 'CQS48 Bulldog', fr: 'CQS48 Bulldog' },
    } as const
    expect(padNameFor('0xF408190F', labels, REPLAY_TEXT.en, 'en')).toBe('CQS48 Bulldog')
  })

  it('keeps an unnamed weapon as its exact hexadecimal (the only true thing one can write)', () => {
    expect(padNameFor('0xD7915565', NO_LABELS, REPLAY_TEXT.en, 'en')).toBe('0xD7915565')
  })

  it('shows the readable writing of an unknown non-hex key, never the raw key', () => {
    expect(padNameFor('some_future_key', NO_LABELS, REPLAY_TEXT.en, 'en')).toBe('Some Future Key')
  })
})

it('uses the Shroud Screen HUD icon for its pad', () => {
  expect(padIconRefFor('shroud_screen', NO_LABELS, 'halo_infinite')?.url).toContain('/hud/ShroudScreen.png')
})

describe('displayKeyOf', () => {
  it('title-cases each word and turns underscores into spaces', () => {
    expect(displayKeyOf('translocator_beacon')).toBe('Translocator Beacon')
    expect(displayKeyOf('repulsor')).toBe('Repulsor')
    expect(displayKeyOf('grenade_frag')).toBe('Grenade Frag')
  })

  it('does not invent words where the key has none', () => {
    expect(displayKeyOf('')).toBe('')
    expect(displayKeyOf('_leading')).toBe(' Leading')
    expect(displayKeyOf('trailing_')).toBe('Trailing ')
  })
})

describe('isWeaponHexIdentifier', () => {
  it('accepts the film’s two writings of a weapon identifier, both cases', () => {
    expect(isWeaponHexIdentifier('0xF408190F')).toBe(true)
    expect(isWeaponHexIdentifier('0Xf408190f')).toBe(true)
    expect(isWeaponHexIdentifier('f408190f')).toBe(true)
    expect(isWeaponHexIdentifier('1234')).toBe(true)
  })

  it('rejects everything else (a family key, an empty string)', () => {
    expect(isWeaponHexIdentifier('powerup_camo')).toBe(false)
    expect(isWeaponHexIdentifier('0xF408190FG')).toBe(false)
    expect(isWeaponHexIdentifier('0x123456789')).toBe(false)
    expect(isWeaponHexIdentifier('')).toBe(false)
  })
})
