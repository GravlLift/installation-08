// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ventSound.ts — WHEN A HEAT WEAPON'S VENT SOUNDS, WITH THE VENT ANIMATION'S OWN TIMING.
 *
 * THE SOURCE IS THE FILM'S `weapon_reload` MESSAGE, the same one the reloads read: the game vents
 * a heat weapon's (Stalker, Plasma Pistol, Pulse Carbine, Ravager) heat on that input, and the
 * film writes it the same way. The messages are grouped into episodes the way the first-person
 * vent does (`episodesRechargement`): the enter from the episode's first message, the loop held
 * until the later of the episode's last message and one full loop, then the exit (`phaseVent`,
 * `firstPersonReload3d.ts`). A weapon with no vent in the library (every weapon that
 * reloads, the melee weapons, anything the extraction did not reach) stays silent, without a
 * list of names here.
 *
 * THE TIMING IS THE ANIMATION'S. Each sound plays at its frame of its phase's animation: the
 * enter's from the episode's start, the exit's from the loop's end. The game's loop animation
 * posts no sound (the installed game, 2026-11-15), so the loop is silent by the manifest, not
 * by a rule here.
 *
 * A VENT ENDS, at the earliest of: the end of the life; the next vent episode; a shot by the
 * player after the episode starts (the rule of `phaseVent`); a hand leaving the weapon (a
 * selector flip to the other slot, or a pickup or drop). The sounds after that instant do not
 * play, and a take still sounding is cut there.
 *
 * THE FOLLOWED PLAYER IS NON-SPATIAL: his own vent is his, without a place. The others are
 * positioned like their reload sounds.
 */
import { frameToMs, msToFrames, positionAt, trackWindow } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { currentLifeOf } from '../../../lib/replay/rosterLogic'
import { weaponInHand } from '../model/weaponInHand'
import { reloadReadings } from '../model/reloadStarts'
import { covers } from '../model/replaySpans'
import { episodesRechargement, type EpisodeRechargement } from '../scene3d/firstPersonReload3d'
import { weaponTagOf, type ReloadClip, type VentLibrary } from './reloadManifest'
import { factsBySlot, firstAt, trackIdentity, type SlotFacts } from './reloadSound'
import type { ReplaySoundEvent } from './replaySoundVariants'

/** ventSoundEvents — every vent's sounds, for the weapons the library has a vent for. */
export function ventSoundEvents(doc: ReplayDocumentReady, library: VentLibrary | undefined, followed: string | null): ReplaySoundEvent[] {
  if (!library || library.size === 0) return []
  const frameIntervalMs = doc.frameIntervalMs ?? 0
  if (frameIntervalMs <= 0) return []
  const fps = 1000 / frameIntervalMs
  const facts = factsBySlot(doc)
  const out: ReplaySoundEvent[] = []
  for (const [slot, r] of reloadReadings(doc)) {
    const f = facts.get(slot)
    if (!f) continue
    const framesOf = (ms: readonly number[]) => ms.map((t) => msToFrames(t, doc))
    const episodes = episodesRechargement(framesOf(r.starts), framesOf(r.cuts), fps)
    for (let i = 0; i < episodes.length; i++) {
      out.push(...oneVent(doc, library, slot, f, episodes[i], episodes[i + 1] ?? null, followed))
    }
  }
  return out.sort((a, b) => a.ms - b.ms)
}

/** oneVent — the sounds of one vent episode of a player. */
function oneVent(
  doc: ReplayDocumentReady,
  library: VentLibrary,
  slot: number,
  f: SlotFacts,
  ep: EpisodeRechargement,
  next: EpisodeRechargement | null,
  followed: string | null,
): ReplaySoundEvent[] {
  const start = ep.etapes[0].t
  const held = weaponInHand(doc, slot, start)
  const tag = held ? weaponTagOf(held.id) : null
  const life = currentLifeOf(doc, slot, start)
  const vent = tag && life ? ventAt(doc, library, tag, slot, start) : undefined
  if (!held || !life || !vent) return []
  const startMs = frameToMs(start, doc)
  // The loop is held until the later of the episode's last message and one full loop: the
  // timing of `phaseVent`, in ms.
  const loopEndMs = Math.max(frameToMs(ep.etapes[ep.etapes.length - 1].t, doc), startMs + vent.enter.durationMs + vent.loop.durationMs)
  const endMs = Math.min(
    frameToMs(trackWindow(life).end, doc),
    next ? frameToMs(next.etapes[0].t, doc) : Infinity,
    firstAt(f.shots, startMs, false),
    firstAt(f.changes, startMs, false),
    f.hands.find((h) => h.ms > startMs && h.d !== held.weaponSlot)?.ms ?? Infinity,
  )
  const cancelled = endMs < loopEndMs + vent.exit.durationMs
  const xuid = trackIdentity(doc, slot)
  const out: ReplaySoundEvent[] = []
  const phase = (clip: ReloadClip, fromMs: number) => {
    for (const s of clip.sounds) {
      const ms = fromMs + s.atMs
      if (ms >= endMs || s.stems.length === 0) continue
      const e: ReplaySoundEvent = { ms, stem: s.stems[0], gainDb: clip.gainDb }
      if (s.stems.length > 1) e.variants = s.stems
      if (cancelled) e.cutMs = endMs - ms
      const at = positionAt(life.points, msToFrames(ms, doc))
      if (at && !(followed !== null && xuid === followed)) e.at = { x: at.x, y: at.y }
      out.push(e)
    }
  }
  phase(vent.enter, startMs)
  phase(vent.loop, startMs + vent.enter.durationMs)
  phase(vent.exit, loopEndMs)
  return out
}

/** ventAt — the weapon's vent in the player's stance: crouched when the film says so and the weapon has one. */
function ventAt(doc: ReplayDocumentReady, library: VentLibrary, tag: string, slot: number, frame: number) {
  const stances = library.get(tag)
  if (!stances) return undefined
  const crouched = doc.stances.some((s) => s.kind === 'crouch' && s.slot === slot && covers(s, frame))
  return (crouched ? stances.crouch : undefined) ?? stances.combat
}
