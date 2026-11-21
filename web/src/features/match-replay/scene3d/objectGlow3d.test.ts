// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { colorMapping, drivenColor, objectDrivenSources, objectInputsAt, readObjectGlow, type ObjectGlowSpec } from './objectGlow3d'

const hex = (h: string) => Array.from(h.match(/../g)!, (b) => parseInt(b, 16))
// The equipment pad device's two lit mappings (materials e562fa15 / b8cfe89f and 876b85dc).
const ORANGE_BLUE: ObjectGlowSpec = { entree: 0x4a2c3a6a, donnees: hex('0034030000257aff0000000000000000ff7153ff6f12833a6f12033b00000000') }
const RED_BLUE: ObjectGlowSpec = { entree: 0x4a2c3a6a, donnees: hex('00340300141479ff000000ff00000000f29200ff6f12833a6f12033b00000000') }
const PAD = 0xe42158df | 0

const close = (got: readonly number[], want: readonly number[]) => got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 4))
const srgb = (h: number) => {
  const c = new THREE.Color().setHex(h, THREE.SRGBColorSpace)
  return [c.r, c.g, c.b]
}

describe('colorMapping', () => {
  it('starts at the still color the material carries', () => {
    // The material's still colors, as himap reads them (pad_device_gamefiles_test.go).
    close(colorMapping(ORANGE_BLUE)!(0), [0.19461787, 0.018500218, 0])
    close(colorMapping(RED_BLUE)!(0), [0.19120172, 0.00699541, 0.00699541])
  })

  it('ends on the last slot and passes the middle one at 0.5', () => {
    close(colorMapping(ORANGE_BLUE)!(1), srgb(0x5371ff))
    close(colorMapping(RED_BLUE)!(1), srgb(0x0092f2))
    close(colorMapping(RED_BLUE)!(0.5), [0, 0, 0])
    close(colorMapping(ORANGE_BLUE)!(0.5), [0, 0, 0])
  })

  it('reads the base64 bytes the build writes', () => {
    const b64 = btoa(String.fromCharCode(...(ORANGE_BLUE.donnees as number[])))
    close(colorMapping({ entree: 1, donnees: b64 })!(1), srgb(0x5371ff))
  })

  it('leaves other color counts unread', () => {
    const two = hex('0034020000257aff0000000000000000ff7153ff')
    expect(colorMapping({ entree: 1, donnees: two })).toBeNull()
    expect(colorMapping({ entree: 1, donnees: [0, 1] })).toBeNull()
  })
})

describe('object inputs', () => {
  const objects = [
    { index: 1184, type: PAD, min: [6.5, 78.9, 60.0], max: [6.8, 79.4, 60.06] },
    { index: 7, type: 0x7e5b5a64, min: [0, 0, 0], max: [100, 100, 100] },
  ]

  it('finds the pad holding a surface (three axes)', () => {
    expect(objectInputsAt(objects, new THREE.Vector3(6.67, 60.03, -79.18))?.get(0x4a2c3a6a)).toBe(1)
    expect(objectInputsAt(objects, new THREE.Vector3(20, 60.03, -79.18))).toBeNull()
    expect(objectInputsAt(undefined, new THREE.Vector3())).toBeNull()
  })

  it('drives only the mapped input', () => {
    close(drivenColor([RED_BLUE], new Map([[0x4a2c3a6a, 1]]))!, srgb(0x0092f2))
    expect(drivenColor([RED_BLUE], new Map([[0x1234, 1]]))).toBeNull()
  })

  it('reads the extras list', () => {
    expect(readObjectGlow({ emissionObject: [ORANGE_BLUE] })).toHaveLength(1)
    expect(readObjectGlow({ emissionObject: [{ donnees: [] }] })).toBeNull()
    expect(readObjectGlow({})).toBeNull()
  })

  it('gives a pad surface a blue copy and leaves others on their own material', () => {
    const scene = new THREE.Group()
    scene.userData.levelupObjects = objects
    const source = new THREE.MeshStandardMaterial({ emissive: 0x7a2500 })
    source.userData = { emissionObject: [ORANGE_BLUE] }
    const geometry = new THREE.BoxGeometry(0.2, 0.05, 0.2)
    const onPad = new THREE.Mesh(geometry, source)
    onPad.position.set(6.67, 60.03, -79.18)
    const elsewhere = new THREE.Mesh(geometry, source)
    elsewhere.position.set(30, 60.03, -79.18)
    const twin = new THREE.Mesh(geometry, source)
    twin.position.set(6.6, 60.03, -79.1)
    scene.add(onPad, elsewhere, twin)
    const drive = objectDrivenSources(scene)
    const blue = drive(onPad, source)
    expect(blue).not.toBe(source)
    close([blue.emissive.r, blue.emissive.g, blue.emissive.b], srgb(0x5371ff))
    expect(drive(twin, source)).toBe(blue)
    expect(drive(elsewhere, source)).toBe(source)
    const plain = new THREE.MeshStandardMaterial()
    expect(drive(onPad, plain)).toBe(plain)
  })
})
