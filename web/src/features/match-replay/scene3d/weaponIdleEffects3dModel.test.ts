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

/**
 * The Heatwave's functions (2ac9c2ff, the twelve of its `weap` tag, read 2026-11-16 with their
 * mappings): the vent (effect fd56d1ba) is scaled by `fx_reload`, the ready glow (67537d26) by
 * `fx_ready`, and both read `fx_camo_off` or the animation-event import as their B scale.
 */
const step = (at: number) => ({ type: FN_MULTI_SPLINE, input: 0, rangeInput: 0, min: 0, max: 1, curves: [[{ end: at, coefs: [1 / at, 0] }, { end: MAX, coefs: [0, 1] }]] })
const HEATWAVE_FUNCTIONS: IdleFunction[] = [
  { import: '#568b62c5', default: 1, export: '#be38bffe' },
  { import: 'throttle_forward', default: 1, export: '#efff3c32' },
  { import: 'animation_event_function_variant_switch', default: 1, export: '#9ef8b167', turnOffWith: '#9f494a78' },
  { import: 'alt_fire', default: 1, export: '#dc94848c' },
  { import: 'primary_ammunition', default: 1, export: '#b1abb805', invert: true, mapping: step(0.0325) },
  { import: 'alt_fire', default: 1, export: '#b83efc2c', mapping: step(0.001) },
  { import: 'primary_ammunition', default: 1, export: 'fx_ready', turnOffWith: 'ready' },
  { import: 'in_inventory', default: 1, export: '#ed0bc5c3', invert: true },
  { import: 'is_reloading', default: 1, export: 'fx_reload', turnOffWith: '#9ef8b167' },
  { import: 'primary_ammunition', default: 1, export: '#9ef8b167', turnOffWith: 'fx_camo_off', invert: true },
  { import: 'camo', default: 1, export: 'fx_camo_off', mapping: { type: FN_MULTI_SPLINE, input: 0, rangeInput: 0, min: 0, max: 1, curves: [[{ end: MAX, coefs: [-1, 1] }]] } },
  { import: 'alt_fire', default: 1, export: '#5fbb5c11', invert: true },
]

describe('the Heatwave vent functions', () => {
  // The Heatwave's weapon graph (0fca8aee) sets animation_event_function_variant_switch to 1 over every
  // frame of each of its reload_1 animations (the index's reloadFunctions).
  const vent = {
    functions: HEATWAVE_FUNCTIONS, scaleA: 'fx_reload', scaleB: 'animation_event_function_variant_switch',
    reloadFunctions: { animation_event_function_variant_switch: 1 },
  } as unknown as IdleEffect
  const ready = { functions: HEATWAVE_FUNCTIONS, scaleA: 'fx_ready', scaleB: 'fx_camo_off' } as IdleEffect

  it('maps an import through its function before inverting it', () => {
    const imports = { ready: 1, is_reloading: 0, primary_ammunition: 1, camo: 0 }
    expect(functionValue(HEATWAVE_FUNCTIONS, imports, 'fx_camo_off')).toBe(1)
    expect(functionValue(HEATWAVE_FUNCTIONS, { ...imports, camo: 1 }, 'fx_camo_off')).toBe(0)
    // #b1abb805: 1 - (the magazine past 3.25%), 1 only when empty.
    expect(functionValue(HEATWAVE_FUNCTIONS, imports, '#b1abb805')).toBe(0)
    expect(functionValue(HEATWAVE_FUNCTIONS, { ...imports, primary_ammunition: 0 }, '#b1abb805')).toBe(1)
  })

  it('vents while reloading, the B scale the reload animations set', () => {
    expect(effectScales(vent, { ready: true, reloading: true })).toEqual({ scaleA: 1, scaleB: 1 })
    expect(effectScales(vent, { ready: true, reloading: false })).toEqual({ scaleA: 0, scaleB: 0 })
  })

  it('reads an import nothing feeds as 0, not as the default of the function importing it', () => {
    expect(effectScales({ ...vent, reloadFunctions: undefined }, { ready: true, reloading: true }).scaleB).toBe(0)
  })

  it('draws the ready glow at full B while not camouflaged', () => {
    expect(effectScales(ready, { ready: true, reloading: false })).toEqual({ scaleA: 1, scaleB: 1 })
    expect(effectScales(ready, { ready: false, reloading: false }).scaleA).toBe(0)
  })

  it('a turn-off name nothing defines turns nothing off; a defined one at 0 does', () => {
    expect(functionValue(HEATWAVE_FUNCTIONS, {}, '#9ef8b167')).toBe(1)
    const fns: IdleFunction[] = [{ import: 'is_reloading', default: 1, export: 'a', turnOffWith: 'b' }, { import: 'camo', default: 1, export: 'b' }]
    expect(functionValue(fns, { is_reloading: 1, camo: 0 }, 'a')).toBe(0)
    expect(functionValue(fns, { is_reloading: 1, camo: 1 }, 'a')).toBe(1)
  })
})

describe('simulateSystem, a rate below one particle a loop', () => {
  /** The vent's first-person shell (fd56d1ba system 0), trimmed: 2 a second over 0.35 s loops, 0.8 s lives. */
  const ventShell = (): IdleSystem => ({
    location: '8fb04cfa', event: 0, eventFlags: 0x0a, eventDuration: [0.35, 0.35], coordinateSystem: 1,
    cameraMode: CAMERA_FIRST_PERSON, flags: 0x00c00000, sizeScale: 1, particle: '30d0e6b2',
    emitter: {
      flags: 0, appearance: 0, particleFlags: 0, shape: 9, axisScale: [0, 1, 0], direction: [1, 0, 0],
      startingInterpolant: [0, 0, 0], billboard: 10,
      properties: {
        lifespan: { type: FN_CONSTANT, input: 1, rangeInput: 2, min: 0.8, max: 0.8 },
        emissionRate: { type: FN_IDENTITY, input: 13, rangeInput: 3, min: 0, max: 2 },
        size: { type: FN_CONSTANT, input: 13, rangeInput: 2, min: 0.01, max: 0.01 },
      },
    },
    render: { appearance: 0, blendMode: 9, shader: '96db07b6', textures: [], constants: {} },
  })

  it('still emits about rate x lifespan particles, each born once', () => {
    const on = { scaleA: 1, scaleB: 1, cameraDistance: 0 }
    let total = 0
    const ages = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const t = 10 + i * 0.05
      const ps = simulateSystem(ventShell(), t, 1, 0, on, [])
      total += ps.length
      for (const p of ps) ages.add((t - p.age).toFixed(3))
    }
    // 2 a second x 0.8 s: 1.6 alive on average; over 5 s about 10 births.
    expect(total / 100).toBeGreaterThan(1.2)
    expect(total / 100).toBeLessThan(2.0)
    expect(ages.size).toBeGreaterThanOrEqual(9)
    expect(ages.size).toBeLessThanOrEqual(12)
    expect(simulateSystem(ventShell(), 12, 1, 0, { ...on, scaleA: 0 }, [])).toHaveLength(0)
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
