// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shieldSound.ts — THE FOLLOWED SPARTAN'S SHIELD ALARMS, as a pure function of the frame.
 *
 * WHAT THE GAME PLAYS (Wwise events of the Spartan bank `sb_006_cfx_un_spartan`, extracted from
 * the user's install by `internal/uisounds`, never committed):
 *  - LOW: `shield_low`, a beep looping forever while the shield is low;
 *  - BREAK: `shield_break`, a loud break, then DEPLETED: `shield_depleted`, a faster beep looping
 *    while the shield is empty, until the recharge starts;
 *  - RECHARGE: `shield_recharge_2d`, an attack, a layer and one rise of a switch container the
 *    game code sets (`hud_shield_recharge`, ten rises of 0.45 to 2.3 s); its stop event cuts the
 *    rise and plays the "full" tone.
 *
 * WHEN (the bar's own transitions, `shieldHud.ts`, so the bar and the sounds never disagree):
 * a loop per state (`low`, `broken`) counted from the state's start, so a seek lands in the same
 * beat a playback would; one-shots on the transitions a PLAYBACK crosses, never on a jump.
 *
 * WHICH RISE: the files do not say which switch state the game sets. The rise picked is the one
 * whose length best matches the refill the bar shows (empty to full is 2 s, `SHIELD_RECHARGE_FULL_MS`),
 * so the rise ends with the bar. A design choice, not read from the game.
 */
import { shieldFractionAt, shieldHudAt, shieldHudTrackOf, SHIELD_RECHARGE_FULL_MS, type ShieldHudState, type ShieldHudTrack } from '../model/shieldHud'
import { buildPlayers, playerStateAt, vitalityPresence } from '../../../lib/replay/rosterLogic'
import { frameToMs } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady, ReplayTrackReady } from '../../../lib/replay/replayNormalize'

/** The followed player's shield at a frame: the life it belongs to and that life's bar. */
export interface ShieldSoundReading {
  life: ReplayTrackReady
  track: ShieldHudTrack
}

/**
 * followedShieldReader: reads the followed player's shield at a frame, null while he is dead or
 * the film carries no shield sample for that moment. The whole reader is null when no player is
 * followed, he is not in the film, or the film carries no shield at all: nothing to load or play.
 * The life's bar is built as the HUD builds it (`hud3d_logic.barreBouclier`: same points, frame
 * interval and start), once per life.
 */
export function followedShieldReader(doc: ReplayDocumentReady, xuid: string | null): ((frame: number) => ShieldSoundReading | null) | null {
  const player = xuid ? buildPlayers(doc, []).find((p) => p.xuid === xuid) : undefined
  const presence = vitalityPresence(doc)
  if (!player || !presence.shield) return null
  const tracks = new Map<ReplayTrackReady, ShieldHudTrack>()
  const frameMs = frameToMs(1, doc)
  return (frame) => {
    const state = playerStateAt(player, frame, presence)
    if (!state.alive || !state.life || !state.shield) return null
    const life = state.life
    let track = tracks.get(life)
    if (!track) tracks.set(life, (track = shieldHudTrackOf(life.points, frameMs, life.points[0]?.t)))
    return { life, track }
  }
}

/** The extracted files, in `static/sounds/halo_infinite/` (`internal/uisounds.Sounds`). */
export const SHIELD_SOUND = {
  lowLoop: 'shield_low_loop',
  brokenLoop: 'shield_depleted_loop',
  break: 'shield_break',
  rechargeStart: 'shield_recharge_start',
  rechargeLayer: 'shield_recharge_layer',
  rises: Array.from({ length: 10 }, (_, i) => `shield_recharge_rise_${i}`),
  full: 'shield_full',
  fullLayer: 'shield_full_layer',
} as const

/** Every shield stem, for the preload: a sound requested at its transition would sound late. */
export const SHIELD_SOUND_STEMS: readonly string[] = [
  SHIELD_SOUND.lowLoop, SHIELD_SOUND.brokenLoop, SHIELD_SOUND.break, SHIELD_SOUND.rechargeStart,
  SHIELD_SOUND.rechargeLayer, ...SHIELD_SOUND.rises, SHIELD_SOUND.full, SHIELD_SOUND.fullLayer,
]

export type ShieldLoop = 'low' | 'broken'

/** The loop a state plays: the low beep while low, the depleted beep while broken, else none. */
export function shieldLoopOf(state: ShieldHudState): ShieldLoop | null {
  return state === 'low' ? 'low' : state === 'broken' ? 'broken' : null
}

/** The loop at a frame and the (fractional) frame its state began, or null. */
export function shieldLoopAt(track: ShieldHudTrack, frame: number): { loop: ShieldLoop; since: number } | null {
  const { state, since } = shieldHudAt(track, frame)
  const loop = shieldLoopOf(state)
  return loop ? { loop, since } : null
}

/**
 * A one-shot of a transition: `break` (the shield empties), `recharge` (the refill starts, with
 * the refill's length), `rechargeEnd` (the refill stops: the rise is cut) and `full` (the refill
 * reached full: the rise is cut and the "full" tone plays).
 */
export type ShieldCue =
  | { kind: 'break'; frame: number }
  | { kind: 'recharge'; frame: number; fillMs: number }
  | { kind: 'rechargeEnd'; frame: number }
  | { kind: 'full'; frame: number }

/**
 * shieldCuesBetween: the one-shots of the transitions in (fromFrame, toFrame], in order. The
 * life's first entry (its start) is not a transition. Pure: the same span gives the same cues.
 */
export function shieldCuesBetween(track: ShieldHudTrack, fromFrame: number, toFrame: number): ShieldCue[] {
  const out: ShieldCue[] = []
  const tr = track.transitions
  for (let i = 1; i < tr.length; i++) {
    const { frame, state } = tr[i]
    if (frame <= fromFrame) continue
    if (frame > toFrame) break
    if (tr[i - 1].state === 'recharging') out.push({ kind: state === 'full' ? 'full' : 'rechargeEnd', frame })
    if (state === 'broken') out.push({ kind: 'break', frame })
    if (state === 'recharging') out.push({ kind: 'recharge', frame, fillMs: Math.max(0, 1 - shieldFractionAt(track, frame)) * SHIELD_RECHARGE_FULL_MS })
  }
  return out
}

/** The silence after a rise's last sound (measured: 0.15 to 0.21 s); the rise SOUNDS that much shorter. */
export const SHIELD_RISE_TAIL_MS = 180

/**
 * pickRechargeRise: the rise whose sounding length (file length less its tail) is closest to the
 * refill; `durationsMs[i]` is rise i's file length, undefined when it is not loaded. -1 when none is.
 */
export function pickRechargeRise(fillMs: number, durationsMs: readonly (number | undefined)[]): number {
  let best = -1
  let gap = Number.POSITIVE_INFINITY
  durationsMs.forEach((d, i) => {
    if (d === undefined) return
    const g = Math.abs(d - SHIELD_RISE_TAIL_MS - fillMs)
    if (g < gap) [best, gap] = [i, g]
  })
  return best
}

/** loopOffsetS: where a loop of `durationS` stands `elapsedMs` after its state began. */
export function loopOffsetS(elapsedMs: number, durationS: number): number {
  return durationS > 0 ? (Math.max(0, elapsedMs) / 1000) % durationS : 0
}
