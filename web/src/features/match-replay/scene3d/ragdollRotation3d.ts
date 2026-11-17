// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ragdollRotation3d.ts — LES ROTATIONS DES BLOCS RIGIDES du corps inerte (`ragdollSolver3d`) : la
 * rotation la plus proche d'une matrice d'appariement de forme, par la méthode itérative de Müller et
 * al. (2016), réchauffée par la rotation du pas d'avant, et les quaternions qui la portent.
 */

const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z)
/** Les itérations de l'extraction de rotation : moins, elle ne suit pas les blocs qui tournent vite et le corps s'emballe. */
const ROTATION_ITERATIONS = 20
/** Sous ce pas (radians), la rotation extraite est tenue pour juste. */
const ROTATION_EPS = 1e-7

const shapeR = new Float64Array(9)

/** extractRotation : la rotation de A (colonnes) par la méthode itérative de Müller, réchauffée par `q`. */
export function extractRotation(A: Float64Array, q: Float64Array): void {
  const r = shapeR
  for (let it = 0; it < ROTATION_ITERATIONS; it++) {
    rotationColumns(q, r)
    let wx = 0, wy = 0, wz = 0, dt = 0
    for (let c = 0; c < 3; c++) {
      const rx = r[3 * c], ry = r[3 * c + 1], rz = r[3 * c + 2]
      const ax = A[3 * c], ay = A[3 * c + 1], az = A[3 * c + 2]
      wx += ry * az - rz * ay
      wy += rz * ax - rx * az
      wz += rx * ay - ry * ax
      dt += rx * ax + ry * ay + rz * az
    }
    const inv = 1 / (Math.abs(dt) + 1e-9)
    wx *= inv
    wy *= inv
    wz *= inv
    const w = len3(wx, wy, wz)
    if (w < ROTATION_EPS) break
    const h = w / 2
    const sn = Math.sin(h) / w
    mulQuat(wx * sn, wy * sn, wz * sn, Math.cos(h), q)
  }
}

/** mulQuat écrit dans `q` le produit a·q, normalisé. */
function mulQuat(ax: number, ay: number, az: number, aw: number, q: Float64Array): void {
  const bx = q[0], by = q[1], bz = q[2], bw = q[3]
  const x = aw * bx + ax * bw + ay * bz - az * by
  const y = aw * by - ax * bz + ay * bw + az * bx
  const z = aw * bz + ax * by - ay * bx + az * bw
  const w = aw * bw - ax * bx - ay * by - az * bz
  const l = Math.sqrt(x * x + y * y + z * z + w * w) || 1
  q[0] = x / l
  q[1] = y / l
  q[2] = z / l
  q[3] = w / l
}

/** rotationColumns écrit dans `out` la matrice de rotation de `q`, rangée par colonnes. */
export function rotationColumns(q: Float64Array, out: Float64Array): Float64Array {
  const x = q[0], y = q[1], z = q[2], w = q[3]
  out[0] = 1 - 2 * (y * y + z * z)
  out[1] = 2 * (x * y + z * w)
  out[2] = 2 * (x * z - y * w)
  out[3] = 2 * (x * y - z * w)
  out[4] = 1 - 2 * (x * x + z * z)
  out[5] = 2 * (y * z + x * w)
  out[6] = 2 * (x * z + y * w)
  out[7] = 2 * (y * z - x * w)
  out[8] = 1 - 2 * (x * x + y * y)
  return out
}

const rotateR = new Float64Array(9)

/** rotate : le vecteur `v[o..o+2]` tourné par le quaternion `q`. */
export function rotate(q: Float64Array, v: Float64Array, o: number): number[] {
  const r = rotationColumns(q, rotateR)
  const a = v[o], b = v[o + 1], c = v[o + 2]
  return [r[0] * a + r[3] * b + r[6] * c, r[1] * a + r[4] * b + r[7] * c, r[2] * a + r[5] * b + r[8] * c]
}
