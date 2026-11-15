import { frameToMs, isAliveAt, trackWindow } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import { LOADOUT_SRC_BIRTH, currentLifeOf, loadoutAt, type LoadoutReading } from '@/lib/replay/rosterLogic'
import { inventoryAt, type InventoryReading } from './inventoryReading'
import { covers } from './replaySpans'

/** The in-hand weapon slot of a life across the film: sorted instants and slot (0 or 1). */
export interface SuiviMain {
  ms: number[]
  w: number[]
}

/**
 * suivreMain dates the in-hand weapon per life, more finely than the inventory keyframe: each
 * selector flip (`drawnWeapons`) and each per-shot magazine read (a magazine that moves is the
 * one of the in-hand weapon) assert the slot at its instant.
 */
export function suivreMain(doc: ReplayDocumentReady): Map<number, SuiviMain> {
  const faits = new Map<number, { ms: number; w: number }[]>()
  const noter = (slot: number, ms: number, w: number) => {
    const liste = faits.get(slot) ?? []
    liste.push({ ms, w })
    faits.set(slot, liste)
  }
  for (const d of doc.drawnWeapons) if (d.d != null) noter(d.slot, frameToMs(d.t, doc), d.d)
  for (const l of doc.ammoReads) if (l.src === 'delta' && l.mag != null && (l.w === 0 || l.w === 1)) noter(l.slot, l.ms, l.w)
  const suivis = new Map<number, SuiviMain>()
  for (const [slot, liste] of faits) {
    liste.sort((a, b) => a.ms - b.ms)
    suivis.set(slot, { ms: liste.map((f) => f.ms), w: liste.map((f) => f.w) })
  }
  return suivis
}

const suivis = new WeakMap<ReplayDocumentReady, Map<number, SuiviMain>>()

/**
 * The held weapon, settled by the dated reads and bounded to the current life. Before the first
 * dated read of the life, the slot comes from `avantPremiereLecture`.
 *
 * A FUTURE INVENTORY READ DOES NOT LOCATE THE HAND: a past dated read of the life
 * (selector, magazine) takes precedence, and without it the slot borrowed from the future is
 * admitted only if it holds a weapon of the birth loadout — the player has it from spawn, never a
 * pickup that arrives later in the life.
 *
 * THE SPAWN HAND (`mainDeNaissance`): a life read from its birth loadout holds the weapon of
 * emplacement 0 until its first dated read, as long as no weapon change is dated since birth.
 * A life with no loadout reading at all is named by its own shots (`armeDesTirs`).
 */
export function armeEnMain(doc: ReplayDocumentReady, slot: number, frame: number): { id: string; slotArme: number } | null {
  const life = currentLifeOf(doc, slot, frame)
  if (!life || carriedObjectAt(doc, life.xuid, frame)) return null
  let suivi = suivis.get(doc)
  if (!suivi) { suivi = suivreMain(doc); suivis.set(doc, suivi) }
  const events = suivi.get(slot)
  const vie = trackWindow(life)
  const lo = loadoutAt(doc, slot, frame)
  if (!lo) return armeDesTirs(doc, { slot, frame, naissance: vie.start }, vie.end, events)
  const inv = inventoryAt(doc, slot, frame)
  const ms = frameToMs(frame, doc)
  const start = frameToMs(vie.start, doc)
  const debut = lecturesJusqua(events, ms)
  const index = debut - 1
  const eventMs = index >= 0 && events!.ms[index] >= start ? events!.ms[index] : -Infinity
  const invMs = inv ? frameToMs(inv.empty ? frame - inv.empty.age : inv.state.t, doc) : -Infinity
  const invFutur = inv != null && inv.age < 0
  if (eventMs === -Infinity && !(inv && inv.age >= 0)) {
    const k = mainDeNaissance(doc, { slot, frame, naissance: vie.start }, lo)
    const id = k === undefined ? undefined : lo.weapons[k]
    if (k !== undefined && id) return { id, slotArme: k }
  }
  let d: number | undefined
  if (invFutur) {
    // Future inventory read: a past dated read of the life takes precedence; without it,
    // only a slot of the birth loadout is borrowed from the future.
    d = eventMs !== -Infinity ? events!.w[index] : inv && !inv.empty && dansLaDotation(lo, inv) ? inv.state.d : undefined
  } else {
    d = eventMs >= invMs && eventMs !== -Infinity ? events!.w[index] : inv && !inv.empty ? inv.state.d : undefined
  }
  if (d === 0 || d === 1) {
    const id = armeDeLEmplacement(doc, slot, frame, lo, d)
    if (id) return { id, slotArme: d }
  }
  // A past read of the life that does not locate the hand leaves it empty.
  if (eventMs !== -Infinity || (inv && inv.age >= 0)) return null
  const suivante = events && debut < events.ms.length && events.ms[debut] <= frameToMs(vie.end, doc)
    ? { ms: events.ms[debut], w: events.w[debut] }
    : null
  const k = avantPremiereLecture(doc, { slot, frame, naissance: vie.start }, lo, suivante)
  if (k === undefined) return null
  const id = armeDeLEmplacement(doc, slot, frame, lo, k)
  return id ? { id, slotArme: k } : null
}

/** lecturesJusqua: the number of dated hand reads of `events` at or before instant `ms`. */
function lecturesJusqua(events: SuiviMain | undefined, ms: number): number {
  let debut = 0, fin = events?.ms.length ?? 0
  while (debut < fin) {
    const milieu = Math.floor((debut + fin) / 2)
    if (events!.ms[milieu] <= ms) debut = milieu + 1
    else fin = milieu
  }
  return debut
}

/**
 * EMPLACEMENT_NAISSANCE — the weapon emplacement a Spartan holds when he spawns: the first one of
 * his birth loadout. Measured on the nine local films of 2026-11-15 (203 lives with a two-weapon
 * birth loadout): every shot fired before the life's first hand read is the weapon of emplacement
 * 0 (49/49), every first inventory read says 0 (48/48), and every first selector flip goes to 1
 * (125/125), away from the spawn weapon.
 */
const EMPLACEMENT_NAISSANCE = 0

/**
 * mainDeNaissance: the index (in the reading's `weapons`) of the spawn weapon, for a life read
 * from its birth loadout and not yet located by any dated read. Undefined when the reading is
 * not the birth row with its emplacements, or when a weapon change is dated between the birth and
 * the frame (the hand may then hold the new weapon).
 */
function mainDeNaissance(
  doc: ReplayDocumentReady,
  vie: { slot: number; frame: number; naissance: number },
  lo: LoadoutReading,
): number | undefined {
  if (lo.src !== LOADOUT_SRC_BIRTH || !lo.k) return undefined
  if (changementEntre(doc, vie.slot, vie.naissance, frameToMs(vie.frame, doc))) return undefined
  const k = lo.k.indexOf(EMPLACEMENT_NAISSANCE)
  return k >= 0 ? k : undefined
}

/**
 * mainA: the emplacement the hand holds at `frame` in a life: the last dated hand read since the
 * birth (selector flip, per-shot magazine), else the spawn emplacement when no weapon change is
 * dated between the birth and the frame; undefined otherwise.
 */
function mainA(doc: ReplayDocumentReady, vie: { slot: number; frame: number; naissance: number }, events: SuiviMain | undefined): number | undefined {
  const ms = frameToMs(vie.frame, doc)
  const index = lecturesJusqua(events, ms) - 1
  if (index >= 0 && events!.ms[index] >= frameToMs(vie.naissance, doc)) return events!.w[index]
  return changementEntre(doc, vie.slot, vie.naissance, ms) ? undefined : EMPLACEMENT_NAISSANCE
}

/**
 * armeDesTirs: the weapon in hand of a life that NO loadout reading covers (its birth record did
 * not close and no keyframe fell inside it): a shot names the weapon in hand at its instant, and
 * the weapon of an emplacement is the one its shots name. The hand's emplacement at `frame` and
 * at each shot comes from `mainA`; a shot counts only if no weapon change of that emplacement is
 * dated between it and the frame. On foot only (a vehicle shot names the vehicle's weapon). Null
 * without such a shot.
 */
function armeDesTirs(
  doc: ReplayDocumentReady,
  vie: { slot: number; frame: number; naissance: number },
  fin: number,
  events: SuiviMain | undefined,
): { id: string; slotArme: number } | null {
  const d = mainA(doc, vie, events)
  if (d !== 0 && d !== 1) return null
  let best: { id: string; ecart: number } | null = null
  for (const s of doc.shots) {
    if (s.slot !== vie.slot || s.v != null || !s.w || s.t < vie.naissance || s.t > fin) continue
    const ecart = Math.abs(s.t - vie.frame)
    if (best && ecart >= best.ecart) continue
    if (mainA(doc, { ...vie, frame: s.t }, events) !== d) continue
    const [de, a] = s.t <= vie.frame ? [s.t, vie.frame] : [vie.frame, s.t]
    if (doc.weaponChanges.some((c) => c.slot === vie.slot && c.k === d && c.t > de && c.t <= a)) continue
    best = { id: familleDe(s.w), ecart }
  }
  return best ? { id: best.id, slotArme: d } : null
}

/** familleDe: the weapon family of a shot's 64-bit weapon id (`0xFFFFFFFFVVVVVVVV` -> `0xFFFFFFFF`), the form of a loadout row. */
function familleDe(w: string): string {
  const m = /^0x([0-9a-f]{8})/i.exec(w)
  return m ? `0x${m[1].toUpperCase()}` : w
}

/**
 * The weapon of slot `d` in the read row, or failing that the most recent dated pickup of
 * that slot since the row's read.
 */
function armeDeLEmplacement(doc: ReplayDocumentReady, slot: number, frame: number, lo: LoadoutReading, d: number): string | undefined {
  const id = lo.weapons[d]
  if (id) return id
  const changes = doc.weaponChanges.filter((c) => c.slot === slot && c.k === d && c.t > frame - lo.age && c.t <= frame).sort((a, b) => b.t - a.t)
  const w = changes[0]?.w
  if (!w) return undefined
  return /^[0-9a-f]{8}$/i.test(w) ? `0x${w.toUpperCase()}` : w
}

/** Is a weapon change of the slot dated between frame `de` and instant `aMs`, bounds included? */
function changementEntre(doc: ReplayDocumentReady, slot: number, de: number, aMs: number): boolean {
  return doc.weaponChanges.some((c) => c.slot === slot && c.t >= de && frameToMs(c.t, doc) <= aMs)
}

/**
 * dansLaDotation — does the slot designated by a FUTURE inventory read hold a weapon
 * of the birth loadout? This is the borrowing from the future that the hand accepts: a weapon the
 * player has from spawn, never a pickup that arrives later in the life. Only the birth row
 * is admissible: a read refined by a pickup has lost its `birth` provenance.
 */
function dansLaDotation(lo: LoadoutReading, inv: InventoryReading): boolean {
  const d = inv.state.d
  return (d === 0 || d === 1) && lo.src === LOADOUT_SRC_BIRTH && lo.weapons[d] != null
}

/**
 * avantPremiereLecture: the in-hand slot of a life that no dated read (selector,
 * magazine, inventory) has located yet at `frame`. A player only leaves their weapon at the price of an
 * event, so there are only two proofs, in this order:
 *   1. the first FUTURE dated read of the same life (`suivante`), when no weapon change
 *      of the slot is dated between the birth and it: the hand has been holding since birth
 *      the slot that this read asserts;
 *   2. the UNIQUE weapon of the row, when no weapon change is dated between the birth and
 *      the frame (or the row's read, if it is in the future): a single carried weapon is in hand.
 * Without one or the other, the hand stays empty: no weapon that the document does not locate.
 */
function avantPremiereLecture(
  doc: ReplayDocumentReady,
  vie: { slot: number; frame: number; naissance: number },
  lo: LoadoutReading,
  suivante: { ms: number; w: number } | null,
): number | undefined {
  if (suivante && (suivante.w === 0 || suivante.w === 1) && !changementEntre(doc, vie.slot, vie.naissance, suivante.ms)) {
    return suivante.w
  }
  const portees = lo.weapons.filter(Boolean)
  if (portees.length !== 1) return undefined
  const releve = frameToMs(Math.max(vie.frame, vie.frame - lo.age), doc)
  const k = lo.weapons.indexOf(portees[0])
  return (k === 0 || k === 1) && !changementEntre(doc, vie.slot, vie.naissance, releve) ? k : undefined
}

/** The weapon slot of carried objects (skull, flag), next to the two weapons of the row. */
const EMPLACEMENT_OBJET = 2

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
 * objetEnMain: the objective object (skull, flag) that life `slot` carries at `frame`, under its
 * weapon identifier; null outside carrying. The identifier comes from the most recent pickup of
 * the object slot by this life, failing that any pickup of the match (the carrying is dated by
 * the score or the flag spans, its pickup can follow it by a few frames or be missing).
 */
export function objetEnMain(doc: ReplayDocumentReady, slot: number, frame: number): { id: string; slotArme: number } | null {
  const life = currentLifeOf(doc, slot, frame)
  if (!life || !carriedObjectAt(doc, life.xuid, frame)) return null
  let propre: string | undefined, autre: string | undefined
  let quand = -Infinity
  for (const c of doc.weaponChanges) {
    if (c.k !== EMPLACEMENT_OBJET || c.kind !== 'taken' || !c.w) continue
    autre ??= c.w
    if (c.slot === slot && c.t <= frame && c.t > quand) { propre = c.w; quand = c.t }
  }
  const w = propre ?? autre
  if (!w) return null
  return { id: /^[0-9a-f]{8}$/i.test(w) ? `0x${w.toUpperCase()}` : w, slotArme: EMPLACEMENT_OBJET }
}

/**
 * flagObjectIdOf: the weapon identifier of the CTF flag of this film, the object its first
 * located carrier holds in hand (`objetEnMain`); null without any carry the film can place. Every
 * flag of a match is the same `weap` tag, the team only selects a permutation of its model.
 */
export function flagObjectIdOf(doc: ReplayDocumentReady): string | null {
  for (const f of doc.flagCarries) {
    for (const sp of f.spans) {
      if (!sp.xuid || (sp.state !== 'carried' && sp.state !== 'carried_open')) continue
      const life = doc.tracks.find((t) => t.xuid === sp.xuid && isAliveAt(t, sp.t0))
      const held = life ? objetEnMain(doc, life.slot, sp.t0) : null
      if (held) return held.id
    }
  }
  return null
}

