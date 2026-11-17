// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * renderProfile3d.ts — the scene frame's script time, step by step.
 *
 * The loop marks the end of each step; each duration feeds a smoothed average, with no
 * allocation. The cadence reader rereads the profile a few times per second.
 */

/** A frame's steps, in the order `render` chains them (short codes, shown as-is). */
export const ETAPES_PROFIL = ['av', 'act', 'cam', 'shd', 'draw', 'lbl'] as const

export interface ProfilRendu {
  /** Each step's smoothed duration, in milliseconds, in `ETAPES_PROFIL`'s order. */
  ms: Float32Array
  /** The last frame's draw calls and triangles, across every pass. */
  appels: number
  triangles: number
  /** The renderer's live geometries and textures (`renderer.info.memory`). */
  geometries: number
  textures: number
  /** The drawing buffer: pixel ratio and size in device pixels. */
  pixelRatio: number
  width: number
  height: number
  /** What each pass drew at the last frame: the shadow updates, the composer's passes (the scene without its shadows), the minimap. */
  passes: Record<PassCostName, { calls: number; triangles: number }>
  /** The GPU time of the last measured frame's draws (ms, smoothed); null without a GPU timer. */
  gpuMs: number | null
  /** The GPU time of the bloom pass alone (ms, smoothed, timed every other frame); null with bloom off or without a GPU timer. */
  bloomGpuMs: number | null
}

/** The passes the profile breaks the draws into. */
export const PASS_COST_NAMES = ['shadow', 'scene', 'outlineMask', 'ao', 'bloom', 'output', 'grade', 'smaa', 'outlineLine', 'minimap'] as const
export type PassCostName = (typeof PASS_COST_NAMES)[number]

const SMOOTHING = 0.1

export function nouveauProfil(): ProfilRendu {
  return { ms: new Float32Array(ETAPES_PROFIL.length), appels: 0, triangles: 0, geometries: 0, textures: 0, pixelRatio: 1, width: 0, height: 0, passes: Object.fromEntries(PASS_COST_NAMES.map((n) => [n, { calls: 0, triangles: 0 }])) as ProfilRendu['passes'], gpuMs: null, bloomGpuMs: null }
}

/** marquer closes step `step` started at `start` (ms) and returns the closing instant, the start of the next one. */
export function marquer(profile: ProfilRendu, step: number, start: number): number {
  const end = performance.now()
  profile.ms[step] += (end - start - profile.ms[step]) * SMOOTHING
  return end
}

/** formaterProfil: a line "av 1.2 · act 0.4 · ... · 812 calls · 1.9M tri". */
export function formaterProfil(profile: ProfilRendu): string {
  const steps = ETAPES_PROFIL.map((name, i) => `${name} ${profile.ms[i].toFixed(1)}`).join(' · ')
  return `${steps} · ${profile.appels} calls · ${(profile.triangles / 1e6).toFixed(2)}M tri`
}
