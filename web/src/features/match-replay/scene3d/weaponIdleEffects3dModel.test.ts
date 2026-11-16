import { describe, expect, it } from 'vitest'

import {
  CAMERA_FIRST_PERSON,
  CAMERA_THIRD_PERSON,
  FN_CONSTANT,
  FN_IDENTITY,
  FN_MULTI_SPLINE,
  SYSTEM_KILLED_WITH_EVENT,
  SYSTEM_NO_ADS,
  curveAt,
  effectScales,
  functionValue,
  parseIdleEffects,
  propertyAt,
  reloadingAt,
  simulateSystem,
  systemShown,
  type IdleEffect,
  type IdleFunction,
  type IdleSystem,
  type LiveParticle,
} from './weaponIdleEffects3dModel'

const MAX = 3.4028234663852886e38

/** The Shock Rifle's functions, as the index carries them (`internal/weapons` gamefiles pin). */
const SHOCK_FUNCTIONS: IdleFunction[] = [
  { import: 'ready', default: 1, export: 'fx_ready', turnOffWith: 'fx_reloading' },
  { import: 'is_reloading', default: 1, export: 'fx_reloading', turnOffWith: 'fx_ammo', invert: true },
  { import: 'primary_ammunition', default: 1, export: 'fx_ammo' },
  { import: 'camo', default: 1, export: '#118a9c27', invert: true },
]

/** The arcs (system 0 of effect 1e471031), trimmed to the properties the simulation reads. */
function arcs(): IdleSystem {
  return {
    location: '55990be4', event: 0, eventFlags: 0x0a, eventDuration: [1, 1], coordinateSystem: 1,
    cameraMode: CAMERA_FIRST_PERSON, flags: 0x00610000, sizeScale: 1, particle: 'c2c1d7da',
    emitter: {
      flags: 0, appearance: 0, particleFlags: 0, shape: 10, axisScale: [0.045, 0, 1], direction: [1, 0, 0],
      startingInterpolant: [0, 0, 0], billboard: 3,
      properties: {
        lifespan: { type: FN_CONSTANT, input: 1, rangeInput: 24, ranged: true, min: 0.2, max: 0.135 },
        emissionRate: { type: FN_MULTI_SPLINE, input: 14, rangeInput: 14, min: 0, max: 8, curves: [[{ end: MAX, coefs: [0.0625, -1.125, 2.0625, 0] }]] },
        maxCount: { type: FN_CONSTANT, input: 1, rangeInput: 3, min: 12, max: 12 },
        size: { type: FN_MULTI_SPLINE, input: 0, rangeInput: 22, ranged: true, min: 0.01, max: 0.042, curves: [[{ end: MAX, coefs: [0, 1] }], [{ end: MAX, coefs: [0, 1] }]] },
        alpha: { type: FN_MULTI_SPLINE, input: 0, rangeInput: 2, min: 1, max: 0, curves: [[{ end: 0.8983333, coefs: [0, 0] }, { end: MAX, coefs: [9.836063, -8.836063] }]] },
        intensity: { type: FN_CONSTANT, input: 0, rangeInput: 2, min: 200, max: 200 },
        tint: { type: FN_CONSTANT, input: 1, rangeInput: 3, min: 0, max: 0, color: [1, 1, 1] },
      },
    },
    render: { appearance: 0, blendMode: 9, shader: '9b1c511e', textures: [], constants: {} },
  }
}

describe('weapon idle effect functions', () => {
  it('evaluates a multi-spline piece by piece', () => {
    const alpha = [{ end: 0.8983333, coefs: [0, 0] }, { end: MAX, coefs: [9.836063, -8.836063] }]
    expect(curveAt(alpha, 0.5)).toBe(0)
    expect(curveAt(alpha, 1)).toBeCloseTo(1, 5)
    // The arcs' emission rate at effect scale B = 1: 8 a second.
    const rate = { type: FN_MULTI_SPLINE, input: 14, rangeInput: 14, min: 0, max: 8, curves: [[{ end: MAX, coefs: [0.0625, -1.125, 2.0625, 0] }]] }
    expect(propertyAt(rate, () => 1)).toBeCloseTo(8, 5)
    expect(propertyAt(rate, () => 0)).toBe(0)
  })

  it('mixes a ranged constant by its range input, an identity by its input', () => {
    const life = { type: FN_CONSTANT, input: 1, rangeInput: 24, ranged: true, min: 0.2, max: 0.135 }
    expect(propertyAt(life, (k) => (k === 24 ? 0 : 0.7))).toBeCloseTo(0.2)
    expect(propertyAt(life, (k) => (k === 24 ? 1 : 0.7))).toBeCloseTo(0.135)
    expect(propertyAt({ type: FN_IDENTITY, input: 13, rangeInput: 2, min: 0, max: 20 }, (k) => (k === 13 ? 0.5 : 0))).toBe(10)
  })

  it('turns the Shock Rifle effect off while reloading and while not ready', () => {
    const imports = (ready: number, reloading: number) => ({ ready, is_reloading: reloading, primary_ammunition: 1, camo: 0 })
    expect(functionValue(SHOCK_FUNCTIONS, imports(1, 0), 'fx_ready')).toBe(1)
    expect(functionValue(SHOCK_FUNCTIONS, imports(1, 1), 'fx_ready')).toBe(0)
    expect(functionValue(SHOCK_FUNCTIONS, imports(0, 0), 'fx_ready')).toBe(0)
    // Empty: fx_ammo 0 turns fx_reloading off, which turns fx_ready off.
    expect(functionValue(SHOCK_FUNCTIONS, { ...imports(1, 0), primary_ammunition: 0 }, 'fx_ready')).toBe(0)
    expect(functionValue(SHOCK_FUNCTIONS, imports(1, 0), '#118a9c27')).toBe(1)
    const e = { functions: SHOCK_FUNCTIONS, scaleA: 'fx_ready', scaleB: '#118a9c27' } as IdleEffect
    expect(effectScales(e, { ready: true, reloading: false })).toEqual({ scaleA: 1, scaleB: 1 })
    expect(effectScales(e, { ready: true, reloading: true }).scaleA).toBe(0)
  })
})

describe('simulateSystem', () => {
  const on = { scaleA: 1, scaleB: 1, cameraDistance: 0 }

  it('is deterministic in time and seed, and differs between holders', () => {
    const a = simulateSystem(arcs(), 12.34, 3, 0, on, []).map((p) => [p.x, p.size, p.alpha])
    const b = simulateSystem(arcs(), 12.34, 3, 0, on, []).map((p) => [p.x, p.size, p.alpha])
    const c = simulateSystem(arcs(), 12.34, 4, 0, on, []).map((p) => [p.x, p.size, p.alpha])
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('emits about rate x lifespan arcs along the housing, none when scale B is 0', () => {
    let total = 0
    const out: LiveParticle[] = []
    for (let f = 0; f < 600; f++) {
      for (const p of simulateSystem(arcs(), f / 60, 1, 0, on, out)) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(0.045)
        expect(p.y).toBe(0)
        expect(p.size).toBeGreaterThan(0)
        expect(p.size).toBeLessThan(0.05)
        expect(p.alpha).toBeGreaterThanOrEqual(0)
        expect(p.alpha).toBeLessThanOrEqual(1)
      }
      total += out.length
    }
    // 8 a second living 0.135..0.2 s: about 1.4 at once.
    expect(total / 600).toBeGreaterThan(0.8)
    expect(total / 600).toBeLessThan(2.2)
    expect(simulateSystem(arcs(), 3, 1, 0, { ...on, scaleB: 0 }, out)).toHaveLength(0)
  })

  it('keeps a hard-killed system to its loop and spans loops otherwise', () => {
    const long = arcs()
    long.emitter.properties.lifespan = { type: FN_CONSTANT, input: 1, rangeInput: 24, min: 1.5, max: 1.5 }
    long.emitter.properties.maxCount = { type: FN_CONSTANT, input: 1, rangeInput: 3, min: 0, max: 0 }
    const spanning = Math.max(...Array.from({ length: 60 }, (_, f) => simulateSystem(long, 10 + f / 60, 1, 0, on, []).length))
    long.flags |= SYSTEM_KILLED_WITH_EVENT
    const killed = Math.max(...Array.from({ length: 60 }, (_, f) => simulateSystem(long, 10 + f / 60, 1, 0, on, []).length))
    expect(spanning).toBeGreaterThan(killed)
    expect(killed).toBeLessThanOrEqual(8)
  })
})

describe('gating', () => {
  it('draws first-person systems on the rig, third-person ones outside, none of the ADS-off ones scoped', () => {
    const fp = { ...arcs(), cameraMode: CAMERA_FIRST_PERSON, flags: SYSTEM_NO_ADS }
    const tp = { ...arcs(), cameraMode: CAMERA_THIRD_PERSON, flags: 0 }
    expect(systemShown(fp, true, false)).toBe(true)
    expect(systemShown(fp, false, false)).toBe(false)
    expect(systemShown(fp, true, true)).toBe(false)
    expect(systemShown(tp, false, false)).toBe(true)
    expect(systemShown(tp, true, false)).toBe(false)
  })

  it('reloads from the start to the clip end or the last stage, cut by a shot', () => {
    const spans = [{ start: 100, lastStage: 130 }]
    expect(reloadingAt(spans, 99, 60, 2, [])).toBe(false)
    expect(reloadingAt(spans, 150, 60, 2, [])).toBe(true)
    expect(reloadingAt(spans, 220, 60, 2, [])).toBe(false)
    expect(reloadingAt(spans, 125, 60, null, [])).toBe(true)
    expect(reloadingAt(spans, 135, 60, null, [])).toBe(false)
    expect(reloadingAt(spans, 150, 60, 2, [140])).toBe(false)
  })
})

describe('parseIdleEffects', () => {
  it('reads the table and drops malformed entries; null without the field', () => {
    expect(parseIdleEffects({ schema: 4 })).toBeNull()
    const t = parseIdleEffects({
      idle_effects: {
        '1a22fee6': [{ effect: '1e471031', scaleA: 'fx_ready', scaleB: '', functions: [], markers: {}, systems: [] }],
        bad: [{ effect: 'x' }],
      },
    })
    expect(Object.keys(t!)).toEqual(['1a22fee6'])
  })
})
