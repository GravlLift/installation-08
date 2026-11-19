// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { frameToMs, isAliveAt, trackWindow } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady, ReplayTrackReady } from '@/lib/replay/replayNormalize'
import { LOADOUT_SRC_BIRTH, currentLifeOf, loadoutAt, type LoadoutReading } from '@/lib/replay/rosterLogic'
import { inventoryAt, type InventoryReading } from './inventoryReading'
import { birthWeaponsOf, pickupEffects, type PickupEffect } from './pickupPlacement'
import { covers } from './replaySpans'

/** The in-hand weapon slot of a life across the film: sorted instants and slot (0 or 1). */
export interface HandTrack {
  ms: number[]
  w: number[]
}

/**
 * trackHand dates the in-hand weapon per life, more finely than the inventory keyframe: each
 * selector flip (`drawnWeapons`) and each per-shot magazine read (a magazine that moves is the
 * one of the in-hand weapon) assert the slot at its instant.
 */
export function trackHand(doc: ReplayDocumentReady): Map<number, HandTrack> {
  const found = new Map<number, { ms: number; w: number }[]>()
  const record = (slot: number, ms: number, w: number) => {
    const list = found.get(slot) ?? []
    list.push({ ms, w })
    found.set(slot, list)
  }
  for (const d of doc.drawnWeapons) if (d.d != null) record(d.slot, frameToMs(d.t, doc), d.d)
  for (const l of doc.ammoReads) if (l.src === 'delta' && l.mag != null && (l.w === 0 || l.w === 1)) record(l.slot, l.ms, l.w)
  const tracked = new Map<number, HandTrack>()
  for (const [slot, list] of found) {
    list.sort((a, b) => a.ms - b.ms)
    tracked.set(slot, { ms: list.map((f) => f.ms), w: list.map((f) => f.w) })
  }
  return tracked
}

const handTracksCache = new WeakMap<ReplayDocumentReady, Map<number, HandTrack>>()

/**
 * The held weapon, settled by the dated reads and bounded to the current life. Before the first
 * dated read of the life, the slot comes from `beforeFirstRead`.
 *
 * A FUTURE INVENTORY READ DOES NOT LOCATE THE HAND: a past dated read of the life
 * (selector, magazine) takes precedence, and without it the slot borrowed from the future is
 * admitted only if it holds a weapon of the birth loadout — the player has it from spawn, never a
 * pickup that arrives later in the life.
 *
 * THE SPAWN HAND (`birthHand`): a life read from its birth loadout holds the weapon of
 * emplacement 0 until its first dated read, as long as no weapon change is dated since birth.
 * A life with no loadout reading at all is named by its own shots (`weaponFromShots`).
 *
 * PICKUPS NO WEAPON CHANGE SAW: read as the weapon changes they are (`withPlacedPickups`), so the
 * hand holds a picked-up weapon from its pickup on.
 */
export function weaponInHand(doc: ReplayDocumentReady, slot: number, frame: number): { id: string; weaponSlot: number } | null {
  return handOn(withPlacedPickups(doc), slot, frame)
}

/**
 * weaponAway: the OTHER emplacement of the in-hand weapon of the life of `slot` at `frame` —
 * the small dimmed icon of the HUD's upper row. Read the same way `weaponInHand` reads the hand
 * (`withPlacedPickups`), so a swap trades the two automatically. Null when the hand is null, is
 * an objective emplacement (2), the life has no loadout reading, or the other emplacement holds
 * nothing.
 */
export function weaponAway(doc: ReplayDocumentReady, slot: number, frame: number): { id: string; weaponSlot: number } | null {
  const placed = withPlacedPickups(doc)
  const hand = handOn(placed, slot, frame)
  if (!hand || (hand.weaponSlot !== 0 && hand.weaponSlot !== 1)) return null
  const other = 1 - hand.weaponSlot
  const life = currentLifeOf(placed, slot, frame)
  if (!life) return null
  const lo = loadoutAt(placed, slot, frame)
  if (!lo) return null
  const id = weaponOfEmplacement(placed, slot, frame, lo, other, trackWindow(life).start)
  return id ? { id, weaponSlot: other } : null
}

const handChangeCache = new WeakMap<ReplayDocumentReady, Map<number, number[]>>()

/**
 * handChangeAt: the frame of the LATEST in-hand weapon change at or before `frame` in the life
 * covering `frame`, null before the first one — the weapon name tag dates from it. The change
 * frames are dated by the hand events: the selector flips (`drawnWeapons`), the weapon changes
 * (placed pickups included), and the per-shot magazine reads (`ammoReads` of `src 'delta'`). At
 * each event frame the in-hand weapon id is compared with the one of the frame before it, and a
 * change is recorded only when both frames sit in the SAME life, so a life's spawn carries none.
 * The list is built LAZILY for the one slot asked (the HUD only asks for the followed player's):
 * `weaponInHand` is not cheap, and a match carries thousands of delta ammo reads per player.
 */
export function handChangeAt(doc: ReplayDocumentReady, slot: number, frame: number): number | null {
  if (!currentLifeOf(doc, slot, frame)) return null
  let changes = handChangeCache.get(doc)
  if (!changes) { changes = new Map(); handChangeCache.set(doc, changes) }
  let list = changes.get(slot)
  if (!list) { list = buildHandChanges(doc, slot); changes.set(slot, list) }
  let start = 0
  let end = list.length
  while (start < end) {
    const mid = (start + end) >> 1
    if (list[mid] <= frame) start = mid + 1
    else end = mid
  }
  return start ? list[start - 1] : null
}

/**
 * buildHandChanges: the frames where the in-hand weapon id changes within a life, for ONE track
 * slot: only that slot's events, deduped (several events often share a frame).
 */
function buildHandChanges(doc: ReplayDocumentReady, slot: number): number[] {
  const placed = withPlacedPickups(doc)
  const frames = new Set<number>()
  for (const d of doc.drawnWeapons) if (d.slot === slot) frames.add(d.t)
  for (const c of placed.weaponChanges) if (c.slot === slot) frames.add(c.t)
  for (const r of doc.ammoReads) if (r.src === 'delta' && r.slot === slot) frames.add(r.t)
  const out: number[] = []
  for (const f of frames) {
    if (f < 1) continue
    const life = currentLifeOf(doc, slot, f)
    if (!life || currentLifeOf(doc, slot, f - 1) !== life) continue
    const before = weaponInHand(doc, slot, f - 1)?.id
    const after = weaponInHand(doc, slot, f)?.id
    if (before != null && after != null && before !== after) out.push(f)
  }
  return out.sort((a, b) => a - b)
}

const placementsCache = new WeakMap<ReplayDocumentReady, Map<ReplayTrackReady, PickupEffect[]>>()

/**
 * pickupPlacements: the placed effect of every weapon pickup no weapon change saw, per life read
 * from its birth loadout (`pickupEffects`). The hand that places a replacement is located WITHOUT
 * the placed pickups (`handOn` on the document itself): a pickup is placed by what the film says
 * before it, never by its own placement.
 */
export function pickupPlacements(doc: ReplayDocumentReady): Map<ReplayTrackReady, PickupEffect[]> {
  let placements = placementsCache.get(doc)
  if (placements) return placements
  placements = new Map()
  const handAt = (slot: number, frame: number) => handOn(doc, slot, frame)
  for (const track of doc.tracks) {
    const weapons = birthWeaponsOf(doc, track)
    if (!weapons) continue
    const effects = pickupEffects(doc, track, weapons, handAt)
    if (effects.length) placements.set(track, effects)
  }
  placementsCache.set(doc, placements)
  return placements
}

const placedCache = new WeakMap<ReplayDocumentReady, ReplayDocumentReady>()

/**
 * withPlacedPickups: the document with each placed pickup that put a NEW weapon into an emplacement
 * (`fill`, `replace`) written as the weapon change the film did not write (`taken`, at its
 * emplacement), so the hand, the row and the ammo reads see the picked weapon from the pickup on
 * (0bb2ccc9 frame 10825: the hand kept the replaced 0x48C19D2D while the player fired the
 * 0x80977BA5 he picked up). A pickup that cannot be placed (`unknown`) becomes a change without an
 * emplacement, which every reader treats as "either emplacement may have changed". A refill changes
 * no weapon and writes nothing. The document itself is returned when nothing is placed.
 */
export function withPlacedPickups(doc: ReplayDocumentReady): ReplayDocumentReady {
  let placed = placedCache.get(doc)
  if (placed) return placed
  const extra: ReplayDocumentReady['weaponChanges'] = []
  for (const [track, effects] of pickupPlacements(doc)) {
    for (const fx of effects) {
      if (fx.effect === 'refill') continue
      extra.push({ t: fx.t, slot: track.slot, kind: 'taken', w: fx.w, ...(fx.emplacement != null ? { k: fx.emplacement } : {}) })
    }
  }
  placed = extra.length ? { ...doc, weaponChanges: [...doc.weaponChanges, ...extra].sort((a, b) => a.t - b.t) } : doc
  placedCache.set(doc, placed)
  return placed
}

/**
 * changesInto: the weapon changes into emplacement `emplacement` of the life of `slot` covering
 * `frame`, placed pickups included (`withPlacedPickups`): the frame of the latest at or before
 * `frame` (-Infinity: none) and of the next after it (Infinity: none). A change without an
 * emplacement counts for both. An ammo read of the emplacement dated before `last`, or after `next`,
 * describes ANOTHER weapon than the one it holds at `frame`.
 */
export function changesInto(doc: ReplayDocumentReady, slot: number, emplacement: number, frame: number): { last: number; next: number } {
  const life = currentLifeOf(doc, slot, frame)
  let last = -Infinity, next = Infinity
  if (!life) return { last, next }
  const { start, end } = trackWindow(life)
  for (const c of withPlacedPickups(doc).weaponChanges) {
    if (c.slot !== slot || c.t < start || c.t > end || (c.k != null && c.k !== emplacement)) continue
    if (c.t <= frame) { if (c.t > last) last = c.t }
    else if (c.t < next) next = c.t
  }
  return { last, next }
}

/** handOn: `weaponInHand` read on `doc` as given (`weaponInHand` hands it the placed pickups). */
function handOn(doc: ReplayDocumentReady, slot: number, frame: number): { id: string; weaponSlot: number } | null {
  const life = currentLifeOf(doc, slot, frame)
  if (!life || carriedObjectAt(doc, life.xuid, frame)) return null
  let tracked = handTracksCache.get(doc)
  if (!tracked) { tracked = trackHand(doc); handTracksCache.set(doc, tracked) }
  const events = tracked.get(slot)
  const window = trackWindow(life)
  const lo = loadoutAt(doc, slot, frame)
  if (!lo) return weaponFromShots(doc, { slot, frame, birth: window.start }, window.end, events)
  const inv = inventoryAt(doc, slot, frame)
  const ms = frameToMs(frame, doc)
  const start = frameToMs(window.start, doc)
  const count = readsBefore(events, ms)
  const index = count - 1
  const eventMs = index >= 0 && events!.ms[index] >= start ? events!.ms[index] : -Infinity
  const invMs = inv ? frameToMs(inv.empty ? frame - inv.empty.age : inv.state.t, doc) : -Infinity
  const invFuture = inv != null && inv.age < 0
  if (eventMs === -Infinity && !(inv && inv.age >= 0)) {
    const k = birthHand(doc, { slot, frame, birth: window.start }, lo)
    const id = k === undefined ? undefined : lo.weapons[k]
    if (k !== undefined && id) return { id, weaponSlot: k }
  }
  let d: number | undefined
  if (invFuture) {
    // Future inventory read: a past dated read of the life takes precedence; without it,
    // only a slot of the birth loadout is borrowed from the future.
    d = eventMs !== -Infinity ? events!.w[index] : inv && !inv.empty && inBirthLoadout(lo, inv) ? inv.state.d : undefined
  } else {
    d = eventMs >= invMs && eventMs !== -Infinity ? events!.w[index] : inv && !inv.empty ? inv.state.d : undefined
  }
  if (d === 0 || d === 1) {
    const id = weaponOfEmplacement(doc, slot, frame, lo, d, window.start)
    if (id) return { id, weaponSlot: d }
    // The read designates an emplacement the row does not name, yet the row carries a single
    // weapon. When NO dated read (selector, per-shot magazine) has located the hand, the
    // designation is a keyframe inventory pointing at a slot whose magazine the film never
    // transmitted (`d` off by one): a carried player is never empty-handed, so the hand holds
    // that one weapon. When a dated read DOES point at the empty slot, the film says the player
    // draws a weapon the row cannot name and the hand stays empty.
    if (eventMs === -Infinity) {
      const k = uniqueWeaponEmplacement(doc, { slot, frame, birth: window.start }, lo)
      if (k !== undefined) {
        const uid = weaponOfEmplacement(doc, slot, frame, lo, k, window.start)
        if (uid) return { id: uid, weaponSlot: k }
      }
    }
    // The read designates an emplacement neither the row nor a pickup names: a shot fired from
    // that emplacement names its weapon (the same proof as `weaponFromShots`).
    const uid = weaponOfShot(doc, { slot, frame, birth: window.start }, d, window.end, events)
    if (uid) return { id: uid, weaponSlot: d }
  }
  // A past read of the life that does not locate the hand leaves it empty.
  if (eventMs !== -Infinity || (inv && inv.age >= 0)) return null
  const next = events && count < events.ms.length && events.ms[count] <= frameToMs(window.end, doc)
    ? { ms: events.ms[count], w: events.w[count] }
    : null
  const k = beforeFirstRead(doc, { slot, frame, birth: window.start }, lo, next)
  if (k === undefined) return null
  const id = weaponOfEmplacement(doc, slot, frame, lo, k, window.start)
  return id ? { id, weaponSlot: k } : null
}

/** readsBefore: the number of dated hand reads of `events` at or before instant `ms`. */
function readsBefore(events: HandTrack | undefined, ms: number): number {
  let lo = 0, hi = events?.ms.length ?? 0
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (events!.ms[mid] <= ms) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * EMPLACEMENT_BIRTH — the weapon emplacement a Spartan holds when he spawns: the first one of
 * his birth loadout. Measured on the nine local films of 2026-11-15 (203 lives with a two-weapon
 * birth loadout): every shot fired before the life's first hand read is the weapon of emplacement
 * 0 (49/49), every first inventory read says 0 (48/48), and every first selector flip goes to 1
 * (125/125), away from the spawn weapon.
 */
const EMPLACEMENT_BIRTH = 0

/**
 * birthHand: the index (in the reading's `weapons`) of the spawn weapon, for a life read
 * from its birth loadout and not yet located by any dated read. Undefined when the reading is
 * not the birth row with its emplacements, or when a weapon change is dated between the birth and
 * the frame (the hand may then hold the new weapon).
 */
function birthHand(
  doc: ReplayDocumentReady,
  life: { slot: number; frame: number; birth: number },
  lo: LoadoutReading,
): number | undefined {
  if (lo.src !== LOADOUT_SRC_BIRTH || !lo.k) return undefined
  if (changeBetween(doc, life.slot, life.birth, frameToMs(life.frame, doc))) return undefined
  const k = lo.k.indexOf(EMPLACEMENT_BIRTH)
  return k >= 0 ? k : undefined
}

/**
 * handAt: the emplacement the hand holds at `frame` in a life: the last dated hand read since the
 * birth (selector flip, per-shot magazine), else the spawn emplacement when no weapon change is
 * dated between the birth and the frame; undefined otherwise.
 */
function handAt(doc: ReplayDocumentReady, life: { slot: number; frame: number; birth: number }, events: HandTrack | undefined): number | undefined {
  const ms = frameToMs(life.frame, doc)
  const index = readsBefore(events, ms) - 1
  if (index >= 0 && events!.ms[index] >= frameToMs(life.birth, doc)) return events!.w[index]
  return changeBetween(doc, life.slot, life.birth, ms) ? undefined : EMPLACEMENT_BIRTH
}

/**
 * weaponFromShots: the weapon in hand of a life that NO loadout reading covers (its birth record
 * did not close and no keyframe fell inside it): a shot names the weapon in hand at its instant,
 * and the weapon of an emplacement is the one its shots name. The hand's emplacement at `frame`
 * comes from `handAt`. Null without a qualifying shot.
 */
function weaponFromShots(
  doc: ReplayDocumentReady,
  life: { slot: number; frame: number; birth: number },
  end: number,
  events: HandTrack | undefined,
): { id: string; weaponSlot: number } | null {
  const d = handAt(doc, life, events)
  if (d !== 0 && d !== 1) return null
  const id = weaponOfShot(doc, life, d, end, events)
  return id ? { id, weaponSlot: d } : null
}

/**
 * weaponOfShot: the weapon the shots of the life name for emplacement `d`, the one closest to
 * `frame`. A shot names the weapon in hand at its instant, so it counts only if the hand
 * designated `d` at the shot's instant too (`handAt`) and no weapon change of that emplacement is
 * dated between the shot and the frame. On foot only (a vehicle shot names the vehicle's
 * weapon). Null without such a shot.
 */
function weaponOfShot(
  doc: ReplayDocumentReady,
  life: { slot: number; frame: number; birth: number },
  d: number,
  end: number,
  events: HandTrack | undefined,
): string | null {
  let best: { id: string; gap: number } | null = null
  for (const s of doc.shots) {
    if (s.slot !== life.slot || s.v != null || !s.w || s.t < life.birth || s.t > end) continue
    const gap = Math.abs(s.t - life.frame)
    if (best && gap >= best.gap) continue
    if (handAt(doc, { ...life, frame: s.t }, events) !== d) continue
    const [from, to] = s.t <= life.frame ? [s.t, life.frame] : [life.frame, s.t]
    if (doc.weaponChanges.some((c) => c.slot === life.slot && c.k === d && c.t > from && c.t <= to)) continue
    best = { id: familyOf(s.w), gap }
  }
  return best?.id ?? null
}

/** familyOf: the weapon family of a shot's 64-bit weapon id (`0xFFFFFFFFVVVVVVVV` -> `0xFFFFFFFF`), the form of a loadout row. */
function familyOf(w: string): string {
  const m = /^0x([0-9a-f]{8})/i.exec(w)
  return m ? `0x${m[1].toUpperCase()}` : w
}

/**
 * The weapon of slot `d` in the read row, or failing that the most recent dated pickup of
 * that slot in the current life (from `birth` to `frame`).
 *
 * THE WHOLE LIFE, NOT ONLY SINCE THE ROW'S READ: a keyframe row read AFTER a pickup can still
 * leave the picked slot unnamed. On Streets (ee234787, slot 516) a pickup into slot 1 at frame
 * 918 was followed by rows read at 1089, 1695 and 2301 that all carried only the spawn weapon;
 * bounding the pickup search to "since the row's read" missed it, and the hand (weapon model,
 * arms, ammo counter) read empty for a minute while the player shot with the picked weapon.
 */
function weaponOfEmplacement(doc: ReplayDocumentReady, slot: number, frame: number, lo: LoadoutReading, d: number, birth: number): string | undefined {
  const id = lo.weapons[d]
  if (id) return id
  const changes = doc.weaponChanges.filter((c) => c.slot === slot && c.k === d && c.t >= birth && c.t <= frame).sort((a, b) => b.t - a.t)
  const w = changes[0]?.w
  if (!w) return undefined
  return /^[0-9a-f]{8}$/i.test(w) ? `0x${w.toUpperCase()}` : w
}

/** Is a weapon change of the slot dated between frame `from` and instant `toMs`, bounds included? */
function changeBetween(doc: ReplayDocumentReady, slot: number, from: number, toMs: number): boolean {
  return doc.weaponChanges.some((c) => c.slot === slot && c.t >= from && frameToMs(c.t, doc) <= toMs)
}

/**
 * inBirthLoadout — does the slot designated by a FUTURE inventory read hold a weapon
 * of the birth loadout? This is the borrowing from the future that the hand accepts: a weapon the
 * player has from spawn, never a pickup that arrives later in the life. Only the birth row
 * is admissible: a read refined by a pickup has lost its `birth` provenance.
 */
function inBirthLoadout(lo: LoadoutReading, inv: InventoryReading): boolean {
  const d = inv.state.d
  return (d === 0 || d === 1) && lo.src === LOADOUT_SRC_BIRTH && lo.weapons[d] != null
}

/**
 * beforeFirstRead: the in-hand slot of a life that no dated read (selector,
 * magazine, inventory) has located yet at `frame`. A player only leaves their weapon at the price of an
 * event, so there are only two proofs, in this order:
 *   1. the first FUTURE dated read of the same life (`next`), when no weapon change
 *      of the slot is dated between the birth and it: the hand has been holding since birth
 *      the slot that this read asserts;
 *   2. the UNIQUE weapon of the row, when no weapon change is dated between the birth and
 *      the frame (or the row's read, if it is in the future): a single carried weapon is in hand.
 * Without one or the other, the hand stays empty: no weapon that the document does not locate.
 */
function beforeFirstRead(
  doc: ReplayDocumentReady,
  life: { slot: number; frame: number; birth: number },
  lo: LoadoutReading,
  next: { ms: number; w: number } | null,
): number | undefined {
  if (next && (next.w === 0 || next.w === 1) && !changeBetween(doc, life.slot, life.birth, next.ms)) {
    return next.w
  }
  const k = spawnWeaponEmplacement(doc, life, lo)
  if (k !== undefined) return k
  return uniqueWeaponEmplacement(doc, life, lo)
}

/**
 * spawnWeaponEmplacement: the emplacement, in a keyframe row, of the weapon the player carried
 * from the birth. A row weapon that no pickup of THIS life (bounded to the row's read) explains
 * was carried since the birth: a weapon only leaves an emplacement at the price of an event, and
 * a drop would remove it from the row. Admissible only when exactly one such emplacement exists
 * and no drop or swap of it is dated between the birth and the frame (the hand was set down).
 */
function spawnWeaponEmplacement(
  doc: ReplayDocumentReady,
  life: { slot: number; frame: number; birth: number },
  lo: LoadoutReading,
): number | undefined {
  const birthMs = frameToMs(life.birth, doc)
  const readMs = frameToMs(Math.max(life.frame, life.frame - lo.age), doc)
  const candidates = lo.weapons
    .map((id, k) => ({ id, k }))
    .filter((x) => (x.k === 0 || x.k === 1) && x.id)
    .filter((x) => !doc.weaponChanges.some((c) =>
      c.slot === life.slot && c.kind === 'taken' && c.k === x.k &&
      frameToMs(c.t, doc) >= birthMs && frameToMs(c.t, doc) <= readMs))
  if (candidates.length !== 1) return undefined
  const k = candidates[0].k
  const frameMs = frameToMs(life.frame, doc)
  return doc.weaponChanges.some((c) =>
    c.slot === life.slot && c.k === k && c.kind !== 'taken' &&
    frameToMs(c.t, doc) >= birthMs && frameToMs(c.t, doc) <= frameMs)
    ? undefined : k
}

/**
 * uniqueWeaponEmplacement: the emplacement of the row's single carried weapon, admissible only
 * when no weapon change is dated between the birth and the row's read (the player may then have
 * dropped or swapped it). The one doctrine shared by `beforeFirstRead` and the
 * single-weapon fallback of `weaponInHand`: a carried player who has exactly one named weapon holds
 * it, whatever slot a disagreeing read points at. Undefined otherwise.
 */
function uniqueWeaponEmplacement(doc: ReplayDocumentReady, life: { slot: number; frame: number; birth: number }, lo: LoadoutReading): number | undefined {
  const carriedWeapons = lo.weapons.filter(Boolean)
  if (carriedWeapons.length !== 1) return undefined
  const readMs = frameToMs(Math.max(life.frame, life.frame - lo.age), doc)
  const k = lo.weapons.indexOf(carriedWeapons[0])
  return (k === 0 || k === 1) && !changeBetween(doc, life.slot, life.birth, readMs) ? k : undefined
}

/** The weapon slot of carried objects (skull, flag), next to the two weapons of the row. */
const EMPLACEMENT_OBJECT = 2

/** The objective object a player holds in hand: the Oddball skull or a CTF flag. */
export type CarriedObject = 'skull' | 'flag'

/**
 * carriedObjectAt: the objective object player `xuid` holds at `frame`, null when none. The skull
 * by its carry periods; a flag by the spans of its life that name this player as carrier
 * (`carried`, and `carried_open` whose end is not dated). A carrier holds the object instead of
 * a weapon: no carrier of the CTF films fires during a carry.
 */
export function carriedObjectAt(
  doc: Pick<ReplayDocumentReady, 'skullCarries' | 'flagCarries'>,
  xuid: string | undefined,
  frame: number,
): CarriedObject | null {
  if (!xuid) return null
  if (doc.skullCarries.some((c) => c.xuid === xuid && covers(c, frame))) return 'skull'
  return carriedFlagOf(doc, xuid, frame) ? 'flag' : null
}

/** carriedFlagOf: the flag whose spans name player `xuid` as its carrier at `frame`, null when none. */
function carriedFlagOf(
  doc: Pick<ReplayDocumentReady, 'flagCarries'>,
  xuid: string,
  frame: number,
): ReplayDocumentReady['flagCarries'][number] | null {
  for (const f of doc.flagCarries) {
    for (const sp of f.spans) {
      if (sp.xuid === xuid && (sp.state === 'carried' || sp.state === 'carried_open') && covers(sp, frame)) return f
    }
  }
  return null
}

/**
 * flagTeamInHand: the team of the flag that life `slot` carries at `frame` (the team whose banner
 * the flag shows), null when it carries no flag.
 */
export function flagTeamInHand(doc: ReplayDocumentReady, slot: number, frame: number): number | null {
  const life = currentLifeOf(doc, slot, frame)
  return life?.xuid ? (carriedFlagOf(doc, life.xuid, frame)?.team ?? null) : null
}

/**
 * handObject: the objective object (skull, flag) that life `slot` carries at `frame`, under its
 * weapon identifier; null outside carrying. The identifier comes from the most recent pickup of
 * the object slot by this life, failing that any pickup of the match (the carrying is dated by
 * the score or the flag spans, its pickup can follow it by a few frames or be missing).
 */
export function handObject(doc: ReplayDocumentReady, slot: number, frame: number): { id: string; weaponSlot: number } | null {
  const life = currentLifeOf(doc, slot, frame)
  if (!life || !carriedObjectAt(doc, life.xuid, frame)) return null
  let own: string | undefined, other: string | undefined
  let latest = -Infinity
  for (const c of doc.weaponChanges) {
    if (c.k !== EMPLACEMENT_OBJECT || c.kind !== 'taken' || !c.w) continue
    other ??= c.w
    if (c.slot === slot && c.t <= frame && c.t > latest) { own = c.w; latest = c.t }
  }
  const w = own ?? other
  if (!w) return null
  return { id: /^[0-9a-f]{8}$/i.test(w) ? `0x${w.toUpperCase()}` : w, weaponSlot: EMPLACEMENT_OBJECT }
}

/**
 * flagObjectIdOf: the weapon identifier of the CTF flag of this film, the object its first
 * located carrier holds in hand (`handObject`); null without any carry the film can place. Every
 * flag of a match is the same `weap` tag, the team only selects a permutation of its model.
 */
export function flagObjectIdOf(doc: ReplayDocumentReady): string | null {
  for (const f of doc.flagCarries) {
    for (const sp of f.spans) {
      if (!sp.xuid || (sp.state !== 'carried' && sp.state !== 'carried_open')) continue
      const life = doc.tracks.find((t) => t.xuid === sp.xuid && isAliveAt(t, sp.t0))
      const held = life ? handObject(doc, life.slot, sp.t0) : null
      if (held) return held.id
    }
  }
  return null
}
