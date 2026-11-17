// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * recoil3d.ts — WEAPON RECOIL ON FIRE: what the drawn weapon does on every shot.
 *
 * The game's fire clip barely moves anything (the index finger on the trigger): the engine adds
 * recoil through a spring. Here, recoil is a FUNCTION OF THE FRAME: at frame `f`, the weapon's
 * deviation is the sum of the shooter's recent shots' responses, each depending only on its age.
 * No clock: rewinding, pausing or jumping in the replay returns the same deviation at the same
 * frame.
 *
 * A shot's response (`recoilShape`): an attack of about one frame at 60 Hz (`RECOIL_ATTACK`),
 * then a damped spring return that dips a little below rest and reaches it exactly at the end of
 * its window (the profile's `recovery`). Shots sum together, softened past one shot (`soften`):
 * automatic fire becomes a small held shake, never a drift.
 *
 * The deviation is in the weapon model's frame (X barrel, Y up, origin at the grip): `back`
 * pulls the weapon back along the barrel, `pitch` lifts the muzzle, `yaw` and `roll` are a small
 * noise drawn from each shot's seed (a burst does not repeat). `recoilPose3d` applies it to the
 * weapon and the arms.
 */

/** A weapon's recoil family; `none`: a melee weapon, it does not recoil. */
export type RecoilKind = 'precision' | 'automatic' | 'heavy' | 'energy' | 'none'

export interface RecoilProfile {
  /** The recoil along the barrel at a shot's peak (u; 1 u ~ 3 m). */
  kick: number
  /** The muzzle lift at a shot's peak (radians). */
  pitch: number
  /** The amplitude of a shot's yaw and roll noise (radians). */
  jitter: number
  /** How long it takes to return to rest after the attack (s). */
  recovery: number
}

const deg = (d: number) => (d * Math.PI) / 180

/** Each family's recoil profile: the only recoil settings. */
export const RECOIL_PROFILES: Readonly<Record<RecoilKind, RecoilProfile>> = {
  // Precision rifles and pistols: a crisp, clearly readable kick.
  precision: { kick: 0.012, pitch: deg(3), jitter: deg(0.6), recovery: 0.12 },
  // Automatics: small, fast kicks.
  automatic: { kick: 0.006, pitch: deg(1.2), jitter: deg(0.8), recovery: 0.08 },
  // Shotgun, sniper, rocket launcher and other heavy weapons: a hard shove.
  heavy: { kick: 0.024, pitch: deg(6), jitter: deg(1), recovery: 0.15 },
  // Plasma and energy weapons: lighter.
  energy: { kick: 0.004, pitch: deg(0.9), jitter: deg(0.5), recovery: 0.09 },
  none: { kick: 0, pitch: 0, jitter: 0, recovery: 0 },
}

/** A shot's attack: one frame at 60 Hz. */
export const RECOIL_ATTACK = 1 / 60
// The return spring: cos(π u) (1 - u)², u from 0 to 1 over the window: it dips below rest halfway
// (about 6% overshoot) and reaches rest at zero slope.
const SPRING_TURNS = Math.PI
// Each shot varies in strength around its profile (± AMPLITUDE_SPREAD), from the shot's seed.
const AMPLITUDE_SPREAD = 0.15
// The sum of shots is untouched up to RECOIL_KNEE peak shots, then softens without ever passing
// RECOIL_CAP: under continuous fire, the weapon holds a bounded shake.
export const RECOIL_KNEE = 1 + AMPLITUDE_SPREAD
export const RECOIL_CAP = 1.8

/** Recoil family by a weapon label's stable key (see `weaponClass3d`); precision by default. */
const KIND_BY_KEY: Readonly<Record<string, RecoilKind>> = {
  hinf_br75: 'precision',
  hinf_vk78_commando: 'precision',
  hinf_bandit: 'precision',
  hinf_sidekick: 'precision',
  hinf_vestige_carbine: 'precision',
  hinf_ma40_ar: 'automatic',
  hinf_ma5k_avenger: 'automatic',
  hinf_turret_machinegun: 'automatic',
  hinf_cqs48_bulldog: 'heavy',
  hinf_heatwave: 'heavy',
  hinf_mangler: 'heavy',
  hinf_s7_sniper: 'heavy',
  hinf_m41_spnkr: 'heavy',
  hinf_skewer: 'heavy',
  hinf_hydra: 'heavy',
  hinf_cindershot: 'heavy',
  hinf_fuel_rod_spnkr: 'heavy',
  hinf_plasma_pistol: 'energy',
  hinf_needler: 'energy',
  hinf_disruptor: 'energy',
  hinf_pulse_carbine: 'energy',
  hinf_sentinel_beam: 'energy',
  hinf_shock_rifle: 'energy',
  hinf_stalker_rifle: 'energy',
  hinf_ravager: 'energy',
  hinf_turret_plasma: 'energy',
  hinf_energy_sword: 'none',
  hinf_gravity_hammer: 'none',
}

/** recoilKindOfKey: a weapon's recoil family by its label's key. */
export function recoilKindOfKey(key: string | undefined): RecoilKind {
  return (key !== undefined && KIND_BY_KEY[key]) || 'precision'
}

/**
 * recoilShape: a shot's response `age` seconds after firing (1 at peak), for a return of
 * `recovery` seconds: 0 before the shot, rising during `RECOIL_ATTACK`, a damped spring
 * afterward, exactly 0 as soon as the window ends.
 */
export function recoilShape(age: number, recovery: number): number {
  if (age < 0 || age >= RECOIL_ATTACK + recovery) return 0
  if (age < RECOIL_ATTACK) {
    const x = age / RECOIL_ATTACK
    return 1 - (1 - x) * (1 - x)
  }
  const u = (age - RECOIL_ATTACK) / recovery
  return Math.cos(SPRING_TURNS * u) * (1 - u) * (1 - u)
}

/** recoilWindow: how long (s) a shot of the profile still counts. */
export function recoilWindow(profile: RecoilProfile): number {
  return profile.recovery > 0 ? RECOIL_ATTACK + profile.recovery : 0
}

/**
 * soften: a sum of shots (in peak-shot units) as the weapon carries it: untouched up to
 * `RECOIL_KNEE`, then softened toward `RECOIL_CAP`, same sign.
 */
export function soften(x: number): number {
  const a = Math.abs(x)
  if (a <= RECOIL_KNEE) return x
  const room = RECOIL_CAP - RECOIL_KNEE
  return Math.sign(x) * (RECOIL_KNEE + room * Math.tanh((a - RECOIL_KNEE) / room))
}

/** A weapon's deviation at a frame, in the weapon model's frame (see the header). */
export interface Recoil {
  back: number
  pitch: number
  yaw: number
  roll: number
}

export function newRecoil(): Recoil {
  return { back: 0, pitch: 0, yaw: 0, roll: 0 }
}

/** clearRecoil: the weapon at rest. */
export function clearRecoil(out: Recoil): Recoil {
  out.back = 0
  out.pitch = 0
  out.yaw = 0
  out.roll = 0
  return out
}

/** recoilActive: the deviation is not at rest. */
export function recoilActive(r: Recoil | null | undefined): r is Recoil {
  return !!r && (r.back !== 0 || r.pitch !== 0 || r.yaw !== 0 || r.roll !== 0)
}

/**
 * signedHash: a number in [-1, 1) drawn from seed `seed` and channel `channel` (integer mix, the
 * same as `muzzleFlash3d`'s spray: neighboring seeds are unrelated). Copied rather than imported:
 * this module stays dependency-free, and the avatar imports it.
 */
function signedHash(seed: number, channel: number): number {
  let h = Math.floor(seed * 7 + channel) | 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h ^= h >>> 16
  return (2 * (h >>> 0)) / 4294967296 - 1
}

/**
 * recoilAt writes into `out` the deviation at frame `frame` for the shooter whose shots are at
 * frames `frames[from..to)` (sorted), with seeds `seeds`, at `fps` frames per second, for profile
 * `profile`.
 */
export function recoilAt(
  shots: { frames: ArrayLike<number>; seeds: ArrayLike<number>; from: number; to: number },
  frame: number,
  fps: number,
  profile: RecoilProfile,
  out: Recoil,
): Recoil {
  let kick = 0
  let yaw = 0
  let roll = 0
  for (let i = shots.from; i < shots.to; i++) {
    const s = recoilShape((frame - shots.frames[i]) / fps, profile.recovery)
    if (s === 0) continue
    const seed = shots.seeds[i]
    kick += s * (1 + AMPLITUDE_SPREAD * signedHash(seed, 0))
    yaw += s * signedHash(seed, 1)
    roll += s * signedHash(seed, 2)
  }
  const k = soften(kick)
  out.back = profile.kick * k
  out.pitch = profile.pitch * k
  out.yaw = profile.jitter * soften(yaw)
  out.roll = profile.jitter * soften(roll)
  return out
}
