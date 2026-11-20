// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { frontPoint, litImpacts, makeShell, showShell, type BodyFxState } from './bodyShell3d'
import { glowLevel } from './lighting'
import {
  bandMask, constantOf, evalCurve, parseShieldHit, plasmaExponent, propertyAt, slotColor, termColor,
  type GeneratorCurve, type ShieldGenerator, type ShieldHitLook,
} from './shieldGenerator3d'
import type { ShieldImpact } from './shieldImpacts3d'
import { NO_SHIELD_FX } from './shields3d'

const FLT_MAX = 3.4028234663852886e38
/** The hit intensity's curve as the library build reads it from the tag: 90 -> 0, linear then cubic. */
const HIT_INTENSITY: GeneratorCurve = {
  rangeMin: 90, rangeMax: 0, saturate: true,
  segments: [
    { kind: 'linear', domainMax: 0.10333333, c: [7.6451616, 0, 0, 0] },
    { kind: 'cubic', domainMax: FLT_MAX, c: [0.49895266, -1.3106544, 1.1244504, 0.68725115] },
  ],
}
/** The hit radius's curve: 0.1 -> 0.05 u. */
const HIT_RADIUS: GeneratorCurve = {
  rangeMin: 0.1, rangeMax: 0.05, saturate: true,
  segments: [
    { kind: 'linear', domainMax: 0.6983333, c: [0.13842481, 0, 0, 0] },
    { kind: 'cubic', domainMax: FLT_MAX, c: [-1.8765619, -4.862851, 15.355386, -7.615974] },
  ],
}

/** The shield impact generator's entry as the library build writes it (efge 70e04608). */
function hitEntry(): ShieldGenerator {
  return {
    generator: '70e04608', additive: true, tintInsteadOfReplace: false,
    edgeColorMode: 0, plasmaCenterColorMode: 0, plasmaEdgeColorMode: 0, hitColorMode: 3, flatColorMode: 0,
    edgeGlowIntensity: { constant: 0 }, plasmaCenterIntensity: { constant: 0 }, plasmaEdgeIntensity: { constant: 0 },
    flatColorIntensity: { constant: 0 }, extrusionDistance: { constant: 0.005 }, oscillationAmplitude: { constant: 0 },
    hitIntensity: { input: 'impactTime', curve: HIT_INTENSITY }, hitRadius: { input: 'impactTime', curve: HIT_RADIUS },
    colorOverrideDesaturation: { constant: 0 }, inverseHitTime: 1,
    flatColor: [0, 0, 0],
    edgeOuterFadeRadius: 0, edgeInnerFadeRadius: 0.75, edgeScaleOuter: 19.999996, edgeScaleInner: -1.4285715,
    noiseBlendMode: 0, plasma0Intensity: 1, plasma0Sharpness: 1, noise1UScale: 1, noise1VScale: 1,
    plasma1Intensity: 1, plasma1Sharpness: 1, noise2UScale: 1, noise2VScale: 1,
    plasmaTileScale: 2, plasmaScrollSpeed: 0.1, plasmaEdgeSharpness: 0, plasmaCenterSharpness: 1,
    plasmaOuterFadeRadius: 0, plasmaInnerFadeRadius: 0.75, plasmaEdgeScaleInner: -1.4285715, plasmaEdgeScaleOuter: 19.999996,
    useHitBlob: false, exposureAmount: 1,
    noise1: { file: 'fx-83a84c7e.png', srgb: true },
    noise2: { file: 'fx-00003b45.png', srgb: true },
    hitBlob: { file: 'fx-00002520.png', srgb: true },
  }
}

const TEAM = new THREE.Color(1, 0, 1)

function look(): ShieldHitLook {
  return { gen: hitEntry(), noise1: new THREE.Texture(), noise2: new THREE.Texture() }
}

function fx(over: Partial<BodyFxState> = {}): BodyFxState {
  return {
    shield: { ...NO_SHIELD_FX },
    equip: { camo: 0, overshield: 0 },
    phase: 0,
    ally: false,
    teamColor: TEAM.clone(),
    overshieldColor: new THREE.Color(),
    camoColor: new THREE.Color(),
    shieldHit: look(),
    impacts: [],
    ...over,
  }
}

/** A hit `age` seconds old along the ray from `origin` toward -Z. */
function impact(age: number, origin = new THREE.Vector3(0, 0, 5)): ShieldImpact {
  return { origin, dir: new THREE.Vector3(0, 0, -1), age }
}

/** A skinned mesh under a root, as a Spartan copy holds them: a 1 x 2 x 1 box at the origin, one bone. */
function spartan(): THREE.Object3D {
  const root = new THREE.Group()
  const geo = new THREE.BoxGeometry(1, 2, 1, 4, 8, 4)
  const n = geo.attributes.position.count
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4))
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4))
  const bone = new THREE.Bone()
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial())
  mesh.add(bone)
  mesh.bind(new THREE.Skeleton([bone]))
  root.add(mesh)
  return root
}

describe('parseShieldHit', () => {
  it('reads the library entry', () => {
    expect(parseShieldHit({ shield_hit: hitEntry() })?.generator).toBe('70e04608')
  })

  it('answers null without the entry or with a malformed one', () => {
    expect(parseShieldHit({ shield_hit: null })).toBeNull()
    expect(parseShieldHit({})).toBeNull()
    expect(parseShieldHit({ shield_hit: { ...hitEntry(), plasmaTileScale: 'x' } })).toBeNull()
    expect(parseShieldHit({ shield_hit: { ...hitEntry(), hitIntensity: { constant: 'x' } } })).toBeNull()
    expect(parseShieldHit({ shield_hit: { ...hitEntry(), noise1: null } })).toBeNull()
    expect(parseShieldHit({ shield_hit: { ...hitEntry(), hitIntensity: { input: 'impactTime', curve: { ...HIT_INTENSITY, segments: [] } } } })).toBeNull()
    expect(parseShieldHit({ shield_hit: { ...hitEntry(), inverseHitTime: undefined } })).toBeNull()
  })
})

describe('the generator shader helpers', () => {
  it('bandMask rises from the outer radius and falls to the inner one', () => {
    const g = hitEntry()
    const band = (nv: number) => bandMask(nv, g.plasmaOuterFadeRadius, g.plasmaInnerFadeRadius, g.plasmaEdgeScaleOuter, g.plasmaEdgeScaleInner)
    expect(band(-0.1)).toBe(0) // a back face
    expect(band(0)).toBe(0)
    expect(band(0.025)).toBeCloseTo(0.5, 3)
    expect(band(0.05)).toBeCloseTo(1, 3)
    expect(band(0.4)).toBeCloseTo(0.5, 3)
    expect(band(0.75)).toBeCloseTo(0, 5)
    expect(band(1)).toBe(0) // facing the camera
  })

  it('plasmaExponent: the pattern face-on, solid at the silhouette band', () => {
    const g = hitEntry()
    expect(plasmaExponent(g, 0)).toBe(1)
    expect(plasmaExponent(g, 1)).toBe(0)
    expect(plasmaExponent(g, 0.5)).toBe(0.5)
  })

  it('evalCurve reads the hit curves as the compute shader does', () => {
    expect(evalCurve(HIT_INTENSITY, 0)).toBe(90)
    expect(evalCurve(HIT_INTENSITY, 0.10333333)).toBeCloseTo(18.86, 1)
    expect(evalCurve(HIT_INTENSITY, 0.5)).toBeCloseTo(1.42, 1)
    expect(evalCurve(HIT_INTENSITY, 1)).toBeCloseTo(0, 3)
    // The input saturates: before the impact is the impact, past 1 s is 1 s.
    expect(evalCurve(HIT_INTENSITY, -1)).toBe(90)
    expect(evalCurve(HIT_INTENSITY, 5)).toBeCloseTo(0, 3)
    expect(evalCurve(HIT_RADIUS, 0)).toBeCloseTo(0.1, 6)
    expect(evalCurve(HIT_RADIUS, 1)).toBeCloseTo(0.05, 4)
    expect(evalCurve({ rangeMin: 2, rangeMax: 4, saturate: false, segments: [{ kind: 'identity', domainMax: 1, c: [0, 0, 0, 0] }] }, 0.5)).toBe(3)
    expect(evalCurve({ rangeMin: 0, rangeMax: 1, saturate: false, segments: [{ kind: 'power', domainMax: 1, c: [0, 1, 2, 0] }] }, 0.5)).toBe(0.25)
  })

  it('propertyAt: a constant, a read curve, or null for an unread one', () => {
    expect(propertyAt({ constant: 0.005 }, 0.3)).toBe(0.005)
    expect(propertyAt({ input: 'impactTime', curve: HIT_INTENSITY }, 0)).toBe(90)
    expect(propertyAt({ input: 'impactTime' }, 0)).toBeNull()
  })
  it('constantOf falls back for an undecoded function', () => {
    expect(constantOf({ constant: 0.005 }, 9)).toBe(0.005)
    expect(constantOf({ input: 'impactTime' }, 9)).toBe(9)
  })

  it('slotColor: slot 0 not decoded, slots 1..3 desaturated, slot 4 as is', () => {
    const out = new THREE.Color()
    expect(slotColor(0, TEAM, 0, out).getHex()).toBe(0)
    expect(slotColor(3, TEAM, 0, out).equals(TEAM)).toBe(true)
    const grey = 0.2125 + 0.0721
    slotColor(3, TEAM, 1, out)
    expect([out.r, out.g, out.b].map((v) => +v.toFixed(4))).toEqual([grey, grey, grey].map((v) => +v.toFixed(4)))
    expect(slotColor(4, TEAM, 1, out).equals(TEAM)).toBe(true)
  })

  it('termColor: the slot color times the intensity; a tinting generator draws nothing', () => {
    const out = new THREE.Color()
    termColor(hitEntry(), 3, 0.5, TEAM, out)
    expect([out.r, out.g, out.b]).toEqual([0.5, 0, 0.5])
    expect(termColor({ ...hitEntry(), tintInsteadOfReplace: true }, 3, 0.5, TEAM, out).getHex()).toBe(0)
    expect(termColor(hitEntry(), 3, 0, TEAM, out).getHex()).toBe(0)
  })
})

describe('the shell draws the game impact generator around each hit', () => {
  it('a fresh hit lights a patch of the decoded radius where its ray meets the front of the body', () => {
    const shell = makeShell(spartan())
    showShell(shell, fx({ impacts: [impact(0)] }))
    const u = shell.material.uniforms
    expect(shell.meshes.every((m) => m.visible)).toBe(true)
    expect(u.uGen.value).toBe(1)
    expect(u.uImpactCount.value).toBe(1)
    const p = (u.uImpacts.value as THREE.Vector4[])[0]
    // The box's front face (z = 0.5), at the ray (x = y = 0), radius 0.1 u at the impact.
    expect([p.x, p.y, p.z]).toEqual([0, 0, 0.5])
    expect(p.w).toBeCloseTo(0.1, 6)
    expect((u.uImpactGlow.value as number[])[0]).toBeCloseTo(glowLevel(90), 6)
    expect(u.uExtrude.value).toBe(0.005)
    // The hit color is the slot's (its strength is per hit); the edge and plasma colors are constants of 0.
    expect((u.uHitCol.value as THREE.Color).equals(TEAM)).toBe(true)
    expect((u.uEdgeCol.value as THREE.Color).getHex()).toBe(0)
    expect((u.uCenterCol.value as THREE.Color).getHex()).toBe(0)
    expect((u.uPlasmaShape.value as THREE.Vector4).toArray()).toEqual([2, 0.1, 1, 0])
  })

  it('hits decay along the decoded curves, overlap, and are gone at 1 s', () => {
    const shell = makeShell(spartan())
    showShell(shell, fx({ impacts: [impact(0.1), impact(0.5, new THREE.Vector3(5, 0, 0))] }))
    const u = shell.material.uniforms
    expect(u.uImpactCount.value).toBe(2)
    const glow = u.uImpactGlow.value as number[]
    expect(glow[0]).toBeCloseTo(glowLevel(evalCurve(HIT_INTENSITY, 0.1)), 6)
    expect(glow[1]).toBeCloseTo(glowLevel(evalCurve(HIT_INTENSITY, 0.5)), 6)
    // The ray from +X along -Z misses the box: the samples nearest it, the nearest one first.
    expect((u.uImpacts.value as THREE.Vector4[])[1].w).toBeCloseTo(evalCurve(HIT_RADIUS, 0.5), 6)
    showShell(shell, fx({ impacts: [impact(1)] }))
    expect(shell.meshes.every((m) => !m.visible)).toBe(true)
  })

  it('a shield hit with no placed impact, or an unread curve, draws nothing (no whole-body flood)', () => {
    const shell = makeShell(spartan())
    showShell(shell, fx({ shield: { ...NO_SHIELD_FX, hit: 0.6, broke: 1, breakAge: 0 } }))
    expect(shell.meshes.every((m) => !m.visible)).toBe(true)
    const unread = { ...look(), gen: { ...hitEntry(), hitRadius: { input: 'impactTime' } } }
    showShell(shell, fx({ shieldHit: unread, impacts: [impact(0)] }))
    expect(shell.meshes.every((m) => !m.visible)).toBe(true)
    showShell(shell, fx({ shieldHit: null, impacts: [impact(0)] }))
    expect(shell.meshes.every((m) => !m.visible)).toBe(true)
  })

  it('litImpacts keeps the hits the curves still draw', () => {
    // The intensity curve reaches 0 (saturated) near 0.62 s.
    expect(evalCurve(HIT_INTENSITY, 0.6)).toBeGreaterThan(0)
    expect(evalCurve(HIT_INTENSITY, 0.65)).toBe(0)
    expect(litImpacts(hitEntry(), [impact(0), impact(0.5), impact(0.7), impact(1.2)])).toBe(2)
  })

  it('frontPoint takes the body point nearest the shooter along the ray', () => {
    const world = new Float32Array([0, 0, -0.5, 0, 0, 0.5, 0.01, 0, 0.45, 2, 0, 0])
    const out = new THREE.Vector3()
    expect(frontPoint(world, 4, new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1), out)).toBe(true)
    expect(out.toArray()).toEqual([0, 0, 0.5])
    expect(frontPoint(world, 4, new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, 1), out)).toBe(false)
  })

  it('the overshield alone draws neither the generator nor its extrusion', () => {
    const shell = makeShell(spartan())
    showShell(shell, fx({ equip: { camo: 0, overshield: 1 } }))
    expect(shell.material.uniforms.uGen.value).toBe(0)
    expect(shell.material.uniforms.uExtrude.value).toBe(0)
  })
})