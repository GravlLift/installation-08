// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * killFeedIcons.test.ts — pins the cause of the missing weapon icons in the 3D replay
 * kill feed (Brief 132).
 *
 * The chain is: context response -> `collectKillEvents` (_momentum.ts) -> `buildFeedEntries`
 * (killFeedLogic.ts) -> the feed's kills reach `ReplayHudFeed3d`, which renders a `WeaponIcon`
 * only when `weaponImageUrl` is set and tints it with the killer's team color.
 *
 * TWO FAILURES, TWO TESTS:
 *
 * 1. The kill feed keeps the weapon icon fields it is given end to end. The icon is a white
 *    mask (`weapon_image_tinted`); the URL the server resolves must survive the alignment
 *    (`buildFeedEntries` sorts and rebuilds each kill) so the mask is never dropped on the
 *    way to the feed.
 *
 * 2. A kill whose `weapon_key` the icon set does not name (a grenade, an unknown build, a
 *    match whose kill-details were never written) carries an EMPTY `weapon_image_url` and an
 *    EMPTY `weapon_key`: the feed renders no icon and no wrong one. The old failure mode was
 *    the inverse of a silent 404 — a whole match (d01ba030) served with zero icons because
 *    the server stopped at an absent kill-details file. The client side of that is pinned
 *    here: an empty URL is a fallback, not a broken image.
 */
import { describe, expect, it } from 'vitest'
import { collectKillEvents } from './_momentum'
import { buildFeedEntries, killsOfFeed } from '../match-replay/model/killFeedLogic'
import type { MatchHighlightEvent } from '@/lib/api/types'

const SCOREBOARD = new Map<string, { ally: boolean }>([
  ['1', { ally: true }],
  ['2', { ally: false }],
])

function killEvent(tMs: number, xuid: string, partial: Partial<Omit<MatchHighlightEvent, 'target_xuid' | 'weapon_id'>>): MatchHighlightEvent {
  return {
    event_type: 'kill',
    event_time_ms: tMs,
    actor_xuid: xuid,
    target_xuid: null,
    weapon_id: null,
    ...partial,
  }
}

describe('kill feed weapon icons', () => {
  it('keeps the resolved weapon icon through the feed alignment', () => {
    const events: MatchHighlightEvent[] = [
      killEvent(30_000, '1', {
        actor_team_id: 1,
        weapon_key: 'hinf_br75',
        weapon_label: 'BR75',
        weapon_image_url: '/static/weapons-assets/halo_infinite/jeu/contour-33.png',
        weapon_image_tinted: true,
        victim_xuid: '2',
      }),
    ]
    const kills = collectKillEvents(events, SCOREBOARD)
    expect(kills).toHaveLength(1)
    const kill = kills[0]
    // The four icon fields travel together (KillEvent contract): a resolved icon is
    // present on every field at once.
    expect(kill.weaponKey).toBe('hinf_br75')
    expect(kill.weaponLabel).toBe('BR75')
    expect(kill.weaponImageUrl).toBe('/static/weapons-assets/halo_infinite/jeu/contour-33.png')
    expect(kill.weaponTinted).toBe(true)

    // buildFeedEntries without a document is the reduced path (raw +t0Ms); with t0 0 the
    // alignment is a no-op but still REBUILDS each kill. The icon must survive that.
    const feed = buildFeedEntries(kills, [], 0, null)
    const feedKills = killsOfFeed(feed)
    expect(feedKills).toHaveLength(1)
    expect(feedKills[0].weaponImageUrl).toBe('/static/weapons-assets/halo_infinite/jeu/contour-33.png')
    expect(feedKills[0].weaponTinted).toBe(true)
    expect(feedKills[0].weaponKey).toBe('hinf_br75')
  })

  it('renders no icon for a kill whose weapon the icon set does not name', () => {
    const events: MatchHighlightEvent[] = [
      // A grenade: a weapon_key with no contour entry (the game icon set has no contour
      // atlas slot for the grenades — they are not `weap` tags).
      killEvent(30_000, '1', { weapon_key: 'hinf_frag_grenade', victim_xuid: '2' }),
      // A source the kill-details never resolved at all (d01ba030: the whole match):
      // no weapon_key, no label, no icon.
      killEvent(31_000, '1', { victim_xuid: '2' }),
    ]
    const kills = collectKillEvents(events, SCOREBOARD)
    const [grenade, unknown] = kills
    // The fields are empty TOGETHER: never a label without an icon, never an icon for a
    // source that is not identified without ambiguity.
    for (const k of [grenade, unknown]) {
      expect(k.weaponImageUrl, 'empty URL is the documented fallback, not a broken one').toBe('')
      expect(k.weaponTinted).toBe(false)
    }
    expect(grenade.weaponKey).toBe('hinf_frag_grenade')
    expect(unknown.weaponKey).toBe('')
  })
})
