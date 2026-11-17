// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * viewGrip3d.ts — L'ARME EN 1RE PERSONNE, deux tables, par clé de modèle (`weaponModelKey`) ; une
 * arme absente de sa table prend la tenue par défaut.
 *
 * `VIEW_GRIPS` : le modèle statique. La tenue est dans le repère du cône de visée, qui part de
 * l'œil : sa droite est son -X, son haut son +Y, la visée son +Z ; `roll` tourne l'arme autour de
 * son canon (radians). C'est pourquoi la touche J (+x de la table) la déplace à l'écran vers la
 * gauche, droite du cône.
 *
 * `RIG_GRIPS` : le rig animé bras + arme (brasPremierePersonne3d). La tenue est dans le repère de
 * la caméra avant la rotation du rig : x positif = à DROITE à l'écran, y positif = EN HAUT,
 * z positif = LOIN de l'œil, `roll` = rotation autour de l'axe de la visée (radians). Les touches
 * font ce qu'elles disent à l'écran : Alt + J à gauche, L à droite, I en haut, K en bas, N vers
 * l'œil, M loin, O / P roulis.
 *
 * Réglage au clavier sur le poste de développement (useViewGripTuner), sur l'arme du joueur suivi :
 * Alt + J / L à gauche / à droite, Alt + I / K en haut / en bas, Alt + N / M vers l'œil / loin de
 * lui, Alt + O / P roulis ; Maj grossit le pas. Les touches nues J, K, L sont celles du lecteur
 * (useReplayShortcuts), Alt + U est pris par une extension du navigateur de l'utilisateur.
 *
 * Le réglage du rig est de session : il est conservé dans `localStorage`
 * (`STORAGE_RIG_GRIPS`), rechargé paresseusement ; sans `localStorage` (tests, fenêtre privée)
 * il ne survit pas au rechargement.
 */
import { persistPreference, readStoredJson } from '../settings/replayPreferences'

export interface ViewGrip {
  x: number
  y: number
  z: number
  roll: number
}

// La tenue par défaut : la moyenne des fusils réglés (Shock Rifle, Bandit, BR75).
const DEFAULT_VIEW_GRIP: ViewGrip = { x: -0.025, y: -0.088, z: 0.063, roll: 0 }

/** Les tenues réglées, par clé de modèle. */
const VIEW_GRIPS: Readonly<Record<string, ViewGrip | undefined>> = {
  '1a22fee6': { x: -0.04, y: -0.09, z: 0.05, roll: -0.244 }, // Shock Rifle
  '6acdc44d': { x: -0.02, y: -0.085, z: 0.075, roll: 0 }, // M392 Bandit
  '2b1824d5': { x: -0.015, y: -0.09, z: 0.065, roll: 0 }, // BR75
  '3e070217': { x: -0.035, y: -0.095, z: 0.02, roll: 0 }, // Vestige Carbine
  // Pas vu en main dans le match de réglage : la tenue du Bandit, à l'avis de l'utilisateur.
  'fd98554c': { x: -0.02, y: -0.085, z: 0.075, roll: 0 }, // VK78 Commando
}

// Les tenues en cours de réglage (développement), devant la table.
const tuned = new Map<string, ViewGrip>()

/** viewGripOf : la tenue du modèle `key` (la tenue par défaut sans clé ou hors table). */
export function viewGripOf(key: string | null): ViewGrip {
  if (!key) return DEFAULT_VIEW_GRIP
  return tuned.get(key) ?? VIEW_GRIPS[key] ?? DEFAULT_VIEW_GRIP
}

/** Le pas, en unités monde (1 u = 3,048 m) : 1,5 cm, 6 cm avec Maj ; le roulis : 2°, 8° avec Maj. */
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

/** viewGripStep : le déplacement d'une touche (`code` de l'événement), null hors réglage. */
export function viewGripStep(code: string, large: boolean): ViewGrip | null {
  const d = DIRECTIONS[code]
  if (!d) return null
  const s = large ? STEP_LARGE : STEP
  const r = large ? ROLL_STEP_LARGE : ROLL_STEP
  return { x: d[0] * s, y: d[1] * s, z: d[2] * s, roll: d[3] * r }
}

/** tuneViewGrip applique `step` à la tenue du modèle `key` et la rend. */
export function tuneViewGrip(key: string, step: ViewGrip): ViewGrip {
  const g = viewGripOf(key)
  const next = { x: g.x + step.x, y: g.y + step.y, z: g.z + step.z, roll: g.roll + step.roll }
  tuned.set(key, next)
  return next
}

/** formatViewGrip : la tenue telle qu'elle s'écrit dans `VIEW_GRIPS`. */
export function formatViewGrip(key: string, name: string, g: ViewGrip): string {
  const n = (v: number) => v.toFixed(3)
  return `'${key}': { x: ${n(g.x)}, y: ${n(g.y)}, z: ${n(g.z)}, roll: ${n(g.roll)} }, // ${name}`
}

// ---------------------------------------------------------------------------
// Le rig animé bras + arme : sa tenue est dans le repère de la caméra (droite +X, haut +Y,
// loin -Z), avant la rotation du rig. Les touches font ce qu'elles disent à l'écran.
// ---------------------------------------------------------------------------

const DEFAULT_RIG_GRIP: ViewGrip = { x: 0, y: 0, z: 0, roll: 0 }

/** Les tenues réglées du rig, par clé de modèle (le joueur les remplit au fur et à mesure). */
export const RIG_GRIPS: Readonly<Record<string, ViewGrip | undefined>> = {
  '0a1992bc': { x: -0.015, y: -0.015, z: -0.035, roll: 0 }, // S7 Sniper
  '1a22fee6': { x: -0.015, y: -0.015, z: 0.01, roll: 0 }, // Shock Rifle
  '2b1824d5': { x: -0.01, y: -0.005, z: -0.015, roll: 0.035 }, // BR75
  '6acdc44d': { x: -0.015, y: -0.01, z: -0.025, roll: 0 }, // M392 Bandit
}

// Les tenues en cours de réglage, devant la table ; la session est conservée dans `localStorage`.
const tunedRig = new Map<string, ViewGrip>()
const STORAGE_RIG_GRIPS = 'levelup.replay3d.rigGrips'
let rigGripsCharges = false

function chargerRigGrip(cle: string, brut: unknown): void {
  if (!brut || typeof brut !== 'object') return
  const g = brut as Partial<ViewGrip>
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  tunedRig.set(cle, { x: n(g.x), y: n(g.y), z: n(g.z), roll: n(g.roll) })
}

function chargerRigGrips(): void {
  if (rigGripsCharges) return
  rigGripsCharges = true
  const stocke = readStoredJson(STORAGE_RIG_GRIPS)
  if (!stocke || typeof stocke !== 'object') return
  for (const [cle, v] of Object.entries(stocke as Record<string, unknown>)) chargerRigGrip(cle, v)
}

function sauverRigGrips(): void {
  const tout: Record<string, ViewGrip> = {}
  for (const [k, g] of tunedRig) tout[k] = g
  persistPreference(STORAGE_RIG_GRIPS, JSON.stringify(tout))
}

/** rigGripOf : la tenue du rig du modèle `key` (réglé de session, table, puis défaut nul). */
export function rigGripOf(key: string | null): ViewGrip {
  chargerRigGrips()
  if (!key) return DEFAULT_RIG_GRIP
  return tunedRig.get(key) ?? RIG_GRIPS[key] ?? DEFAULT_RIG_GRIP
}

/** rigGripStep : le déplacement d'une touche pour le rig (signes de l'écran), null hors réglage. */
export function rigGripStep(code: string, large: boolean): ViewGrip | null {
  const d = RIG_DIRECTIONS[code]
  if (!d) return null
  const s = large ? STEP_LARGE : STEP
  const r = large ? ROLL_STEP_LARGE : ROLL_STEP
  return { x: d[0] * s, y: d[1] * s, z: d[2] * s, roll: d[3] * r }
}

// Droite de la caméra = droite à l'écran (+x), loin de l'œil = +z : les signes sont inversés
// par rapport à `DIRECTIONS` (le cône de visée a sa droite en -X et sa visée en +Z).
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

/** tuneRigGrip applique `step` à la tenue du rig du modèle `key` et la rend. */
export function tuneRigGrip(key: string, step: ViewGrip): ViewGrip {
  const g = rigGripOf(key)
  const next = { x: g.x + step.x, y: g.y + step.y, z: g.z + step.z, roll: g.roll + step.roll }
  tunedRig.set(key, next)
  sauverRigGrips()
  return next
}

/** formatRigGrip : la tenue telle qu'elle s'écrit dans `RIG_GRIPS` (syntaxe de `formatViewGrip`). */
export function formatRigGrip(key: string, name: string, g: ViewGrip): string {
  return formatViewGrip(key, name, g)
}

/** formatRigGrips : TOUTES les tenues de rig réglées, une ligne chacune, triées par clé. */
export function formatRigGrips(names: ReadonlyMap<string, string>): string {
  chargerRigGrips()
  return [...tunedRig.keys()]
    .sort()
    .map((cle) => formatRigGrip(cle, names.get(cle) ?? '', tunedRig.get(cle)!))
    .join('\n')
}
