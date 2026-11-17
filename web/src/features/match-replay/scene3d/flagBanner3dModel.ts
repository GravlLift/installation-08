// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * flagBanner3dModel.ts — THE TEAM BANNER A WEAPON ATTACHES TO ITS MODEL (the CTF flag), as the
 * weapon library index describes it (`banners`, written by the server from the flag's per-team
 * effects, `internal/weapons/banners.go`).
 *
 * The game draws the banner as long-lived single particles of the effect attached at a marker of
 * the flag model, one effect per team: a CLOTH quad (alpha blended, anchored at its edge, the first
 * image of the waving-flag sheet) and an EMBLEM quad (additive), the emblem being the layer of the
 * emblem sheet that the team's effect selects. Layer k is the emblem of team k (0 eagle, 1 cobra,
 * 2 hades, ...: the order of the effects' selectors, the order of the game's team ids). A flag of
 * no team (one-flag CTF) has the cloth only. The effects' colors are white constants: the quads
 * keep their images' colors.
 *
 * Model space, glTF axes of the weapon GLB (up = +Y). Pure functions; `flagBanner3d` builds the meshes.
 */

export type Vec3 = readonly [number, number, number]

/** One quad of a banner (see `internal/weapons.BannerLayer`). */
export interface BannerLayer {
  files: readonly string[]
  width: number
  height: number
  /** The quad's anchor in its normalized coordinates [-0.5, 0.5] (x along `across`, y up). */
  pivot: readonly [number, number]
  /** The anchor's offset from the marker. */
  offset: Vec3
  /** The direction the quad's width runs along. */
  across: Vec3
  alpha: number
  additive: boolean
}

export interface FlagBanner {
  marker: Vec3
  cloth: BannerLayer
  emblem: BannerLayer | null
}

export type BannerTable = Readonly<Record<string, FlagBanner>>

/** The model's up axis (glTF +Y), the direction a quad's height runs along. */
export const BANNER_UP: Vec3 = [0, 1, 0]

/** parseBanners reads the table out of an index document; null when the field is absent. */
export function parseBanners(doc: unknown): BannerTable | null {
  const raw = (doc as { banners?: unknown } | null)?.banners
  if (!raw || typeof raw !== 'object') return null
  const out: Record<string, FlagBanner> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const b = value as { marker?: unknown; cloth?: unknown; emblem?: unknown } | null
    const marker = vec3(b?.marker)
    const cloth = layerOf(b?.cloth)
    if (!marker || !cloth || cloth.files.length !== 1) continue
    out[key] = { marker, cloth, emblem: layerOf(b?.emblem) }
  }
  return out
}

function vec3(v: unknown): Vec3 | null {
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number') ? [v[0], v[1], v[2]] : null
}

function layerOf(v: unknown): BannerLayer | null {
  const l = v as Partial<Record<keyof BannerLayer, unknown>> | null | undefined
  const offset = vec3(l?.offset)
  const across = vec3(l?.across)
  const pivot = l?.pivot
  if (!l || !offset || !across || !Array.isArray(pivot) || pivot.length !== 2) return null
  if (typeof l.width !== 'number' || typeof l.height !== 'number' || l.width <= 0 || l.height <= 0) return null
  if (typeof l.alpha !== 'number') return null
  if (!Array.isArray(l.files) || !l.files.every((f) => typeof f === 'string')) return null
  return {
    files: l.files as string[],
    width: l.width,
    height: l.height,
    pivot: [Number(pivot[0]), Number(pivot[1])],
    offset,
    across,
    alpha: l.alpha,
    additive: l.additive === true,
  }
}

/**
 * quadCenter — the center of a layer's quad: its anchor (marker plus offset) moved by minus the
 * pivot along the width and the height.
 */
export function quadCenter(marker: Vec3, layer: BannerLayer): Vec3 {
  const out = [0, 0, 0] as [number, number, number]
  for (let i = 0; i < 3; i++) {
    out[i] = marker[i] + layer.offset[i] - layer.pivot[0] * layer.width * layer.across[i] - layer.pivot[1] * layer.height * BANNER_UP[i]
  }
  return out
}

/** emblemFileOf — the emblem image of team `team`, null for a flag of no team or a team the sheet lacks. */
export function emblemFileOf(layer: BannerLayer | null, team: number | null): string | null {
  if (!layer || team === null || !Number.isInteger(team) || team < 0 || team >= layer.files.length) return null
  return layer.files[team]
}
