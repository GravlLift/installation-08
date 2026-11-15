import { describe, expect, it } from 'vitest'

import { reloadReadings } from './reloadStarts'

const reload = (slot: number, ms: number) => ({ t: Math.round(ms / 33), ms, slot, kind: 'reload' })

describe('reloadReadings', () => {
  it('a single reload message starts a reload, sorted per life', () => {
    const doc = { actions: [reload(1, 900), reload(1, 300), reload(2, 500), { t: 3, ms: 100, slot: 1, kind: 'melee' }] }
    expect(reloadReadings(doc)).toEqual(new Map([[1, { starts: [300, 900], cuts: [] }], [2, { starts: [500], cuts: [] }]]))
  })

  it('an instant the film writes two or more times for the same life (an equipment use) cuts instead of starting', () => {
    const doc = { actions: [reload(1, 300), reload(1, 300), reload(1, 300), reload(1, 300), reload(1, 700), reload(1, 200), reload(1, 200), reload(2, 300)] }
    expect(reloadReadings(doc)).toEqual(new Map([[1, { starts: [700], cuts: [200, 300] }], [2, { starts: [300], cuts: [] }]]))
  })
})
