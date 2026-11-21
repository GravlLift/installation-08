// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { padItemRotation, parseGroundScales, parsePadOffsets } from './padOffsets3d'

describe('parsePadOffsets', () => {
  it('reads each model key, dropping malformed entries; null without the field', () => {
    const t = parsePadOffsets({ pad_offsets: { '4396db42': { p: [0.06, 0, 0], q: [0, 0, 0.7071, 0.7071] }, BAD: { p: [0, 0, 0], q: [0, 0, 0, 1] }, '11111111': { p: [0, 0], q: [0, 0, 0, 1] }, '22222222': { p: [0, 0, 0], q: [0, 0, 0, 0] } } })!
    expect([...t.keys()]).toEqual(['4396db42'])
    expect(t.get('4396db42')!.q.length()).toBeCloseTo(1)
    expect(parsePadOffsets({ equipment: {} })).toBeNull()
  })
})

describe('parseGroundScales', () => {
  it('reads each model key\'s scale, dropping malformed ones; null without the field', () => {
    const t = parseGroundScales({ ground_scales: { '273fe0eb': 2.75, '0a1992bc': 1.3, BAD: 2, '11111111': 0, '22222222': 'x' } })!
    expect([...t.entries()]).toEqual([['273fe0eb', 2.75], ['0a1992bc', 1.3]])
    expect(parseGroundScales({ pad_offsets: {} })).toBeNull()
  })
})

describe('padItemRotation', () => {
  it('turns the model so its pad marker is the holding frame, even when the output is the input', () => {
    // The Shroud Screen's marker: 0.06 along its length, a quarter turn about Z (GLB axes).
    const offset = parsePadOffsets({ pad_offsets: { '4396db42': { p: [0.06, 0, 0], q: [0, 0, Math.SQRT1_2, Math.SQRT1_2] } } })!.get('4396db42')!
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5)
    const hold = q.clone()
    padItemRotation(offset, q, q)
    // model rotation * marker rotation == hold.
    expect(Math.abs(q.clone().multiply(offset.q).dot(hold))).toBeCloseTo(1)
    // The model's long axis (X) ends up vertical: the item stands upright.
    expect(Math.abs(new THREE.Vector3(1, 0, 0).applyQuaternion(q).y)).toBeCloseTo(1)
  })
})
