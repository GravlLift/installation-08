/**
 * reloadSound.ts — WHEN A RELOAD SOUNDS, AND FOR HOW LONG.
 *
 * THE SOURCE IS THE FILM'S RELOAD ACTION (`doc.actions`, kind `reload`, the game's
 * `weapon_reload` input), the same for every weapon. It names no weapon: the weapon is the one in
 * hand at that instant (`armeEnMain`), and its tag picks the reload animation the game plays for
 * it (`reloadManifest.ts`). ONE RULE FOR EVERY CLASS: a weapon whose tag has no reload in the
 * manifest stays silent, and that is how the battery weapons (plasma pistol, pulse carbine,
 * ravager, stalker rifle: the game vents them, it has no reload animation for them), the melee
 * weapons and anything the extraction did not reach stay quiet, without a list of names here.
 *
 * WHAT THE FILM WRITES, measured on the seven stored matches (2026-11-14): the same action two or
 * more times at the same millisecond starts no reload (an equipment activation, a melee, a slide:
 * `model/reloadStarts.ts`), it ends the one under way; a single reload action can still land
 * at the very instant of a melee or a grenade throw, after which the magazine keeps emptying. The
 * cancellation rule below silences those without a special case.
 *
 * THE TIMING IS THE ANIMATION'S. Each sound plays at its frame of the reload animation after the
 * action (`atMs`), its whole take; the stance at the action picks the crouched animation when the
 * player is crouched and the weapon has one.
 *
 * A RELOAD IS CANCELLED, at the earliest of: the end of the life; the hand leaving the weapon (a
 * selector flip to the other slot, or a pickup or drop); a melee, a throw or a repeated reload
 * message (an equipment use, a slide) by the player, from the same instant on; a shot by the player after the action; the player's next reload. The
 * sounds the animation would post after that instant do not play, and a take still sounding is
 * cut there.
 */
import { frameToMs, msToFrames, positionAt, trackWindow } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { botKey, currentLifeOf } from '../../../lib/replay/rosterLogic'
import { armeEnMain } from '../model/armeEnMain'
import { reloadReadings } from '../model/reloadStarts'
import { covers } from '../model/replaySpans'
import { weaponTagOf, type ReloadClip, type ReloadLibrary } from './reloadManifest'
import type { ReplaySoundEvent } from './replaySoundVariants'

/** The actions that end a reload from the very instant they share with it. */
const INTERRUPTING_ACTIONS: ReadonlySet<string> = new Set(['melee', 'throwStart'])

/**
 * A player's dated facts that bear on a reload (and a vent, the same `weapon_reload` messages),
 * each list sorted by ms.
 */
export interface SlotFacts {
  reloads: number[]
  interrupts: number[]
  shots: number[]
  changes: number[]
  hands: { ms: number; d: number }[]
}

/**
 * reloadSoundEvents — every reload's sounds, for the weapons the library has a reload for.
 *
 * THE FOLLOWED PLAYER IS NON-SPATIAL (bug fixed 2026-11-16, same rule as `ventSound.ts` next
 * door, which this file never carried despite sharing its `weapon_reload` source): his own
 * reload is his, without a place. The others are positioned on their life, same fall-off as
 * every other per-player sound.
 */
export function reloadSoundEvents(
  doc: ReplayDocumentReady,
  library: ReloadLibrary | undefined,
  followed: string | null = null,
): ReplaySoundEvent[] {
  if (!library || library.size === 0) return []
  const facts = factsBySlot(doc)
  const out: ReplaySoundEvent[] = []
  for (const [slot, f] of facts) {
    for (let i = 0; i < f.reloads.length; i++) {
      out.push(...oneReload(doc, library, slot, f, i, followed))
    }
  }
  return out.sort((a, b) => a.ms - b.ms)
}

/** oneReload — the sounds of the i-th reload of a player. */
function oneReload(doc: ReplayDocumentReady, library: ReloadLibrary, slot: number, f: SlotFacts, i: number, followed: string | null): ReplaySoundEvent[] {
  const startMs = f.reloads[i]
  const frame = Math.floor(msToFrames(startMs, doc))
  const held = armeEnMain(doc, slot, frame)
  const tag = held ? weaponTagOf(held.id) : null
  const life = currentLifeOf(doc, slot, frame)
  const clip = tag && life ? clipAt(doc, library, tag, slot, frame) : undefined
  if (!held || !life || !clip) return []
  const endMs = Math.min(
    startMs + clip.durationMs,
    frameToMs(trackWindow(life).end, doc),
    f.reloads[i + 1] ?? Infinity,
    firstAt(f.interrupts, startMs, true),
    firstAt(f.shots, startMs, false),
    firstAt(f.changes, startMs, false),
    f.hands.find((h) => h.ms > startMs && h.d !== held.slotArme)?.ms ?? Infinity,
  )
  const cancelled = endMs < startMs + clip.durationMs
  const xuid = trackIdentity(doc, slot)
  const out: ReplaySoundEvent[] = []
  for (const s of clip.sounds) {
    const ms = startMs + s.atMs
    if (ms >= endMs || s.stems.length === 0) continue
    const e: ReplaySoundEvent = { ms, stem: s.stems[0], gainDb: clip.gainDb }
    if (s.stems.length > 1) e.variants = s.stems
    if (cancelled) e.cutMs = endMs - ms
    const at = positionAt(life.points, msToFrames(ms, doc))
    if (at && !(followed !== null && xuid === followed)) e.at = { x: at.x, y: at.y }
    out.push(e)
  }
  return out
}

/** The xuid a track plays under: its real xuid, or its bot key (same rule as `footstepSound.ts`, `ventSound.ts`). */
export function trackIdentity(doc: ReplayDocumentReady, slot: number): string {
  const track = doc.tracks.find((t) => t.slot === slot)
  return track?.xuid || (track?.bot ? botKey(track.bot) : '')
}

/** clipAt — the weapon's reload animation in the player's stance: crouched when the film says so and the weapon has one. */
function clipAt(doc: ReplayDocumentReady, library: ReloadLibrary, tag: string, slot: number, frame: number): ReloadClip | undefined {
  const clips = library.get(tag)
  if (!clips) return undefined
  const crouched = doc.stances.some((s) => s.kind === 'crouch' && s.slot === slot && covers(s, frame))
  return (crouched ? clips.crouch : undefined) ?? clips.combat
}

/** firstAt — the first instant of a sorted list after ms (at ms too when `inclusive`), or Infinity. */
export function firstAt(sorted: readonly number[], ms: number, inclusive: boolean): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (inclusive ? sorted[mid] < ms : sorted[mid] <= ms) lo = mid + 1
    else hi = mid
  }
  return lo < sorted.length ? sorted[lo] : Infinity
}

/**
 * factsBySlot — each player's reloads (one per instant) and the facts that cancel them, sorted.
 * The vents read the same facts (`ventSound.ts`).
 */
export function factsBySlot(doc: ReplayDocumentReady): Map<number, SlotFacts> {
  const by = new Map<number, SlotFacts>()
  const of = (slot: number) => {
    let f = by.get(slot)
    if (!f) by.set(slot, (f = { reloads: [], interrupts: [], shots: [], changes: [], hands: [] }))
    return f
  }
  for (const [slot, r] of reloadReadings(doc)) {
    of(slot).reloads.push(...r.starts)
    of(slot).interrupts.push(...r.cuts)
  }
  for (const a of doc.actions) if (INTERRUPTING_ACTIONS.has(a.kind)) of(a.slot).interrupts.push(a.ms)
  for (const s of doc.shots) by.get(s.slot)?.shots.push(frameToMs(s.t, doc))
  for (const c of doc.weaponChanges) by.get(c.slot)?.changes.push(frameToMs(c.t, doc))
  for (const d of doc.drawnWeapons) if (d.d != null) by.get(d.slot)?.hands.push({ ms: frameToMs(d.t, doc), d: d.d })
  const asc = (a: number, b: number) => a - b
  for (const f of by.values()) {
    f.reloads = [...new Set(f.reloads)].sort(asc)
    f.interrupts.sort(asc)
    f.shots.sort(asc)
    f.changes.sort(asc)
    f.hands.sort((a, b) => a.ms - b.ms)
  }
  return by
}
