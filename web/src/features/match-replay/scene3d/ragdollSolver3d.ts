// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ragdollSolver3d.ts — LE CORPS INERTE PAS À PAS : dynamique par positions (Verlet), contraintes
 * projetées en un nombre fixe d'itérations, contacts avec le morceau de carte (`ragdollPatch3d`).
 *
 * Choix : un corps de particules (`ragdollBody3d`) plutôt qu'un moteur de corps rigides. Le pas est
 * fixe, les itérations et l'ordre des contraintes aussi : même état de départ, même suite d'états au
 * bit près sur une machine. Rien d'aléatoire ici (l'asymétrie éventuelle est dans l'impulsion).
 *
 * Un pas : intégration (gravité, traînée), puis `ITERATIONS` passes sur les contraintes ; les contacts
 * avec la carte se résolvent dans certaines passes (balayage des particules rapides d'abord), le
 * frottement s'applique à la fin aux particules en contact. Les blocs rigides tiennent par
 * appariement de forme (rotation extraite par la méthode itérative de Müller et al., 2016,
 * réchauffée par la rotation du pas d'avant) : leur rotation sert aussi à reposer les os.
 */
import {
  APART, CHAIN_RANGES, CLUSTER_NAMES, CLUSTERS, HINGES, HIP_CONE, HIP_LEAN, HIPS, P, PARTICLES, RANGES, STICKS,
  type ClusterName,
} from './ragdollBody3d'
import { MAX_CONTACTS, type TrianglePatch } from './ragdollPatch3d'
import { extractRotation, rotate, rotationColumns } from './ragdollRotation3d'

/** Le pas fixe de la simulation (s) et ses itérations de contraintes. */
export const STEP_SECONDS = 1 / 120
const ITERATIONS = 6
/** La portée de la recherche des plans de contact au-delà du rayon (u) : ce que les contraintes déplacent encore dans un pas. */
const CONTACT_MARGIN = 0.05
/** Un pas plus long que cette part du rayon est balayé avant la recherche des contacts. */
const SWEEP_SHARE = 0.5
/**
 * Aux premiers pas, une particule déjà contre une surface prend la normale du côté du centre du corps
 * (`TrianglePatch.contacts`) : les pieds du film sont parfois un peu sous le sol dessiné.
 */
const ANCHOR_STEPS = 12
/**
 * La gravité (u/s²) : celle de la Terre vaut 3,22 u/s² ; un peu moins pour la chute flottante des
 * corps de Halo.
 */
export const RAGDOLL_GRAVITY = 2.6
/** La traînée par pas (part de la vitesse perdue) : très faible, les corps volent. */
const AIR_DRAG = 0.0015
/**
 * Couché (au moins `GROUNDED_CONTACTS` particules au contact au pas d'avant), le corps perd bien plus
 * par pas : les balancements (tête, membres en l'air) s'éteignent en une fraction de seconde au lieu
 * d'osciller sans fin, comme le feraient les muscles.
 */
const GROUNDED_CONTACTS = 3
const GROUND_DRAG = 0.025
/** Le frottement au contact : part du glissement tangentiel retirée par pas. */
const FRICTION = 0.35
/** Sous ce glissement (u/s), le frottement statique l'arrête net. */
const STATIC_SLIP = 0.2
/** La vitesse au plus d'une particule (u/s) : garde-fou du solveur. */
const MAX_SPEED = 14
/** Les distances minimales entre membres et tronc : part de la somme des rayons. */
const APART_SHARE = 0.9
/**
 * La raideur des bornes entre blocs rigides (colonne, cou) par itération : sous 1, elles convergent
 * en quelques itérations au lieu d'osciller contre les blocs (ce qui injectait de l'énergie).
 */
const RANGE_STIFFNESS = 0.5

interface Cluster {
  idx: readonly number[]
  /** Décalages de repos (à la mort) au barycentre pondéré, 3 par particule. */
  q: Float64Array
  m: Float64Array
  /** Rotation courante depuis la mort (quaternion x, y, z, w). */
  rot: Float64Array
}

export interface RagdollState {
  n: number
  x: Float64Array
  prev: Float64Array
  /** Inverse des masses, et les masses. */
  w: Float64Array
  m: Float64Array
  /** Les pas faits. */
  steps: number
  r: Float64Array
  stick: Float64Array
  rangeLo: Float64Array
  rangeHi: Float64Array
  chainLo: Float64Array
  apart: Float64Array
  hipCone: Float64Array
  clusters: Record<ClusterName, Cluster>
  /** Axes des charnières et du cône des hanches, à la mort (3 par entrée). */
  hingeAxis: Float64Array
  hipAxis: Float64Array
  /** Les plans de contact du pas (6 par plan, `MAX_CONTACTS` par particule) et leur nombre. */
  planes: Float64Array
  /** Les plans de chaque particule (vues sur planes). */
  planeViews: Float64Array[]
  planeCount: Uint8Array
  /** Normale du dernier contact de chaque particule (3) et si elle touche à ce pas. */
  normal: Float64Array
  touching: Uint8Array
}

/** len3 : la norme d'un vecteur (`Math.hypot` est bien plus lent dans la boucle du solveur). */
const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z)
const dist = (x: Float64Array, a: number, b: number) => len3(x[3 * a] - x[3 * b], x[3 * a + 1] - x[3 * b + 1], x[3 * a + 2] - x[3 * b + 2])

/**
 * createRagdoll : l'état au repos à la mort, particules aux places `x` (3 par particule, axes three),
 * immobile ; les bornes sont relâchées là où la pose de mort les dépasse déjà (aucun saut au départ).
 */
export function createRagdoll(x: Float64Array): RagdollState {
  const n = PARTICLES.length
  const s: RagdollState = {
    n, x: Float64Array.from(x), prev: Float64Array.from(x),
    w: Float64Array.from(PARTICLES, (p) => 1 / p.mass),
    m: Float64Array.from(PARTICLES, (p) => p.mass),
    steps: 0,
    r: Float64Array.from(PARTICLES, (p) => p.radius),
    stick: Float64Array.from(STICKS, ([a, b]) => dist(x, a, b)),
    rangeLo: Float64Array.from(RANGES, (c) => Math.min(c.lo * dist(x, c.a, c.b), dist(x, c.a, c.b))),
    rangeHi: Float64Array.from(RANGES, (c) => Math.max(c.hi * dist(x, c.a, c.b), dist(x, c.a, c.b))),
    chainLo: Float64Array.from(CHAIN_RANGES, (c) => Math.min(c.lo * (dist(x, c.a, c.mid) + dist(x, c.mid, c.b)), dist(x, c.a, c.b))),
    apart: Float64Array.from(APART, ([a, b]) => Math.min(APART_SHARE * (PARTICLES[a].radius + PARTICLES[b].radius), dist(x, a, b))),
    hipCone: new Float64Array(HIPS.length),
    clusters: {} as Record<ClusterName, Cluster>,
    hingeAxis: new Float64Array(3 * HINGES.length),
    hipAxis: new Float64Array(3 * HIPS.length),
    planes: new Float64Array(6 * MAX_CONTACTS * n),
    planeViews: [],
    planeCount: new Uint8Array(n),
    normal: new Float64Array(3 * n),
    touching: new Uint8Array(n),
  }
  const per = 6 * MAX_CONTACTS
  s.planeViews = Array.from({ length: n }, (_, i) => s.planes.subarray(per * i, per * (i + 1)))
  for (const name of CLUSTER_NAMES) s.clusters[name] = restCluster(s, CLUSTERS[name])
  restAxes(s)
  return s
}

function restCluster(s: RagdollState, idx: readonly number[]): Cluster {
  const m = Float64Array.from(idx, (i) => 1 / s.w[i])
  const c = centroid(s.x, idx, m, [0, 0, 0])
  const q = new Float64Array(3 * idx.length)
  idx.forEach((p, k) => {
    for (let d = 0; d < 3; d++) q[3 * k + d] = s.x[3 * p + d] - c[d]
  })
  return { idx, q, m, rot: Float64Array.of(0, 0, 0, 1) }
}

/** restAxes : les axes des charnières (plan du membre à la mort, sinon le côté du corps) et des hanches. */
function restAxes(s: RagdollState): void {
  const x = s.x
  const sub = (a: number, b: number) => [x[3 * a] - x[3 * b], x[3 * a + 1] - x[3 * b + 1], x[3 * a + 2] - x[3 * b + 2]]
  const armRight = norm(sub(P('rShoulder'), P('lShoulder')))
  const legRight = norm(sub(P('rHip'), P('lHip')))
  HINGES.forEach((h, k) => {
    const legs = h.frame === 'pelvis'
    const fallback = legs ? legRight.map((v) => -v) : armRight
    const u = sub(h.mid, h.a)
    const f = sub(h.b, h.mid)
    const c = cross(u, f)
    const bent = Math.hypot(...c) > 0.25 * Math.hypot(...u) * Math.hypot(...f)
    const axis = bent && dot(norm(c), fallback) > 0 ? norm(c) : fallback
    s.hingeAxis.set(axis, 3 * k)
  })
  const fwd = norm(sub(P('belly'), P('pelvis')))
  const up = norm(sub(P('chest'), P('pelvis')))
  const down = norm(up.map((v, d) => -(v - fwd[d] * dot(up, fwd))))
  const axis = norm(down.map((v, d) => v * Math.cos(HIP_LEAN) + fwd[d] * Math.sin(HIP_LEAN)))
  HIPS.forEach(([hip, knee], k) => {
    s.hipAxis.set(axis, 3 * k)
    const t = norm(sub(knee, hip))
    s.hipCone[k] = Math.max(HIP_CONE, Math.acos(Math.min(1, Math.max(-1, dot(t, axis)))) + 0.05)
  })
}

/**
 * kickRagdoll donne aux particules la vitesse `v` (u/s, 3 par particule) : la place d'avant est
 * reculée d'un pas le long d'elle.
 */
export function kickRagdoll(s: RagdollState, v: Float64Array): void {
  for (let i = 0; i < 3 * s.n; i++) s.prev[i] = s.x[i] - v[i] * STEP_SECONDS
}

/** stepRagdoll avance l'état d'un pas fixe ; `patch` : la carte autour (null : aucun contact). */
export function stepRagdoll(s: RagdollState, patch: TrianglePatch | null): void {
  integrate(s)
  s.touching.fill(0)
  s.planeCount.fill(0)
  if (patch) detect(s, patch)
  for (let it = 0; it < ITERATIONS; it++) {
    solveSticks(s)
    solveRanges(s)
    for (const name of CLUSTER_NAMES) matchShape(s, s.clusters[name])
    solveHinges(s)
    solveHips(s)
    solveApart(s)
    enforcePlanes(s)
  }
  applyFriction(s)
  s.steps++
}

/** broken : l'état a-t-il perdu une valeur finie (garde-fou : la cuisson est alors abandonnée) ? */
export function broken(s: RagdollState): boolean {
  for (let i = 0; i < s.x.length; i++) if (!Number.isFinite(s.x[i])) return true
  return false
}

function integrate(s: RagdollState): void {
  const g = RAGDOLL_GRAVITY * STEP_SECONDS * STEP_SECONDS
  const vmax = MAX_SPEED * STEP_SECONDS
  let contacts = 0
  for (let i = 0; i < s.n; i++) contacts += s.touching[i]
  const keep = 1 - (contacts >= GROUNDED_CONTACTS ? GROUND_DRAG : AIR_DRAG)
  for (let i = 0; i < s.n; i++) {
    const o = 3 * i
    let vx = (s.x[o] - s.prev[o]) * keep
    let vy = (s.x[o + 1] - s.prev[o + 1]) * keep
    let vz = (s.x[o + 2] - s.prev[o + 2]) * keep
    const sp = len3(vx, vy, vz)
    if (sp > vmax) {
      vx *= vmax / sp
      vy *= vmax / sp
      vz *= vmax / sp
    }
    s.prev[o] = s.x[o]
    s.prev[o + 1] = s.x[o + 1]
    s.prev[o + 2] = s.x[o + 2]
    s.x[o] += vx
    s.x[o + 1] += vy - g
    s.x[o + 2] += vz
  }
}

/** pull rapproche ou écarte `a` et `b` vers la distance `target`, au prorata des inverses de masse. */
function pull(s: RagdollState, a: number, b: number, target: number, stiffness: number): void {
  const x = s.x
  const dx = x[3 * b] - x[3 * a]
  const dy = x[3 * b + 1] - x[3 * a + 1]
  const dz = x[3 * b + 2] - x[3 * a + 2]
  const d = len3(dx, dy, dz)
  const wsum = s.w[a] + s.w[b]
  if (d < 1e-9 || wsum <= 0) return
  const k = (stiffness * (d - target)) / (d * wsum)
  x[3 * a] += dx * k * s.w[a]
  x[3 * a + 1] += dy * k * s.w[a]
  x[3 * a + 2] += dz * k * s.w[a]
  x[3 * b] -= dx * k * s.w[b]
  x[3 * b + 1] -= dy * k * s.w[b]
  x[3 * b + 2] -= dz * k * s.w[b]
}

function solveSticks(s: RagdollState): void {
  for (let k = 0; k < STICKS.length; k++) pull(s, STICKS[k][0], STICKS[k][1], s.stick[k], 1)
}

function solveRanges(s: RagdollState): void {
  RANGES.forEach((c, k) => {
    const d = dist(s.x, c.a, c.b)
    if (d < s.rangeLo[k]) pull(s, c.a, c.b, s.rangeLo[k], RANGE_STIFFNESS)
    else if (d > s.rangeHi[k]) pull(s, c.a, c.b, s.rangeHi[k], RANGE_STIFFNESS)
  })
  CHAIN_RANGES.forEach((c, k) => {
    if (dist(s.x, c.a, c.b) < s.chainLo[k]) pull(s, c.a, c.b, s.chainLo[k], 1)
  })
}

function solveApart(s: RagdollState): void {
  for (let k = 0; k < APART.length; k++) {
    const [a, b] = APART[k]
    if (dist(s.x, a, b) < s.apart[k]) pull(s, a, b, s.apart[k], 1)
  }
}

/**
 * shift corrige l'écart relatif `delta` de `b` par rapport à `a` (b - a doit gagner `delta`), réparti
 * au prorata des inverses de masse : la quantité de mouvement du corps est conservée (une correction
 * portée par un seul côté ferait sautiller le corps).
 */
function shift(s: RagdollState, a: number, b: number, delta: readonly number[]): void {
  const wsum = s.w[a] + s.w[b]
  if (wsum <= 0) return
  const ka = s.w[a] / wsum
  const kb = s.w[b] / wsum
  for (let d = 0; d < 3; d++) {
    s.x[3 * a + d] -= delta[d] * ka
    s.x[3 * b + d] += delta[d] * kb
  }
}

/** solveHinges : le milieu d'une charnière (coude, genou) ne plie pas à l'envers ; sinon le bout se redresse. */
function solveHinges(s: RagdollState): void {
  const x = s.x
  HINGES.forEach((h, k) => {
    const axis = rotate(s.clusters[h.frame].rot, s.hingeAxis, 3 * k)
    const u = [x[3 * h.mid] - x[3 * h.a], x[3 * h.mid + 1] - x[3 * h.a + 1], x[3 * h.mid + 2] - x[3 * h.a + 2]]
    const bend = cross(axis, u)
    const l = len3(bend[0], bend[1], bend[2])
    if (l < 1e-9) return
    const f = [x[3 * h.b] - x[3 * h.mid], x[3 * h.b + 1] - x[3 * h.mid + 1], x[3 * h.b + 2] - x[3 * h.mid + 2]]
    const wrong = dot(f, bend) / l
    if (wrong >= 0) return
    shift(s, h.mid, h.b, bend.map((v) => (-v / l) * wrong))
  })
}

/** solveHips : la cuisse reste dans le cône de la hanche (le genou est ramené vers l'axe). */
function solveHips(s: RagdollState): void {
  const x = s.x
  const rot = s.clusters.pelvis.rot
  HIPS.forEach(([hip, knee], k) => {
    const axis = rotate(rot, s.hipAxis, 3 * k)
    const t = [x[3 * knee] - x[3 * hip], x[3 * knee + 1] - x[3 * hip + 1], x[3 * knee + 2] - x[3 * hip + 2]]
    const len = len3(t[0], t[1], t[2])
    if (len < 1e-9) return
    const c = dot(t, axis) / len
    const cone = s.hipCone[k]
    if (c >= Math.cos(cone)) return
    const perp = norm(t.map((v, d) => v / len - axis[d] * c))
    shift(s, hip, knee, t.map((v, d) => len * (axis[d] * Math.cos(cone) + perp[d] * Math.sin(cone)) - v))
  })
}

/** matchShape ramène un bloc à sa forme de repos tournée de sa rotation la plus proche. */
const shapeA = new Float64Array(9)
const shapeC = [0, 0, 0]
const shapeR = new Float64Array(9)

function matchShape(s: RagdollState, cl: Cluster): void {
  const c = centroid(s.x, cl.idx, cl.m, shapeC)
  // A = Σ m (x - c) qᵀ, rangée par colonnes.
  const A = shapeA
  A.fill(0)
  for (let k = 0; k < cl.idx.length; k++) {
    const p = cl.idx[k]
    for (let col = 0; col < 3; col++) {
      for (let row = 0; row < 3; row++) A[3 * col + row] += cl.m[k] * (s.x[3 * p + row] - c[row]) * cl.q[3 * k + col]
    }
  }
  extractRotation(A, cl.rot)
  const r = rotationColumns(cl.rot, shapeR)
  for (let k = 0; k < cl.idx.length; k++) {
    const p = cl.idx[k]
    const a = cl.q[3 * k], b = cl.q[3 * k + 1], d = cl.q[3 * k + 2]
    s.x[3 * p] = c[0] + r[0] * a + r[3] * b + r[6] * d
    s.x[3 * p + 1] = c[1] + r[1] * a + r[4] * b + r[7] * d
    s.x[3 * p + 2] = c[2] + r[2] * a + r[5] * b + r[8] * d
  }
}


function centroid(x: Float64Array, idx: readonly number[], m: Float64Array, out: number[]): number[] {
  let total = 0
  out[0] = out[1] = out[2] = 0
  for (let k = 0; k < idx.length; k++) {
    const p = idx[k]
    total += m[k]
    out[0] += m[k] * x[3 * p]
    out[1] += m[k] * x[3 * p + 1]
    out[2] += m[k] * x[3 * p + 2]
  }
  out[0] /= total
  out[1] /= total
  out[2] /= total
  return out
}

/**
 * detect : les contacts du pas, cherchés une fois après l'intégration. Le trajet de chaque particule
 * (de sa place d'avant, hors de la carte, à sa place prédite) est balayé : une particule rapide ne
 * traverse pas un mur fin. Puis les triangles proches donnent chacun un plan (point, normale tournée
 * vers la place d'avant), que chaque itération fait respecter (`enforcePlanes`) : contacts et
 * contraintes convergent ensemble.
 */
function detect(s: RagdollState, patch: TrianglePatch): void {
  const anchor = s.steps < ANCHOR_STEPS ? centroid(s.x, ALL, s.m, detectC) : null
  for (let i = 0; i < s.n; i++) {
    const o = 3 * i
    const step = len3(s.x[o] - s.prev[o], s.x[o + 1] - s.prev[o + 1], s.x[o + 2] - s.prev[o + 2])
    if (step > SWEEP_SHARE * s.r[i]) patch.sweep(s.x, o, s.r[i], s.prev)
    s.planeCount[i] = patch.contacts(s.x, o, s.r[i], s.r[i] + CONTACT_MARGIN, s.prev, anchor, s.planeViews[i], MAX_CONTACTS)
  }
}

const detectC = [0, 0, 0]
const ALL = PARTICLES.map((_, i) => i)

/** enforcePlanes : chaque particule reste à son rayon au-dessus de ses plans de contact. */
function enforcePlanes(s: RagdollState): void {
  const per = 6 * MAX_CONTACTS
  for (let i = 0; i < s.n; i++) {
    const o = 3 * i
    for (let k = 0; k < s.planeCount[i]; k++) {
      const q = per * i + 6 * k
      const pl = s.planes
      const nx = pl[q + 3], ny = pl[q + 4], nz = pl[q + 5]
      const d = (s.x[o] - pl[q]) * nx + (s.x[o + 1] - pl[q + 1]) * ny + (s.x[o + 2] - pl[q + 2]) * nz
      if (d >= s.r[i]) continue
      s.x[o] += nx * (s.r[i] - d)
      s.x[o + 1] += ny * (s.r[i] - d)
      s.x[o + 2] += nz * (s.r[i] - d)
      s.touching[i] = 1
      s.normal[o] = nx
      s.normal[o + 1] = ny
      s.normal[o + 2] = nz
    }
  }
}

/**
 * applyFriction freine le glissement tangentiel des particules en contact : un glissement lent est
 * arrêté net (frottement statique, le corps posé ne rampe pas), un rapide perd `FRICTION`.
 */
function applyFriction(s: RagdollState): void {
  for (let i = 0; i < s.n; i++) {
    if (!s.touching[i]) continue
    const o = 3 * i
    const dx = s.x[o] - s.prev[o], dy = s.x[o + 1] - s.prev[o + 1], dz = s.x[o + 2] - s.prev[o + 2]
    const nx = s.normal[o], ny = s.normal[o + 1], nz = s.normal[o + 2]
    const dn = dx * nx + dy * ny + dz * nz
    const tx = dx - dn * nx, ty = dy - dn * ny, tz = dz - dn * nz
    const k = len3(tx, ty, tz) < STATIC_SLIP * STEP_SECONDS ? 1 : FRICTION
    s.x[o] -= tx * k
    s.x[o + 1] -= ty * k
    s.x[o + 2] -= tz * k
  }
}

/** maxStep : le plus grand déplacement d'une particule au dernier pas (u). */
export function maxStep(s: RagdollState): number {
  let m = 0
  for (let i = 0; i < s.n; i++) {
    const o = 3 * i
    m = Math.max(m, len3(s.x[o] - s.prev[o], s.x[o + 1] - s.prev[o + 1], s.x[o + 2] - s.prev[o + 2]))
  }
  return m
}

function cross(a: readonly number[], b: readonly number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function norm(a: readonly number[]): number[] {
  const l = len3(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
