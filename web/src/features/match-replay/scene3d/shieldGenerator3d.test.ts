// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { makeShell, showShell, type BodyFxState } from './bodyShell3d'
import {
  bandMask, constantOf, hitLevel, parseShieldHit, plasmaExponent, slotColor, termColor,
  type ShieldGenerator, type ShieldHitLook,
} from './shieldGenerator3d'
import { NO_SHIELD_FX } from './shields3d'

/** The shield impact generator's entry as the library build writes it (efge 70e04608). */
function hitEntry(): ShieldGenerator {
  return {
    generator: '70e04608', additive: true, tintInsteadOfReplace: false,
    edgeColorMode: 0, plasmaCenterColorMode: 0, plasmaEdgeColorMode: 0, hitColorMode: 3, flatColorMode: 0,
    edgeGlowIntensity: { constant: 0 }, plasmaCenterIntensity: { constant: 0 }, plasmaEdgeIntensity: { constant: 0 },
    flatColorIntensity: { constant: 0 }, extrusionDistance: { constant: 0.005 }, oscillationAmplitude: { constant: 0 },
    hitIntensity: { input: 'impactTime' }, hitRadius: { input: 'impactTime' }, colorOverrideDesaturation: { constant: 0 },
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
    ...over,
  }
}

/** A skinned mesh under a root, as a Spartan copy holds them. */
function spartan(): THREE.Object3D {
  const root = new THREE.Group()
  const geo = new THREE.BoxGeometry(1, 2, 1)
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

  it('hitLevel is the hit or the break, whichever is stronger', () => {
    expect(hitLevel({ hit: 0.3, broke: 0 })).toBe(0.3)
    expect(hitLevel({ hit: 0.3, broke: 0.8 })).toBe(0.8)
    expect(hitLevel({ hit: 0, broke: 0 })).toBe(0)
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

describe('the shell draws the game impact generator', () => {
  it('a hit lights the generator in the team color at the measured level, extruded', () => {
    const shell = makeShell(spartan())
    showShell(shell, fx({ shield: { ...NO_SHIELD_FX, hit: 0.6 } }))
    const u = shell.material.uniforms
    expect(shell.meshes.every((m) => m.visible)).toBe(true)
    expect(u.uGen.value).toBe(1)
    expect(u.uExtrude.value).toBe(0.005)
    const hit = u.uHitCol.value as THREE.Color
    expect([hit.r, hit.g, hit.b]).toEqual([0.6, 0, 0.6])
    // The edge glow and the plasma colors are constants of 0 in the game's generator.
    expect((u.uEdgeCol.value as THREE.Color).getHex()).toBe(0)
    expect((u.uCenterCol.value as THREE.Color).getHex()).toBe(0)
    expect((u.uPlasmaShape.value as THREE.Vector4).toArray()).toEqual([2, 0.1, 1, 0])
  })

  it('a break drives the same generator at the break strength', () => {
    const shell = makeShell(spartan())
    showShell(shell, fx({ shield: { ...NO_SHIELD_FX, broke: 1, breakAge: 0 } }))
    expect(shell.material.uniforms.uGen.value).toBe(1)
    expect((shell.material.uniforms.uHitCol.value as THREE.Color).r).toBe(1)
  })

  it('without the library entry no hit is drawn', () => {
    const shell = makeShell(spartan())
    showShell(shell, fx({ shield: { ...NO_SHIELD_FX, hit: 0.6 }, shieldHit: null }))
    expect(shell.meshes.every((m) => !m.visible)).toBe(true)
  })

  it('the overshield alone draws neither the generator nor its extrusion', () => {
    const shell = makeShell(spartan())
    showShell(shell, fx({ equip: { camo: 0, overshield: 1 } }))
    expect(shell.material.uniforms.uGen.value).toBe(0)
    expect(shell.material.uniforms.uExtrude.value).toBe(0)
  })
})
