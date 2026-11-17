// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * viewGrip3d.ts — THE FIRST-PERSON WEAPON, two tables, by model key (`weaponModelKey`); a weapon
 * absent from its table takes the default grip.
 *
 * `VIEW_GRIPS`: the static model. The grip is in the aim cone's frame, which starts at the eye:
 * its right is its -X, its up its +Y, its aim its +Z; `roll` rotates the weapon around its
 * barrel (radians). That is why the J key (the table's +x) moves it on screen to the left, the
 * cone's right.
 *
 * `RIG_GRIPS`: the animated arms+weapon rig (`FirstPersonArms3d`). The grip is in the camera's
 * frame before the rig's rotation: positive x = to the RIGHT on screen, positive y = UP,
 * positive z = AWAY from the eye, `roll` = rotation around the aim axis (radians). The keys do
 * what they say on screen: Alt + J left, L right, I up, K down, N toward the eye, M away, O / P roll.
 *
 * Keyboard tuning on the dev workstation (useViewGripTuner), on the tracked player's weapon:
 * Alt + J / L left / right, Alt + I / K up / down, Alt + N / M toward / away from the eye,
 * Alt + O / P roll; Shift enlarges the step. The bare J, K, L keys belong to the viewer
 * (useReplayShortcuts), Alt + U is taken by a browser extension of the user's.
 *
 * The rig's tuning is per-session: it is kept in `localStorage`
 * (`STORAGE_RIG_GRIPS`), loaded lazily; with no `localStorage` (tests, a private window)
 * it does not survive a reload.
 */
import { persistPreference, readStoredJson } from '../settings/replayPreferences'

export interface ViewGrip {
  x: number
  y: number
  z: number
  roll: number
}

// The default grip: the average of the tuned rifles (Shock Rifle, Bandit, BR75).
const DEFAULT_VIEW_GRIP: ViewGrip = { x: -0.025, y: -0.088, z: 0.063, roll: 0 }

/** The tuned grips, by model key. */
const VIEW_GRIPS: Readonly<Record<string, ViewGrip | undefined>> = {
  '1a22fee6': { x: -0.04, y: -0.09, z: 0.05, roll: -0.244 }, // Shock Rifle
  '6acdc44d': { x: -0.02, y: -0.085, z: 0.075, roll: 0 }, // M392 Bandit
  '2b1824d5': { x: -0.015, y: -0.09, z: 0.065, roll: 0 }, // BR75
  '3e070217': { x: -0.035, y: -0.095, z: 0.02, roll: 0 }, // Vestige Carbine
  // Not seen in hand in the tuning match: the Bandit's grip, by the user's judgment.
  'fd98554c': { x: -0.02, y: -0.085, z: 0.075, roll: 0 }, // VK78 Commando
}

// The grips currently being tuned (development), ahead of the table.
const tuned = new Map<string, ViewGrip>()

/** viewGripOf: model `key`'s grip (the default grip with no key or outside the table). */
export function viewGripOf(key: string | null): ViewGrip {
  if (!key) return DEFAULT_VIEW_GRIP
  return tuned.get(key) ?? VIEW_GRIPS[key] ?? DEFAULT_VIEW_GRIP
}

/** The step, in world units (1 u = 3.048 m): 1.5cm, 6cm with Shift; the roll: 2°, 8° with Shift. */
const STEP = 0.005
const STEP_LARGE = 0.02
const ROLL_STEP = Math.PI / 90
const ROLL_STEP_LARGE = Math.PI / 22.5

const DIRECTIONS: Record<string, readonly [number, number, number, number] | undefined> = {
  KeyJ: [1, 0, 0, 0],
  KeyL: [-1, 0, 0, 0],
  KeyI: [0, 1, 0, 0],
  KeyK: [0, -1, 0, 0],
  KeyN: [0, 0, -1, 0],
  KeyM: [0, 0, 1, 0],
  KeyO: [0, 0, 0, 1],
  KeyP: [0, 0, 0, -1],
}

/** viewGripStep: a key's movement (the event's `code`), null outside tuning. */
export function viewGripStep(code: string, large: boolean): ViewGrip | null {
  const d = DIRECTIONS[code]
  if (!d) return null
  const s = large ? STEP_LARGE : STEP
  const r = large ? ROLL_STEP_LARGE : ROLL_STEP
  return { x: d[0] * s, y: d[1] * s, z: d[2] * s, roll: d[3] * r }
}

/** tuneViewGrip applies `step` to model `key`'s grip and returns it. */
export function tuneViewGrip(key: string, step: ViewGrip): ViewGrip {
  const g = viewGripOf(key)
  const next = { x: g.x + step.x, y: g.y + step.y, z: g.z + step.z, roll: g.roll + step.roll }
  tuned.set(key, next)
  return next
}

/** formatViewGrip: the grip written the way it appears in `VIEW_GRIPS`. */
export function formatViewGrip(key: string, name: string, g: ViewGrip): string {
  const n = (v: number) => v.toFixed(3)
  return `'${key}': { x: ${n(g.x)}, y: ${n(g.y)}, z: ${n(g.z)}, roll: ${n(g.roll)} }, // ${name}`
}

// ---------------------------------------------------------------------------
// The animated arms+weapon rig: its grip is in the camera's frame (right +X, up +Y,
// away -Z), before the rig's rotation. The keys do what they say on screen.
// ---------------------------------------------------------------------------

const DEFAULT_RIG_GRIP: ViewGrip = { x: 0, y: 0, z: 0, roll: 0 }

/** The rig's tuned grips, by model key (the player fills them in over time). */
export const RIG_GRIPS: Readonly<Record<string, ViewGrip | undefined>> = {
  '0a1992bc': { x: -0.015, y: -0.015, z: -0.035, roll: 0 }, // S7 Sniper
  '1a22fee6': { x: -0.015, y: -0.015, z: 0.01, roll: 0 }, // Shock Rifle
  '2b1824d5': { x: -0.01, y: -0.005, z: -0.015, roll: 0.035 }, // BR75
  '6acdc44d': { x: -0.015, y: -0.01, z: -0.025, roll: 0 }, // M392 Bandit
}

// The grips currently being tuned, ahead of the table; the session is kept in `localStorage`.
const tunedRig = new Map<string, ViewGrip>()
const STORAGE_RIG_GRIPS = 'levelup.replay3d.rigGrips'
let rigGripsLoaded = false

function loadRigGrip(key: string, raw: unknown): void {
  if (!raw || typeof raw !== 'object') return
  const g = raw as Partial<ViewGrip>
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  tunedRig.set(key, { x: n(g.x), y: n(g.y), z: n(g.z), roll: n(g.roll) })
}

function loadRigGrips(): void {
  if (rigGripsLoaded) return
  rigGripsLoaded = true
  const stored = readStoredJson(STORAGE_RIG_GRIPS)
  if (!stored || typeof stored !== 'object') return
  for (const [key, v] of Object.entries(stored as Record<string, unknown>)) loadRigGrip(key, v)
}

function saveRigGrips(): void {
  const all: Record<string, ViewGrip> = {}
  for (const [k, g] of tunedRig) all[k] = g
  persistPreference(STORAGE_RIG_GRIPS, JSON.stringify(all))
}

/** rigGripOf: the rig's grip for model `key` (session tuning, table, then null default). */
export function rigGripOf(key: string | null): ViewGrip {
  loadRigGrips()
  if (!key) return DEFAULT_RIG_GRIP
  return tunedRig.get(key) ?? RIG_GRIPS[key] ?? DEFAULT_RIG_GRIP
}

/** rigGripStep: a key's movement for the rig (screen-space signs), null outside tuning. */
export function rigGripStep(code: string, large: boolean): ViewGrip | null {
  const d = RIG_DIRECTIONS[code]
  if (!d) return null
  const s = large ? STEP_LARGE : STEP
  const r = large ? ROLL_STEP_LARGE : ROLL_STEP
  return { x: d[0] * s, y: d[1] * s, z: d[2] * s, roll: d[3] * r }
}

// Camera right = screen right (+x), away from the eye = +z: the signs are inverted
// relative to `DIRECTIONS` (the aim cone has its right at -X and its aim at +Z).
const RIG_DIRECTIONS: Record<string, readonly [number, number, number, number] | undefined> = {
  KeyJ: [-1, 0, 0, 0],
  KeyL: [1, 0, 0, 0],
  KeyI: [0, 1, 0, 0],
  KeyK: [0, -1, 0, 0],
  KeyN: [0, 0, -1, 0],
  KeyM: [0, 0, 1, 0],
  KeyO: [0, 0, 0, 1],
  KeyP: [0, 0, 0, -1],
}

/** tuneRigGrip applies `step` to the rig's grip for model `key` and returns it. */
export function tuneRigGrip(key: string, step: ViewGrip): ViewGrip {
  const g = rigGripOf(key)
  const next = { x: g.x + step.x, y: g.y + step.y, z: g.z + step.z, roll: g.roll + step.roll }
  tunedRig.set(key, next)
  saveRigGrips()
  return next
}

/** formatRigGrip: the grip written the way it appears in `RIG_GRIPS` (`formatViewGrip`'s syntax). */
export function formatRigGrip(key: string, name: string, g: ViewGrip): string {
  return formatViewGrip(key, name, g)
}

/** formatRigGrips: ALL the tuned rig grips, one line each, sorted by key. */
export function formatRigGrips(names: ReadonlyMap<string, string>): string {
  loadRigGrips()
  return [...tunedRig.keys()]
    .sort()
    .map((key) => formatRigGrip(key, names.get(key) ?? '', tunedRig.get(key)!))
    .join('\n')
}
