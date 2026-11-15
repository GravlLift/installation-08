import { afterEach, describe, expect, it } from 'vitest'

import { PERF_TOGGLES_DEFAULT, currentPerfToggles, installPerfToggles, readPerfToggles, type PerfToggles } from './perfToggles3d'

const fresh = (): PerfToggles => ({ ...PERF_TOGGLES_DEFAULT })

describe('perfToggles3d', () => {
  afterEach(() => { delete window.__it3dPerfToggles })

  it('reads defaults from nothing or garbage', () => {
    expect(readPerfToggles(undefined, fresh())).toEqual(PERF_TOGGLES_DEFAULT)
    expect(readPerfToggles('x', fresh())).toEqual(PERF_TOGGLES_DEFAULT)
    expect(readPerfToggles({ outline: 'no', pixelRatio: '1' }, fresh())).toEqual(PERF_TOGGLES_DEFAULT)
  })

  it('takes booleans and a bounded pixel ratio', () => {
    const t = readPerfToggles({ variant: false, shadows: false, pixelRatio: 0.5 }, fresh())
    expect(t).toEqual({ ...PERF_TOGGLES_DEFAULT, variant: false, shadows: false, pixelRatio: 0.5 })
    expect(readPerfToggles({ pixelRatio: 10 }, fresh()).pixelRatio).toBeNull()
    expect(readPerfToggles({ pixelRatio: NaN }, fresh()).pixelRatio).toBeNull()
  })

  it('returns a field to its default once the console deletes it', () => {
    const out = fresh()
    readPerfToggles({ outline: false }, out)
    readPerfToggles({}, out)
    expect(out.outline).toBe(true)
  })

  it('installs the defaults on window without overwriting what the console set', () => {
    installPerfToggles()
    expect(window.__it3dPerfToggles).toEqual(PERF_TOGGLES_DEFAULT)
    window.__it3dPerfToggles!.minimap = false
    installPerfToggles()
    expect(currentPerfToggles(fresh()).minimap).toBe(false)
  })
})
