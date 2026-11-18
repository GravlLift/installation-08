// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * armorCoat3d.ts — PAINTING AN OUTFIT FOR A PLAYER: for every painted material of their outfit
 * (raw masks in `userData.armorMaps`, style in `userData.style`, `armorLibrary3d`), the paint of
 * its coating and visor (`armorCoating3d.paintOf`), packed for shaders (`armorMaterial3d.packPaint`),
 * its gradients loaded into the session's layered texture (`armorGradients3d`). `spartan3d` paints
 * its copies with it.
 *
 * The core (`paintMaterials`) paints materials for ONE given table and ONE given coating: a
 * player's outfit goes through it with their visor, weapons (`weaponCoat3d`) with their library's
 * table and no visor.
 *
 * Named fallbacks, reported ONCE per player to the console: unreadable table (everything neutral),
 * coating missing from the library (default style of each list), gradient not loaded (neutral),
 * and those from `armorCoating3d`.
 */
import * as THREE from 'three'

import type { SpartanArmorManifest } from '@/lib/replay/spartanArmor'

import {
  neutralPaint,
  paintOf,
  visorSwatch,
  type CoatingFile,
  type CoatingSwatch,
  type CoatingTable,
  type MaterialStyle,
  type PaintIssueKind,
  type PaintNote,
} from './armorCoating3d'
import type { GradientAtlas } from './armorGradients3d'
import { gradientsOf, packPaint, type ArmorMaps, type PackedPaint } from './armorMaterial3d'
import type { Outfit } from './armory3d'

/** The paint of one source material of the outfit, for a player. */
export interface CoatPaint {
  maps: ArmorMaps
  paint: PackedPaint
  /** The session's shared gradient uniform. */
  gradients: THREE.IUniform<THREE.Texture>
}

/** The paint of a player's outfit, by source material (the ones the library has). */
export type Coat = ReadonlyMap<THREE.Material, CoatPaint>

/** A counted fallback in a player's paint. */
export interface CoatIssue {
  kind: PaintIssueKind
  what: string
  count: number
}

/** What the paint reads from the library (`ArmorLibrary`). */
export interface CoatSource {
  coatings(): Promise<CoatingTable | null>
  coating(key: string): Promise<CoatingFile | null>
  /** swatch loads gradient `id` into `gradients`; returns its layer, null if it fails to load. */
  swatch(id: string): Promise<number | null>
  readonly gradients: GradientAtlas
}

/** paintedMaterials: the outfit's materials the view paints (raw masks loaded), each once. */
export function paintedMaterials(outfit: Outfit): THREE.Material[] {
  const out = new Set<THREE.Material>()
  const add = (m: THREE.Material | THREE.Material[]) => {
    for (const x of Array.isArray(m) ? m : [m]) if (x.userData.armorMaps) out.add(x)
  }
  for (const s of outfit.skinned) add(s.material)
  for (const r of outfit.rigid) for (const { mesh } of r.meshes) add(mesh.material)
  return [...out]
}

/**
 * buildCoat paints the `outfit` of the player with manifest `m`; returns the paint and its
 * fallbacks (counted by kind and target).
 */
export async function buildCoat(outfit: Outfit, m: SpartanArmorManifest, lib: CoatSource): Promise<{ coat: Coat; issues: CoatIssue[] }> {
  return buildMaterialsCoat(paintedMaterials(outfit), m, lib)
}

export async function buildMaterialsCoat(materials: readonly THREE.Material[], m: SpartanArmorManifest, lib: CoatSource): Promise<{ coat: Coat; issues: CoatIssue[] }> {
  const counts = new Map<string, CoatIssue>()
  const note: PaintNote = (kind, what) => {
    const k = `${kind} ${what}`
    const e = counts.get(k)
    if (e) e.count++
    else counts.set(k, { kind, what, count: 1 })
  }
  const table = await lib.coatings()
  const key = m.coating?.style_key
  const coating = table && key ? await lib.coating(key) : null
  if (!table) note('coatings_unavailable', '')
  else if (!coating) note('coating_unknown', key ?? m.coating?.path ?? '')
  const visor = table ? visorSwatch(table, m.visor, note) : null
  const coat = await paintMaterials(materials, table, { coating, visor }, lib, note)
  return { coat, issues: [...counts.values()] }
}

/**
 * paintMaterials: the core of the paint pass — `materials` painted for `table` (null: everything
 * neutral) and the player's paint (their coating, null absent, their visor, null none).
 */
export async function paintMaterials(
  materials: readonly THREE.Material[],
  table: CoatingTable | null,
  playerPaint: { coating: CoatingFile | null; visor: CoatingSwatch | null },
  lib: Pick<CoatSource, 'swatch' | 'gradients'>,
  note: PaintNote,
): Promise<Coat> {
  const coat = new Map<THREE.Material, CoatPaint>()
  await Promise.all(
    materials.map(async (mat) => {
      const style = (mat.userData.style as MaterialStyle | undefined) ?? null
      const paint = table ? paintOf(style, { table, coating: playerPaint.coating, visor: playerPaint.visor }, note) : neutralPaint()
      await Promise.all(gradientsOf(paint).map((g) => lib.swatch(g)))
      const packed = packPaint(paint, (g) => lib.gradients.layer(g), note)
      coat.set(mat, { maps: mat.userData.armorMaps as ArmorMaps, paint: packed, gradients: lib.gradients.uniform })
    }),
  )
  return coat
}

/** reportCoat logs a player's paint once: coating, visor, and each counted fallback. */
export function reportCoat(xuid: string, m: SpartanArmorManifest, coat: Coat, issues: readonly CoatIssue[]): void {
  const log = issues.length > 0 ? console.warn : console.info
  log(
    `3D replay: coating ${xuid} (${m.coating?.style_key ?? 'none'}, visor ${m.visor?.visor_id ?? '-'}/${m.visor?.color_variant ?? '-'}): ` +
      `${coat.size} materials painted, ${issues.length} fallbacks`,
    issues.map((i) => `${i.kind} ${i.what} ×${i.count}`),
  )
}
