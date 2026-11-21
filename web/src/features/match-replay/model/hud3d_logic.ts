// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { buildPlayers, playerStateAt, vitalityPresence } from '@/lib/replay/rosterLogic'
import { buildFilmAllegiance } from '@/lib/replay/filmAllegiance'
import { scoreTimelineOf } from '@/lib/replay/scoreTimeline'
import { readScoreBanner, type ScoreBannerReading } from './scoreBannerLogic'
import { frameToMs } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady, ReplayTrackReady } from '@/lib/replay/replayNormalize'
import { damageArcsAt } from './damageArcs'
import { shieldHudAt, shieldHudTrackOf, type ShieldHudTrack } from './shieldHud'
import { REPLAY_TEXT, type ReplayLocale } from '../i18n/i18n'
import { catalogText, type CatalogLabel } from '../i18n/catalogLabel'
import type { ReplayKill } from './killFeedLogic'
import { changesInto, handChangeAt, weaponAway, weaponInHand } from './weaponInHand'
import { equipmentSlotAt } from './equipmentSlotHud'
import { grenadeBoxAt, inventoryAt, selectedGrenadeFrom, type GrenadeBox } from './inventoryReading'
import { weaponClassOfKey } from '../scene3d/weaponClass3d'
import { spawnAmmoAt, spawnAmmoIndex } from './spawnAmmo'
import { pickupAmmoAt, pickupAmmoIndex } from './pickupAmmo'

export function reticleShape(key: string | undefined): 'circle' | 'precision' | 'pistol' | 'dot' | 'large' | 'default' {
  if (!key) return 'default'
  if (['hinf_br75', 'hinf_vk78_commando', 'hinf_bandit', 'hinf_bandit_evo', 'hinf_shock_rifle'].includes(key)) return 'precision'
  if (['hinf_s7_sniper'].includes(key)) return 'dot'
  if (['hinf_cqs48_bulldog', 'hinf_heatwave', 'hinf_cindershot'].includes(key) || weaponClassOfKey(key) === 'missile') return 'large'
  if (weaponClassOfKey(key) === 'pistol') return 'pistol'
  return weaponClassOfKey(key) === 'rifle' ? 'circle' : 'default'
}

export function impactMark(ageMs: number, durationMs: number): number {
  return ageMs >= 0 && ageMs < durationMs ? 1 - ageMs / durationMs : 0
}

/** The first-person HUD clock: when the match's time limit is known, it
 * counts down from it and is bounded at zero; unknown limit (`null`) = the elapsed time,
 * like the timeline. */
export function hudClock(limitMs: number | null, elapsedMs: number): number {
  return limitMs == null ? elapsedMs : Math.max(0, limitMs - elapsedMs)
}

export function prepareHud(doc: ReplayDocumentReady, xuid: string, kills: readonly ReplayKill[]) {
  const impacts = new Map<number, number[]>()
  for (const damage of doc.damages) {
    if (damage.by === undefined) continue
    const times = impacts.get(damage.by) ?? []
    times.push(frameToMs(damage.t, doc))
    impacts.set(damage.by, times)
  }
  for (const times of impacts.values()) times.sort((a, b) => a - b)
  const eliminations = kills.filter((k) => k.xuid === xuid).map((k) => k.replayMs).sort((a, b) => a - b)
  const players = buildPlayers(doc, [])
  const allegiance = buildFilmAllegiance(players, xuid)
  const feed = [...kills].sort((a, b) => a.replayMs - b.replayMs)
  const spawnAmmo = spawnAmmoIndex(doc)
  return { doc, xuid, allegiance, feed, score: scoreTimelineOf(doc), player: players.find((p) => p.xuid === xuid), presence: vitalityPresence(doc), impacts, eliminations, ammo: trackAmmo(doc), spawnAmmo, pickupAmmo: pickupAmmoIndex(doc, spawnAmmo), shields: new Map<ReplayTrackReady, ShieldHudTrack>() }
}

/** The shield bar of a life (`shieldHud`), built on its first read and kept for the source's life. */
function shieldBar(source: ReturnType<typeof prepareHud>, life: ReplayTrackReady): ShieldHudTrack {
  let track = source.shields.get(life)
  if (!track) source.shields.set(life, (track = shieldHudTrackOf(life.points, frameToMs(1, source.doc), life.points[0]?.t)))
  return track
}

/** The ammo of a weapon slot of a life across the film: each read carries forward what it does not say. */
export interface AmmoTracking {
  ms: number[]
  /** Each read's frame. */
  t: number[]
  mag: (number | undefined)[]
  res: (number | undefined)[]
  /** What each read says itself, before carrying forward. */
  readMag: (number | undefined)[]
  readRes: (number | undefined)[]
}

const ammoKey = (slot: number, w: number) => slot * 8 + w

/** trackAmmo buckets `doc.ammoReads` (already sorted by instant) by life and weapon slot. */
export function trackAmmo(doc: ReplayDocumentReady): Map<number, AmmoTracking> {
  const tracked = new Map<number, AmmoTracking>()
  for (const read of doc.ammoReads) {
    const key = ammoKey(read.slot, read.w)
    let tracking = tracked.get(key)
    if (!tracking) tracked.set(key, (tracking = { ms: [], t: [], mag: [], res: [], readMag: [], readRes: [] }))
    const last = tracking.ms.length - 1
    tracking.ms.push(read.ms)
    tracking.t.push(read.t)
    tracking.mag.push(read.mag ?? tracking.mag[last])
    tracking.res.push(read.res ?? tracking.res[last])
    tracking.readMag.push(read.mag)
    tracking.readRes.push(read.res)
  }
  return tracked
}

/**
 * ammoAt: the last read of the slot at instant `ms`, null before the first. With `sinceFrame`, only
 * the reads dated at or after that frame count, and a field none of them says stays out: the reads
 * before it describe another weapon (`changesInto`).
 */
export function ammoAt(tracking: AmmoTracking | undefined, ms: number, sinceFrame = -Infinity): { mag?: number; res?: number } | null {
  if (!tracking) return null
  let start = 0
  let end = tracking.ms.length
  while (start < end) {
    const mid = (start + end) >> 1
    if (tracking.ms[mid] <= ms) start = mid + 1
    else end = mid
  }
  if (!start) return null
  const i = start - 1
  if (tracking.t[i] < sinceFrame) return null
  if (sinceFrame === -Infinity || tracking.t[0] >= sinceFrame) return { mag: tracking.mag[i], res: tracking.res[i] }
  // Carry forward again, from the first read since the change only.
  let mag: number | undefined
  let res: number | undefined
  for (let j = i; j >= 0 && tracking.t[j] >= sinceFrame && (mag == null || res == null); j--) {
    mag ??= tracking.readMag[j]
    res ??= tracking.readRes[j]
  }
  return { mag, res }
}

function lastMark(times: readonly number[], now: number, duration: number): number {
  let start = 0
  let end = times.length
  while (start < end) {
    const mid = Math.floor((start + end) / 2)
    if (times[mid] <= now) start = mid + 1
    else end = mid
  }
  return start ? impactMark(now - times[start - 1], duration) : 0
}

/**
 * heldAmmo: the weapon in hand of life `life` at `frame`, and its ammo as the HUD shows it (the
 * magazine `mag`, the reserve `res`), with the inventory keyframe and instant it was read from.
 */
function heldAmmo(source: ReturnType<typeof prepareHud>, life: ReplayTrackReady, frame: number) {
  const { doc } = source
  const slot = life.slot
  const inventory = inventoryAt(doc, slot, frame)
  const now = frameToMs(frame, doc)
  const held = weaponInHand(doc, slot, frame)
  const inHand = held?.weaponSlot
  // A read of the emplacement dated before the latest weapon change into it (a pickup included), or
  // an upcoming keyframe dated after the next one, counts another weapon's ammo: never shown. Blank
  // is better than the replaced weapon's count (1a521d10 slot 518: a VK78 picked into emplacement 0
  // at frame 757 showed the replaced rifle's 36 | 108 until the next keyframe).
  const into = inHand != null ? changesInto(doc, slot, inHand, frame) : null
  const keyframeValid = inventory != null && into != null && inventory.state.t >= into.last && inventory.state.t < into.next
  const keyframe = inHand != null && keyframeValid ? inventory?.state.am?.[inHand] : undefined
  // The `ammoReads` axis tracks the magazine per shot; the inventory keyframe stands in without it.
  const fine = inHand != null ? ammoAt(source.ammo.get(ammoKey(slot, inHand)), now, into?.last) : null
  // While nothing has moved a field of the birth weapon (a fresh spawn that has not fired yet; a
  // refill tops up the reserve and keeps the magazine), the weapon's spawn ammo as the film measures
  // it (`spawnAmmo`): past information, so it outranks an upcoming keyframe, and it fills the field
  // a read leaves out (a refill's read carries the reserve only).
  // Likewise a weapon picked up since (`pickupAmmo`): the ammo the pickup gave it, while unmoved,
  // until a keyframe of its own reads it.
  const spawn = !held || (inventory && inventory.age >= 0 && keyframeValid) ? null
    : into && into.last > -Infinity ? pickupAmmoAt(source.pickupAmmo, slot, into.last, frame, held)
    : !(inventory && inventory.age >= 0) ? spawnAmmoAt(source.spawnAmmo, life, frame, held) : null
  const ammo = fine
    ? { ...keyframe, mag: fine.mag ?? spawn?.mag ?? keyframe?.mag, res: fine.res ?? spawn?.res ?? keyframe?.res }
    : spawn ? { ...keyframe, mag: spawn.mag ?? keyframe?.mag, res: spawn.res ?? keyframe?.res } : keyframe
  return { inventory, now, held, ammo }
}

/**
 * magazineInHand: the rounds in the magazine of the followed player's weapon in hand at `frame`, the
 * number the HUD shows (`readHud`'s `ammo.mag`); null while they are dead or the film does not say.
 * The first-person rig's ammo counter shows it (`ammoCounter3d`).
 */
export function magazineInHand(source: ReturnType<typeof prepareHud>, frame: number): number | null {
  const { player, presence } = source
  if (!player) return null
  const state = playerStateAt(player, frame, presence)
  if (!state.alive || !state.life) return null
  return heldAmmo(source, state.life, frame).ammo?.mag ?? null
}

export function readHud(source: ReturnType<typeof prepareHud>, frame: number, locale: ReplayLocale) {
  const { doc, player, presence } = source
  if (!player) return null
  const state = playerStateAt(player, frame, presence)
  if (!state.alive || !state.life) return null
  const slot = state.life.slot
  const { inventory, now, held, ammo } = heldAmmo(source, state.life, frame)
  const weapon = held
  const label = weapon ? doc.weaponLabels?.[weapon.id] : undefined
  const box = grenadeBoxAt(doc, slot, frame, inventory)
  const grenade = grenadeHudFrom(box, doc.grenadeLabels, locale)
  // The other emplacement of the in-hand weapon: the small dimmed icon of the upper row.
  const awayWeapon = weaponAway(doc, slot, frame)
  const away = awayWeapon ? { id: awayWeapon.id, label: doc.weaponLabels?.[awayWeapon.id] } : null
  // The in-hand weapon's name tag, dated by the latest change within the life (a life's spawn
  // shows none): full opacity for the first NAME_TAG_HOLD_MS, then a linear fade.
  const changeFrame = handChangeAt(doc, slot, frame)
  const tagOpacity = changeFrame != null && label ? nameTagOpacity(now - frameToMs(changeFrame, doc)) : null
  const nameTag = tagOpacity != null ? { text: (catalogText(label, locale) ?? '').toLocaleUpperCase(locale), opacity: tagOpacity } : null
  const hit = lastMark(source.impacts.get(slot) ?? [], now, 150)
  const elimination = lastMark(source.eliminations, now, 400)
  const equipment = equipmentSlotAt(doc, slot, frame)
  // The shield bar: smooth recharge, instant drops (`shieldHud`); null when the film carries no shield.
  const shieldState = state.shield ? shieldHudAt(shieldBar(source, state.life), frame) : null
  // Health (0..1) for the strip under the shield; null when the film records none.
  const health = state.health?.value ?? null
  return { shield: shieldState?.fraction ?? null, shieldState, health, damageArcs: damageArcsAt(doc, slot, frame), weaponId: weapon?.id, label, ammo, grenade, away, nameTag, equipment, shape: reticleShape(label?.key), hit, elimination }
}

/**
 * The in-hand weapon's name tag, under the in-hand row: the game shows it right after a swap and
 * fades it out. Pure in the frame (a seek to 1 s after a swap shows it half faded, as the game
 * would at that moment).
 */
/** The full-opacity hold, from the frame of the change. */
export const NAME_TAG_HOLD_MS = 500
/** The total life, from the frame of the change; the fade is linear over the rest. */
export const NAME_TAG_TOTAL_MS = 2000
/**
 * The tag's size, in ems of the HUD font (live `HUD_STYLE`, export `size`): text size, then the
 * vertical and horizontal padding in ems of the tag's own text. Measured on the owner's reference
 * frame ("S7 SNIPER", 751 px tall): capitals 8 px (1.07% of the height), box 16 px (2.1%). At
 * 1080 px our HUD font is 38.7 px, so capitals of 1.07% need a 0.43 em text, and a 2.1% box
 * leaves 0.2 em of padding above and below. The horizontal padding is read off the same frame.
 */
export const NAME_TAG_EM = 0.43
export const NAME_TAG_PAD_Y = 0.2
export const NAME_TAG_PAD_X = 0.45

/**
 * The weapon corner's thin rules, as the game draws them (owner's in-game capture, 2026-11-20):
 * the grenade and equipment slots are outlines with no backdrop, a rule runs above and below the
 * ammo and weapon row, and an upright rule parts the magazine count from the reserve. Their
 * opacity over the scene (read by eye off that capture, not from the HUD's tags).
 */
export const HUD_RULE_ALPHA = 0.75

/**
 * The weapon corner's proportions, in ems of the HUD's font size, shared by the live HUD
 * (`ReplayHud3d`) and the export painter (`exportHud`). Measured in pixels off the owner's in-game
 * capture (2026-11-20, a custom game on a bot training map), scaled so the grenade and equipment
 * slots keep the height they had (1.06 em); the game's ratios to that slot height are in the
 * comments. Icon sizes are boxes: our silhouettes keep their own aspect inside them.
 */
export const HUD_CORNER = {
  /** The magazine count: its digits are 0.49 of the slot height, in the medium weight. */
  magEm: 0.7,
  magWeight: 500,
  /** The reserve and the slots' counts: their digits are 0.29 of the slot height. */
  reserveEm: 0.42,
  countEm: 0.42,
  /**
   * The slots: the grenade 1.58 and the equipment 1.70 slot heights wide, sharing ONE upright rule
   * between them (owner's captures of 2026-11-21: the outer uprights and that divider are drawn at
   * the rule's strength, the top rule at about 7% of it and the bottom rule at about 20%, measured
   * against the wall behind the empty slots).
   */
  slotHeight: 1.06,
  grenadeSlotWidth: 1.67,
  equipmentSlotWidth: 1.8,
  slotTopRule: 0.07,
  slotBottomRule: 0.2,
  /**
   * The slot icons, as square boxes: the HUD bitmaps are 96x96 with the glyph inside its own
   * margins, and the game draws the whole bitmap square. Measured on the owner's capture of
   * 2026-11-21 (a 41 px slot): the frag, whose glyph fills its bitmap's height, stands 31 px tall
   * (0.76 slot heights); Shroud Screen, whose glyph fills its bitmap's width, is 33 px wide (0.81).
   */
  grenadeIcon: [0.8, 0.8],
  equipmentIcon: [0.86, 0.86],
  /** The slots' counts sit above the slot's middle: their center 0.18 slot heights higher (same capture). */
  countLift: 0.19,
  /** The away weapon: 2.2 by 0.47 slot heights, its right end 0.63 slot heights before the grenade slot. */
  awayIcon: [2.4, 0.55],
  awayGap: 0.65,
  /** The in-hand weapon: 3.4 by 0.86 slot heights, 0.58 slot heights right of the reserve. */
  weaponIcon: [3.6, 0.95],
  weaponGap: 0.6,
} as const

/**
 * The kill feed's top edge, as a share of the view height. The feed hangs from there and grows
 * down, newest row last: the kill feed screen (`cusc` 49050c80, `eventfeeddc`) aligns its list to
 * the top (vertical alignment -1), and on the owner's two reference frames (751 and 753 px tall)
 * the first row starts at 52.4% with 5 rows and with 4, the newest row (the one beside the
 * "Killed" popup) at the bottom. Measured, not read from the parent HUD screen.
 */
export const KILL_FEED_TOP_SHARE = 0.524

/** nameTagOpacity: the tag's opacity `ageMs` after the change; null before it and once faded. */
export function nameTagOpacity(ageMs: number): number | null {
  if (ageMs < 0 || ageMs >= NAME_TAG_TOTAL_MS) return null
  return ageMs <= NAME_TAG_HOLD_MS ? 1 : 1 - (ageMs - NAME_TAG_HOLD_MS) / (NAME_TAG_TOTAL_MS - NAME_TAG_HOLD_MS)
}

/**
 * The single grenade box of the HUD's upper row: the game draws ONE grenade type at a time
 * (the selected one). When the selection is indeterminate (several types carried, no selector
 * read in the life), the box shows frag (rank 0) with its count, or the lowest carried rank when
 * no frag is carried (owner's call, 2026-11-19: a plain grenade box blends in during those rare
 * moments, where generic text stood out). A null box (counters not read, or nothing carried)
 * keeps the rank-0 counter at 0, and a count of 0 is drawn as the game draws it: an empty slot.
 */
export interface HudGrenade {
  rank: number
  name: string
  count: number
}

/** grenadeHudFrom: the one grenade box the game draws, from the box's counters and selector
 * (`selectedGrenadeFrom`). */
export function grenadeHudFrom(box: GrenadeBox | null, labels: CatalogLabel[] | undefined, locale: ReplayLocale): HudGrenade {
  const generic = REPLAY_TEXT[locale].soundCategory.grenade
  if (!box) return { rank: 0, name: catalogText(labels?.[0], locale) ?? generic, count: 0 }
  const sel = selectedGrenadeFrom(box.g, box.gs)
  if (sel === 'indeterminate') {
    const rank = (box.g[0] ?? 0) > 0 ? 0 : box.g.findIndex((c) => c > 0)
    return { rank, name: catalogText(labels?.[rank], locale) ?? `rank ${rank}`, count: box.g[rank] }
  }
  const rank = sel ? sel.rank : 0
  return { rank, name: catalogText(labels?.[rank], locale) ?? (sel ? `rank ${rank}` : generic), count: sel ? box.g[rank] : box.g[0] ?? 0 }
}

/** Life window of an elimination of the followed player in the 3D HUD popup, in seconds. */
export const KILL_POPUP_SECONDS = 4

/** The linear drift of the opacity starts at the last second of the window. */
const KILL_POPUP_FADE_MS = 1000

/** An elimination of the followed player waiting to be displayed, with its own opacity. */
export interface KillPopup {
  /** The kill (victim and medals, in feed order). */
  kill: ReplayKill
  /** 1 during the window, then a linear drop to 0 over its last second. */
  opacity: number
}

/**
 * readKillPopups: the eliminations of the followed player to display beside the reticle — those
 * that happened at the latest by the current frame, within the KILL_POPUP_SECONDS window, the most
 * recent first, two at most. Pure function of the frame: a rewind replays
 * exactly what playback showed, and nothing is shown before its instant.
 */
export function readKillPopups(source: ReturnType<typeof prepareHud>, frame: number): KillPopup[] {
  const ms = frameToMs(frame, source.doc)
  const window = KILL_POPUP_SECONDS * 1000
  return source.feed
    .filter((k) => k.xuid === source.xuid && k.replayMs <= ms && ms - k.replayMs < window)
    .sort((a, b) => b.replayMs - a.replayMs)
    .slice(0, 2)
    .map((kill) => {
      const age = ms - kill.replayMs
      const fadeStart = window - KILL_POPUP_FADE_MS
      return { kill, opacity: age >= fadeStart ? 1 - (age - fadeStart) / KILL_POPUP_FADE_MS : 1 }
    })
}

/** The feed is bounded by the instant of the film, independently of the direction of playback. */
export function readKillFeed(source: ReturnType<typeof prepareHud>, frame: number) {
  const ms = frameToMs(frame, source.doc)
  let start = 0
  let end = source.feed.length
  while (start < end) {
    const mid = (start + end) >> 1
    if (source.feed[mid].replayMs <= ms) start = mid + 1
    else end = mid
  }
  return source.feed.slice(Math.max(0, start - 4), start)
    .filter((k) => ms - k.replayMs < 6000)
    .map((kill) => ({ kill, opacity: Math.min(1, (6000 - (ms - kill.replayMs)) / 1000),
      involved: kill.xuid === source.xuid || kill.victimXuid === source.xuid,
      // A kill by the followed player: the feed highlights it with his team color.
      mine: kill.xuid === source.xuid,
      killer: source.allegiance.ofXuid(kill.xuid), victim: source.allegiance.ofXuid(kill.victimXuid) }))
}

/** The LEFT team of the 3D banner: the game sorts by team identifier, the smallest on
 * the left. Unknown or equal: the ally team stays on the left. */
export function allyOnLeft(allyId: number | null | undefined, enemyId: number | null | undefined): boolean {
  if (allyId == null || enemyId == null) return true
  return allyId <= enemyId
}

/** The reading of the 3D HUD score banner: the two camps, and which camp sits on the left. */
export function readScoreHud(source: ReturnType<typeof prepareHud>, frame: number): (ScoreBannerReading & { allyOnLeft: boolean }) | null {
  const reading = readScoreBanner(source.score, source.allegiance, frame)
  if (!reading) return null
  return { ...reading, allyOnLeft: allyOnLeft(reading.ally.teamId, reading.enemy.teamId) }
}
