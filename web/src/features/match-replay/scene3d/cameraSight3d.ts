// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * cameraSight3d.ts — THE CAMERA TRACK'S SIGHT MEASURES (`ExportCamera3d.sightBlockedAt`,
 * `ExportCamera3d.nearCover`), as pure functions of an injected first-hit cast, so they are tested
 * without a map. The scene (`replayScene3d.readCamera`) supplies the cast against its ground
 * surfaces (three-mesh-bvh, first hit only).
 *
 * Both honor the map's NEAR CUT (`near`): map geometry nearer than it is never drawn (a camera
 * script's cutaway `near`, `mapCut3d`; without one, the camera's near plane), so a wall the camera
 * sits behind does not block the sight and does not cover the frame. The cut is a depth along the
 * view axis: a ray that leaves the axis by an angle with cosine c reaches it at `near / c`.
 */

export type SightVec3 = readonly [number, number, number]

/**
 * A first-hit cast: the distance (world units) from `origin` along the unit `dir` to the first
 * surface in [`near`, `far`], or null when there is none.
 */
export type SightCast = (origin: SightVec3, dir: SightVec3, near: number, far: number) => number | null

/** The last stretch before the look point that the sight test skips (the subject's own floor). */
export const LOS_TARGET_MARGIN = 0.1
/** The near cover's grid of rays through the frame (columns x rows, cell centers). */
export const NEAR_COVER_COLS = 12
export const NEAR_COVER_ROWS = 7
/** Geometry nearer than this share of the camera-to-look-point distance counts as covering the frame. */
export const NEAR_COVER_SHARE = 0.35
/** The smallest cosine to the view axis a depth is divided by (a ray at a right angle to the axis would blow it up). */
export const SIGHT_MIN_AXIS_COS = 1e-3

/**
 * The distance from the camera `cam` to the first map surface between it and `target` (world
 * units), or null when the sight is clear. Cast BOTH ways: a camera inside a wall sees only that
 * wall's back faces, which a front-face cast skips; from the target the same wall is a front
 * face. The last LOS_TARGET_MARGIN before the target is not tested. Hits nearer to the camera
 * than its near plane (`near`, a depth along the unit view axis `forward`) are clipped away and
 * ignored: the cast from the camera starts there, the cast from the target stops there.
 */
export function sightBlockOf(
  cam: SightVec3,
  target: SightVec3,
  near: number,
  forward: SightVec3,
  cast: SightCast,
): number | null {
  const dx = target[0] - cam[0]
  const dy = target[1] - cam[1]
  const dz = target[2] - cam[2]
  const len = Math.hypot(dx, dy, dz)
  if (len <= LOS_TARGET_MARGIN) return null
  const reach = len - LOS_TARGET_MARGIN
  const dir: SightVec3 = [dx / len, dy / len, dz / len]
  const cos = dir[0] * forward[0] + dir[1] * forward[1] + dir[2] * forward[2]
  const clipped = Math.max(0, near) / Math.max(SIGHT_MIN_AXIS_COS, cos) // the near plane, along the sight line
  if (clipped >= reach) return null // everything between camera and target is clipped away
  const fromCam = cast(cam, dir, clipped, reach)
  let best = fromCam ?? Infinity
  const start: SightVec3 = [target[0] - dir[0] * LOS_TARGET_MARGIN, target[1] - dir[1] * LOS_TARGET_MARGIN, target[2] - dir[2] * LOS_TARGET_MARGIN]
  const fromTarget = cast(start, [-dir[0], -dir[1], -dir[2]], 0, reach - clipped)
  if (fromTarget !== null) best = Math.min(best, reach - fromTarget)
  return Number.isFinite(best) ? Math.max(0, best) : null
}

/**
 * A first-hit depth cast through the frame: the depth (along the view axis, world units) of the
 * first surface the ray through NDC point (`ndcX`, `ndcY`) meets between depths `minDepth` and
 * `maxDepth`, or null when there is none.
 */
export type DepthCast = (ndcX: number, ndcY: number, minDepth: number, maxDepth: number) => number | null

/**
 * The fraction (0 to 1) of the frame covered by map geometry nearer than NEAR_COVER_SHARE of the
 * camera-to-look-point distance `lookDistance` and beyond the near plane `near`: a coarse grid of
 * `cols` x `rows` rays through the cells' centers, each counting when its first hit in that depth
 * range exists. It catches a wall slab filling a third of the frame. 0 when the range is empty.
 */
export function nearCoverOf(
  near: number,
  lookDistance: number,
  cast: DepthCast,
  cols = NEAR_COVER_COLS,
  rows = NEAR_COVER_ROWS,
): number {
  const minDepth = Math.max(0, near)
  const maxDepth = NEAR_COVER_SHARE * lookDistance
  if (!(maxDepth > minDepth) || cols <= 0 || rows <= 0) return 0
  let covered = 0
  for (let j = 0; j < rows; j++) {
    const y = 1 - (2 * j + 1) / rows
    for (let i = 0; i < cols; i++) {
      const x = -1 + (2 * i + 1) / cols
      const depth = cast(x, y, minDepth, maxDepth)
      if (depth !== null && depth >= minDepth && depth < maxDepth) covered++
    }
  }
  return covered / (cols * rows)
}
