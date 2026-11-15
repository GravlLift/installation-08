/**
 * perfToggles3d.ts — the 3D view's performance knobs, read from the browser console at each frame.
 *
 * `window.__it3dPerfToggles` is created with every knob at its default when a 3D scene is built;
 * flipping one (`__it3dPerfToggles.variant = false`) takes effect at the next frame, so each cost can
 * be measured alone against `window.__it3dPerf`. A missing or malformed field reads as its default:
 * the page never depends on what the console wrote.
 *
 *  - outline: the team outline's mask and line passes
 *  - ao: the ambient occlusion pass (also off when the drawer turns it off)
 *  - smaa: the antialiasing pass
 *  - postFx: every pass after the scene render (outline, ao, output, grade, smaa): the scene goes
 *    straight to the screen, tone mapped by the renderer (no AO, no grade, no SMAA)
 *  - minimap: the corner minimap (its image and its square)
 *  - map, variant: the map's and the variant layer's meshes (drawn and shadow casting)
 *  - backFaces: the dark back faces of the map's and layer's structure (`backFaces3d`)
 *  - shadows: the shadow map follows the replay (off: it keeps its last state)
 *  - shadowSplit: the static map is kept in the shadow map (`shadowSplit3d`; off: every caster each update)
 *  - labels: the HTML name tags
 *  - pixelRatio: a number forces the drawing buffer's pixel ratio; null keeps the view's own
 */

export interface PerfToggles {
  outline: boolean
  ao: boolean
  smaa: boolean
  postFx: boolean
  minimap: boolean
  map: boolean
  variant: boolean
  backFaces: boolean
  shadows: boolean
  shadowSplit: boolean
  labels: boolean
  pixelRatio: number | null
}

export const PERF_TOGGLES_DEFAULT: Readonly<PerfToggles> = Object.freeze({
  outline: true,
  ao: true,
  smaa: true,
  postFx: true,
  minimap: true,
  map: true,
  variant: true,
  backFaces: true,
  shadows: true,
  shadowSplit: true,
  labels: true,
  pixelRatio: null,
})

const FLAGS = ['outline', 'ao', 'smaa', 'postFx', 'minimap', 'map', 'variant', 'backFaces', 'shadows', 'shadowSplit', 'labels'] as const

/** The pixel ratios accepted from the console. */
const RATIO_MIN = 0.25
const RATIO_MAX = 3

/** readPerfToggles: the knobs `raw` asks for, each missing or malformed field at its default; writes into `out`. */
export function readPerfToggles(raw: unknown, out: PerfToggles): PerfToggles {
  const src = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  for (const k of FLAGS) out[k] = typeof src[k] === 'boolean' ? (src[k] as boolean) : PERF_TOGGLES_DEFAULT[k]
  const r = src.pixelRatio
  out.pixelRatio = typeof r === 'number' && Number.isFinite(r) && r >= RATIO_MIN && r <= RATIO_MAX ? r : null
  return out
}

declare global {
  interface Window {
    __it3dPerfToggles?: Partial<PerfToggles>
  }
}

/** installPerfToggles: put the knobs on `window` at their defaults, unless the console already set some. */
export function installPerfToggles(): void {
  if (typeof window === 'undefined') return
  if (typeof window.__it3dPerfToggles !== 'object' || window.__it3dPerfToggles === null) window.__it3dPerfToggles = { ...PERF_TOGGLES_DEFAULT }
}

/** currentPerfToggles: the knobs on `window` now, read into `out`. */
export function currentPerfToggles(out: PerfToggles): PerfToggles {
  return readPerfToggles(typeof window === 'undefined' ? undefined : window.__it3dPerfToggles, out)
}
