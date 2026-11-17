// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * armorPlan3d.ts — WHAT MUST BE LOADED TO DRESS A PLAYER: a pure function of their armor
 * manifest (`lib/replay/spartanArmor`) and the piece library's index (contract written at the
 * top of `meshproto/pieces_index.go`, server side).
 *
 * The manifest carries the FINAL SELECTION (one permutation per region, resolved by the
 * server in the game's order: theme base, pieces, build, prosthetics). The plan does not redo
 * it: it only reads each region's piece from it, in the order of those stages (`stageOf`),
 * then picks the marker instance of each accessory.
 *
 * Fallback rules, all named in `issues` (never a silent substitution):
 *   - a piece whose build failed (`failures` in the index): the player's own core base
 *     permutation for that region, else the default armor's (`DEFAULT_CORE`), else nothing;
 *     a piece the view fails to load follows the same fallback (`fallback`);
 *   - a key missing from the index and outside the failures: the permutation has no section,
 *     it draws nothing (the index's own contract); listed in `empty`, not a default;
 *   - an accessory unresolved, missing from the library, without a marker or without an
 *     instance: not placed.
 */
import type { SpartanArmorManifest } from '@/lib/replay/spartanArmor'

/** A pose (glTF axes, game units): translation, then rotation (quaternion x, y, z, w). */
export interface ArmorPose {
  translation: [number, number, number]
  rotation: [number, number, number, number]
}

/** The library's index (`meshproto.IndexPieces`, schema `ARMOR_INDEX_SCHEMA`). */
export interface ArmorIndex {
  schema: number
  skeleton: { bones: string[]; root: number }
  pieces: { key: string; region: string; permutation: string; file: string; triangles: number }[]
  attachments: { key: string; tag: string; entry: number; file: string; triangles: number; marker: string; offset: ArmorPose }[]
  markers: { name: string; instances: (ArmorPose & { region: string; permutation: string; bone: string; node: number })[] }[]
  themes: { name: string; ocur: string; permutation: string; read: boolean; base_regions: { region: string; permutation: string }[] }[]
  failures: { key: string; reason: string }[]
}

/** The index version the view knows how to read (`meshproto.SchemaPieces`). */
export const ARMOR_INDEX_SCHEMA = 2
/** The default armor's own core permutation (Mark VII, that of the `spartan` model). */
export const DEFAULT_CORE = '13d24f1f'

/** A skinned piece to load, and its fallback if it fails to load. */
export interface PlannedPiece {
  key: string
  file: string
  region: string
  /** The manifest stage that set the permutation (`theme`, `helmet`, `body_type`...). */
  source: string
  fallback: { key: string; file: string; from: 'core' | 'default' } | null
}

/** A rigid accessory entry, placed at its chosen marker instance. */
export interface PlannedAttachment {
  key: string
  file: string
  slot: string
  tag: string
  /** The instance's parent bone (empty: the model's own frame). */
  bone: string
  instance: ArmorPose
  offset: ArmorPose
}

export type OutfitIssueKind =
  | 'piece_build_failed'
  | 'piece_no_fallback'
  | 'manifest_unresolved'
  | 'attachment_unresolved'
  | 'attachment_absent'
  | 'marker_absent'
  | 'marker_instance_absent'
  // At load time (`armory3d`): piece not loaded (fallback placed), bones differ from the index, accessory not loaded.
  | 'piece_load_failed'
  | 'piece_bones_mismatch'
  | 'attachment_load_failed'

/** What a player's armor is not wearing as the manifest says, named. */
export interface OutfitIssue {
  kind: OutfitIssueKind
  /** The piece key, object path, or tag involved. */
  what: string
  detail: string
}

export interface OutfitPlan {
  pieces: PlannedPiece[]
  attachments: PlannedAttachment[]
  /** Regions whose permutation draws nothing (key missing from the index, outside the failures). */
  empty: string[]
  issues: OutfitIssue[]
}

/** pieceKey: a piece's key (`meshproto.ClePiece`). */
export function pieceKey(region: string, permutation: string): string {
  return `${region}-${permutation}`
}

/** variantKey: the hexadecimal form (8 digits, unsigned 32 bits) of a signed identifier. */
export function variantKey(id: number): string {
  return (id >>> 0).toString(16).padStart(8, '0')
}

/** The manifest stages, in the order the server applies them. */
const STAGES = ['theme', 'helmet', 'gloves', 'knee_pads', 'left_shoulder_pad', 'right_shoulder_pad', 'body_type']
const PROSTHETIC = 'prosthetic_'

/** stageOf: the rank of stage `source` (prosthetics last, unknown stage before them). */
export function stageOf(source: string): number {
  if (source.startsWith(PROSTHETIC)) return STAGES.length + 1
  const i = STAGES.indexOf(source)
  return i < 0 ? STAGES.length : i
}

/** What the index knows, as tables. */
interface IndexTables {
  files: Map<string, string>
  failed: Map<string, string>
  base: (permutation: string) => Map<string, string> | null
}

function tablesOf(index: ArmorIndex): IndexTables {
  const bases = new Map(index.themes.filter((t) => t.read).map((t) => [t.permutation, t.base_regions]))
  return {
    files: new Map(index.pieces.map((p) => [p.key, p.file])),
    failed: new Map(index.failures.map((f) => [f.key, f.reason])),
    base: (permutation) => {
      const regions = bases.get(permutation)
      return regions ? new Map(regions.map((r) => [r.region, r.permutation])) : null
    },
  }
}

/** planOutfit: the pieces and accessories of armor `m` within library `index`. */
export function planOutfit(m: SpartanArmorManifest, index: ArmorIndex): OutfitPlan {
  const t = tablesOf(index)
  const plan: OutfitPlan = { pieces: [], attachments: [], empty: [], issues: [] }
  for (const path of m.unresolved ?? []) plan.issues.push({ kind: 'manifest_unresolved', what: path, detail: 'not resolved by the server' })
  const regions = [...m.regions].sort((a, b) => stageOf(a.source) - stageOf(b.source))
  const core = t.base(variantKey(m.variant_id))
  const byDefault = t.base(DEFAULT_CORE)
  for (const r of regions) {
    const key = pieceKey(r.region_key, r.permutation_key)
    const fallback = fallbackFor(r.region_key, key, t, core, byDefault)
    const failed = t.failed.get(key)
    if (failed !== undefined) {
      plan.issues.push({ kind: 'piece_build_failed', what: key, detail: failed })
      if (fallback) plan.pieces.push({ key: fallback.key, file: fallback.file, region: r.region_key, source: r.source, fallback: null })
      else plan.issues.push({ kind: 'piece_no_fallback', what: key, detail: 'no fallback piece for the region' })
      continue
    }
    const file = t.files.get(key)
    if (file === undefined) {
      plan.empty.push(key)
      continue
    }
    plan.pieces.push({ key, file, region: r.region_key, source: r.source, fallback })
  }
  const selection = new Map(m.regions.map((r) => [r.region_key, r.permutation_key]))
  for (const a of m.attachments) planAttachment(a, index, selection, plan)
  return plan
}

/** fallbackFor: a region's fallback piece (core base, then default armor), other than `key`. */
function fallbackFor(
  region: string,
  key: string,
  t: IndexTables,
  core: Map<string, string> | null,
  byDefault: Map<string, string> | null,
): PlannedPiece['fallback'] {
  for (const [from, base] of [['core', core], ['default', byDefault]] as const) {
    const permutation = base?.get(region)
    if (permutation === undefined) continue
    const k = pieceKey(region, permutation)
    const file = t.files.get(k)
    if (k !== key && file !== undefined && !t.failed.has(k)) return { key: k, file, from }
  }
  return null
}

function planAttachment(
  a: SpartanArmorManifest['attachments'][number],
  index: ArmorIndex,
  selection: ReadonlyMap<string, string>,
  plan: OutfitPlan,
): void {
  if (!a.resolved || !a.tag_key) {
    plan.issues.push({ kind: 'attachment_unresolved', what: a.path, detail: a.slot })
    return
  }
  const tag = a.tag_key
  const entries = index.attachments.filter((e) => e.tag === tag)
  if (entries.length === 0) {
    const failed = index.failures.find((f) => f.key === tag || f.key.startsWith(`${tag}-`))
    plan.issues.push({ kind: 'attachment_absent', what: tag, detail: failed ? failed.reason : `${a.slot} ${a.path}` })
    return
  }
  for (const e of entries) {
    const marker = index.markers.find((g) => g.name === e.marker)
    if (!marker) {
      plan.issues.push({ kind: 'marker_absent', what: e.key, detail: e.marker })
      continue
    }
    const inst = chooseInstance(marker.instances, selection)
    if (!inst) {
      plan.issues.push({ kind: 'marker_instance_absent', what: e.key, detail: e.marker })
      continue
    }
    plan.attachments.push({
      key: e.key, file: e.file, slot: a.slot, tag, bone: inst.bone,
      instance: { translation: inst.translation, rotation: inst.rotation }, offset: e.offset,
    })
  }
}

/**
 * chooseInstance: the marker instance the selection (region -> permutation) carries: the
 * first tied to a selected region (empty permutation: any permutation of the region), else
 * the first tied to no region; null otherwise (`himap.ChoisitInstance`).
 */
export function chooseInstance<I extends { region: string; permutation: string }>(
  instances: readonly I[],
  selection: ReadonlyMap<string, string>,
): I | null {
  for (const i of instances) {
    if (i.region === '') continue
    const permutation = selection.get(i.region)
    if (permutation !== undefined && (i.permutation === '' || i.permutation === permutation)) return i
  }
  return instances.find((i) => i.region === '') ?? null
}
