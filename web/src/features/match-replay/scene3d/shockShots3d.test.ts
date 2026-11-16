/**
 * Tests: the shock rifle's shot — three jagged beams, deterministic in (from, to, seed, bucket),
 * jaggered per bucket, faded to zero after its life.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { beamFade } from './shots3d'
import { SHOCK_BEAM_SECONDS, SHOCK_BEAMS, SHOCK_SEGMENTS, shockBeamPaths, shockJitterBucket, unitHash, type ShockBeam } from './shockShots3d'

const flat = (pts: readonly THREE.Vector3[]) => pts.map((p) => [p.x, p.y, p.z])

describe('shockBeamPaths', () => {
  const from = new THREE.Vector3(0.374, 0, 0.043)
  const to = new THREE.Vector3(30, 2, -12)
  const out: ShockBeam[] = Array.from({ length: SHOCK_BEAMS }, () => ({ points: [] }))

  it('tire trois faisceaux de la bouche au point d impact, bouts jamais décalés', () => {
    const beams = shockBeamPaths(from, to, 41, 0, out)
    expect(beams).toHaveLength(SHOCK_BEAMS)
    for (const beam of beams) {
      expect(beam.points).toHaveLength(SHOCK_SEGMENTS + 1)
      expect(flat([beam.points[0]])).toEqual(flat([from]))
      expect(flat([beam.points[beam.points.length - 1]])).toEqual(flat([to]))
    }
  })

  it('le même tir au même temps de partie dessine la même image', () => {
    const a = shockBeamPaths(from, to, 41, 7, out)
    const first = a.map((b) => flat(b.points))
    shockBeamPaths(from, to, 41, 7, out)
    expect(out.map((b) => flat(b.points))).toEqual(first)
  })

  it('le tremblement se re-seed par palier : l intérieur du faisceau bouge, les bouts non', () => {
    shockBeamPaths(from, to, 41, 0, out)
    const bucket0 = out.map((b) => flat(b.points))
    shockBeamPaths(from, to, 41, 1, out)
    const bucket1 = out.map((b) => flat(b.points))
    expect(bucket1).not.toEqual(bucket0)
    // The endpoints are tied to the muzzle and the end point, never jaggered.
    for (let i = 0; i < SHOCK_BEAMS; i++) {
      expect(bucket1[i][0]).toEqual(bucket0[i][0])
      const n = bucket0[i].length - 1
      expect(bucket1[i][n]).toEqual(bucket0[i][n])
    }
  })

  it('deux tirs (deux seeds) ne partagent pas leur faisceau', () => {
    shockBeamPaths(from, to, 41, 0, out)
    const a = out.map((b) => flat(b.points))
    shockBeamPaths(from, to, 42, 0, out)
    expect(out.map((b) => flat(b.points))).not.toEqual(a)
  })

  it('un tir de longueur nulle ne déborde pas', () => {
    const p = new THREE.Vector3(1, 1, 1)
    const beams = shockBeamPaths(p, p.clone(), 1, 0, out)
    for (const beam of beams) {
      expect(beam.points).toHaveLength(2)
      expect(flat([beam.points[0]])).toEqual([[1, 1, 1]])
      expect(flat([beam.points[1]])).toEqual([[1, 1, 1]])
    }
  })
})

describe('la vie du tir de choc', () => {
  it('plein au tir, fondu linéairement, éteint après sa durée', () => {
    expect(beamFade(0, SHOCK_BEAM_SECONDS)).toBe(1)
    expect(beamFade(SHOCK_BEAM_SECONDS / 2, SHOCK_BEAM_SECONDS)).toBeCloseTo(0.5)
    expect(beamFade(SHOCK_BEAM_SECONDS, SHOCK_BEAM_SECONDS)).toBe(0)
    expect(beamFade(SHOCK_BEAM_SECONDS + 0.01, SHOCK_BEAM_SECONDS)).toBe(0)
    expect(beamFade(-0.1, SHOCK_BEAM_SECONDS)).toBe(0)
  })
})

describe('les seeds', () => {
  it('unitHash reste dans [0, 1) et désaccorde ses voisins', () => {
    for (const n of [0, 1, -1, 97, 1 << 20]) {
      expect(unitHash(n)).toBeGreaterThanOrEqual(0)
      expect(unitHash(n)).toBeLessThan(1)
      expect(unitHash(n)).not.toBe(unitHash(n + 1))
    }
  })

  it('le palier de tremblement avance à la cadence nommée', () => {
    expect(shockJitterBucket(0)).toBe(0)
    expect(shockJitterBucket(0.04)).toBe(0)
    expect(shockJitterBucket(0.06)).toBe(1)
    expect(shockJitterBucket(2.125)).toBe(42)
  })
})
