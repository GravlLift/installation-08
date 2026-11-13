/**
 * armorPlan3d.ts — CE QU'IL FAUT CHARGER POUR HABILLER UN JOUEUR : fonction pure de son manifeste
 * d'armure (`lib/replay/spartanArmor`) et de l'index de la bibliothèque des pièces (contrat écrit en
 * tête de `meshproto/pieces_index.go`, côté serveur).
 *
 * Le manifeste porte la SÉLECTION FINALE (une permutation par région, résolue par le serveur dans
 * l'ordre du jeu : base du thème, pièces, corpulence, prothèses). Le plan ne la refait pas : il ne
 * fait qu'y lire la pièce de chaque région, dans l'ordre de ces étapes (`stageOf`), puis choisit
 * l'instance de marqueur de chaque accessoire.
 *
 * Règles de repli, toutes nommées dans `issues` (jamais de substitution silencieuse) :
 *   - pièce dont la construction a échoué (`failures` de l'index) : la permutation de la base du
 *     noyau du joueur pour cette région, sinon celle de l'armure par défaut (`DEFAULT_CORE`), sinon
 *     rien ; la pièce que la vue n'arrive pas à charger suit le même repli (`fallback`) ;
 *   - clé absente de l'index et hors des échecs : la permutation n'a aucune section, elle ne dessine
 *     rien (contrat de l'index) ; listée dans `empty`, pas un défaut ;
 *   - accessoire non résolu, absent de la bibliothèque, sans marqueur ou sans instance : non posé.
 */
import type { SpartanArmorManifest } from '@/lib/replay/spartanArmor'

/** Une pose (axes glTF, unités du jeu) : translation, puis rotation (quaternion x, y, z, w). */
export interface ArmorPose {
  translation: [number, number, number]
  rotation: [number, number, number, number]
}

/** L'index de la bibliothèque (`meshproto.IndexPieces`, schéma `ARMOR_INDEX_SCHEMA`). */
export interface ArmorIndex {
  schema: number
  skeleton: { bones: string[]; root: number }
  pieces: { key: string; region: string; permutation: string; file: string; triangles: number }[]
  attachments: { key: string; tag: string; entry: number; file: string; triangles: number; marker: string; offset: ArmorPose }[]
  markers: { name: string; instances: (ArmorPose & { region: string; permutation: string; bone: string; node: number })[] }[]
  themes: { name: string; ocur: string; permutation: string; read: boolean; base_regions: { region: string; permutation: string }[] }[]
  failures: { key: string; reason: string }[]
}

/** La version de l'index que la vue sait lire (`meshproto.SchemaPieces`). */
export const ARMOR_INDEX_SCHEMA = 2
/** La permutation propre du noyau de l'armure par défaut (Mark VII, celle du modèle `spartan`). */
export const DEFAULT_CORE = '13d24f1f'

/** Une pièce à peau à charger, et son repli si elle ne se charge pas. */
export interface PlannedPiece {
  key: string
  file: string
  region: string
  /** L'étape du manifeste qui a posé la permutation (`theme`, `helmet`, `body_type`...). */
  source: string
  fallback: { key: string; file: string; from: 'core' | 'default' } | null
}

/** Une entrée d'accessoire rigide, posée à l'instance de marqueur choisie. */
export interface PlannedAttachment {
  key: string
  file: string
  slot: string
  tag: string
  /** L'os parent de l'instance (vide : repère du modèle). */
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
  // Au chargement (`armory3d`) : pièce non chargée (repli posé), os différents de l'index, accessoire non chargé.
  | 'piece_load_failed'
  | 'piece_bones_mismatch'
  | 'attachment_load_failed'

/** Ce que l'armure du joueur ne porte pas comme le manifeste le dit, nommé. */
export interface OutfitIssue {
  kind: OutfitIssueKind
  /** La clé de pièce, le chemin d'objet ou le tag concerné. */
  what: string
  detail: string
}

export interface OutfitPlan {
  pieces: PlannedPiece[]
  attachments: PlannedAttachment[]
  /** Les régions dont la permutation ne dessine rien (clé absente de l'index, hors échecs). */
  empty: string[]
  issues: OutfitIssue[]
}

/** pieceKey : la clé d'une pièce (`meshproto.ClePiece`). */
export function pieceKey(region: string, permutation: string): string {
  return `${region}-${permutation}`
}

/** variantKey : la forme hexadécimale (8 chiffres, 32 bits non signés) d'un identifiant signé. */
export function variantKey(id: number): string {
  return (id >>> 0).toString(16).padStart(8, '0')
}

/** Les étapes du manifeste dans l'ordre où le serveur les applique. */
const STAGES = ['theme', 'helmet', 'gloves', 'knee_pads', 'left_shoulder_pad', 'right_shoulder_pad', 'body_type']
const PROSTHETIC = 'prosthetic_'

/** stageOf : le rang de l'étape `source` (prothèses en dernier, étape inconnue avant elles). */
export function stageOf(source: string): number {
  if (source.startsWith(PROSTHETIC)) return STAGES.length + 1
  const i = STAGES.indexOf(source)
  return i < 0 ? STAGES.length : i
}

/** Ce que l'index sait, en tables. */
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

/** planOutfit : les pièces et accessoires de l'armure `m` dans la bibliothèque `index`. */
export function planOutfit(m: SpartanArmorManifest, index: ArmorIndex): OutfitPlan {
  const t = tablesOf(index)
  const plan: OutfitPlan = { pieces: [], attachments: [], empty: [], issues: [] }
  for (const path of m.unresolved ?? []) plan.issues.push({ kind: 'manifest_unresolved', what: path, detail: 'non résolu par le serveur' })
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
      else plan.issues.push({ kind: 'piece_no_fallback', what: key, detail: 'aucune pièce de repli pour la région' })
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

/** fallbackFor : la pièce de repli d'une région (base du noyau, puis armure par défaut), autre que `key`. */
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
 * chooseInstance : l'instance d'un marqueur que porte la sélection (région -> permutation) : la
 * première liée à une région sélectionnée (permutation vide : toute permutation de la région),
 * sinon la première liée à aucune région ; null sinon (`himap.ChoisitInstance`).
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
