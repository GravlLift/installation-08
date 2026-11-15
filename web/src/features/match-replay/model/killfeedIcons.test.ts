/**
 * killfeedIcons.test.ts — the kill feed icon URLs the server serves since every kill gets
 * the game's kill feed atlas sprite (`/static/weapons-assets/halo_infinite/jeu/killfeed-NN.png`).
 *
 * Pinned here: a kill feed sprite is drawn as served (it already points toward the victim,
 * so it is never mirrored), the contour atlas still swaps to the mirrored silhouette, and
 * the sound and death-fall tables read the `killfeed-NN` stem out of the served URL shape.
 */
import { describe, expect, it } from 'vitest'
import { weaponFullIcon } from './weaponFullIcon'
import { killSound, killSourceSpriteStem, WEAPON_SOUND_STEMS } from '../sound/replaySound'
import { fallKindOf } from '../scene3d/fall3d'

const served = (stem: string) => `/static/weapons-assets/halo_infinite/jeu/${stem}.png`

describe('kill feed sprite URLs', () => {
  it('draws a kill feed sprite as served, unmirrored', () => {
    expect(weaponFullIcon(served('killfeed-65'))).toEqual({ url: served('killfeed-65'), mirrored: false })
    expect(weaponFullIcon(served('killfeed-00'))).toEqual({ url: served('killfeed-00'), mirrored: false })
  })

  it('still swaps a contour icon for its mirrored silhouette', () => {
    expect(weaponFullIcon(served('contour-00'))).toEqual({ url: served('silhouette-00'), mirrored: true })
  })

  it('reads the stem out of the served URL', () => {
    expect(killSourceSpriteStem(served('killfeed-46'))).toBe('killfeed-46')
  })

  it('sounds melee and grenades by sprite, registry weapons by key', () => {
    expect(killSound({ weaponKey: '', weaponImageUrl: served('killfeed-65') })).toEqual({ stem: 'melee_kill', category: 'melee' })
    expect(killSound({ weaponKey: 'hinf_frag_grenade', weaponImageUrl: served('killfeed-46') })).toEqual({ stem: 'explosion_frag', category: 'grenade' })
    expect(killSound({ weaponKey: 'hinf_br75', weaponImageUrl: served('killfeed-00') })).toEqual({ stem: WEAPON_SOUND_STEMS.hinf_br75, category: 'weapon' })
  })

  it('picks the death fall from the served sprite', () => {
    expect(fallKindOf({ weaponImageUrl: served('killfeed-65'), headshot: false }, 'plain')).toBe('melee')
    expect(fallKindOf({ weaponImageUrl: served('killfeed-46'), headshot: false }, 'plain')).toBe('blast')
    expect(fallKindOf({ weaponImageUrl: served('killfeed-60'), headshot: false }, 'plain')).toBe('splatter')
    expect(fallKindOf({ weaponImageUrl: served('killfeed-00'), headshot: true }, 'plain')).toBe('headshot')
  })
})
