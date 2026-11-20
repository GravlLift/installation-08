// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { buildCoverage, coverageWarning, renderDrawsOf, type Ledger } from './renderCoverage'

const KAMUZ = { gamertag: 'KamUz 7w7', xuid: 'K', team: 0 }
const BC0R = { gamertag: 'BC0R', xuid: 'B', team: 1 }

/** The game winner of 9220185c as the ledger answers it (frames x 33 ms). */
const LEDGER: Ledger = {
  events: [
    { id: 'action/1219', kind: 'throwStart', frame: 13184, ms: 435072, actor: KAMUZ },
    { id: 'action/1220', kind: 'melee', frame: 13191, ms: 435303, actor: BC0R },
    { id: 'grenade/146', kind: 'grenade', frame: 13193, ms: 435369, actor: KAMUZ },
    { id: 'death/613', kind: 'death', frame: 13195, ms: 435435, actor: KAMUZ },
    { id: 'score/1/49', kind: 'score', frame: 13195, ms: 435435, actor: { team: 1 } },
    { id: 'kill/B/K/2', kind: 'kill', frame: 13196, ms: 435474, actor: BC0R, target: KAMUZ },
    { id: 'detonation/grenade/146', kind: 'detonation', frame: 13222, ms: 436326, actor: KAMUZ },
    { id: 'death/606', kind: 'death', frame: 13222, ms: 436326, actor: BC0R },
    { id: 'score/0/50', kind: 'score', frame: 13222, ms: 436326, actor: { team: 0 } },
    { id: 'kill/K/B/2', kind: 'kill', frame: 13223, ms: 436356, actor: KAMUZ, target: BC0R },
    { id: 'medal/K/413752/Stick', kind: 'medal', frame: 13223, ms: 436357, actor: KAMUZ },
    // Outside the window.
    { id: 'shot/9', kind: 'shot', frame: 13300, ms: 438900, actor: BC0R },
  ],
  notes: [],
}

const doc = { frameIntervalMs: 33 }
const marks = (entries: [string, string[], number][]) => new Map(entries.map(([id, by, last]) => [id, { by, first: last, last }]))

describe('renderDrawsOf', () => {
  it("spans the plan's film frames, first to last, on the document clock", () => {
    const d = renderDrawsOf(new Map(), [13160.5, 13154.6, 13265.9, 13265.9], doc, false)
    expect(d.window).toEqual({ fromFrame: 13154, toFrame: 13266, fromMs: 434082, toMs: 437778 })
    expect(d.hud).toBe(false)
  })
})

describe('buildCoverage', () => {
  it('joins every event of the window to what drew it, and names what nothing drew', () => {
    const draws = renderDrawsOf(
      marks([
        ['action/1220', ['motion3d/meleeStart'], 13195],
        ['grenade/146', ['flights3d/stuck', 'motion3d/grenade'], 13221],
        ['death/613', ['corpses3d/body'], 13230],
        ['detonation/grenade/146', ['flights3d/explosion'], 13240],
        ['death/606', ['corpses3d/body'], 13260],
      ]),
      [13154, 13266],
      doc,
      false,
    )
    const c = buildCoverage(LEDGER, draws)
    expect(c.events.map((e) => [e.kind, e.drawn, e.by])).toEqual([
      ['throwStart', false, null],
      ['melee', true, 'motion3d/meleeStart'],
      ['grenade', true, 'flights3d/stuck + motion3d/grenade'],
      ['death', true, 'corpses3d/body'],
      ['score', false, 'hud-hidden'],
      ['kill', false, 'hud-hidden'],
      ['detonation', true, 'flights3d/explosion'],
      ['death', true, 'corpses3d/body'],
      ['score', false, 'hud-hidden'],
      ['kill', false, 'hud-hidden'],
      ['medal', false, 'hud-hidden'],
    ])
    expect(c.events[5]).toEqual({ id: 'kill/B/K/2', kind: 'kill', frame: 13196, actor: 'BC0R', target: 'KamUz 7w7', drawn: false, by: 'hud-hidden' })
    expect(c.events[4].actor).toBe('team 1')
    expect(c.summary).toEqual({
      events: 11,
      drawn: 5,
      undrawn: 6,
      undrawnByKind: { throwStart: 1, score: 2, kill: 2, medal: 1 },
      byKind: {
        throwStart: { events: 1, drawn: 0, undrawn: 1 },
        melee: { events: 1, drawn: 1, undrawn: 0 },
        grenade: { events: 1, drawn: 1, undrawn: 0 },
        death: { events: 2, drawn: 2, undrawn: 0 },
        score: { events: 2, drawn: 0, undrawn: 2 },
        kill: { events: 2, drawn: 0, undrawn: 2 },
        detonation: { events: 1, drawn: 1, undrawn: 0 },
        medal: { events: 1, drawn: 0, undrawn: 1 },
      },
    })
    expect(coverageWarning(c)).toBe('[replay-export] 6 of 11 events in frames 13154-13266 were not drawn: throwStart 1, score 2, kill 2, medal 1')
  })

  it('with the HUD painted, an undrawn kill is a plain miss; a score value counts only from its tick on', () => {
    const draws = renderDrawsOf(
      marks([
        ['kill/K/B/2', ['exportHud/killFeed'], 13300],
        // 49 painted for team 1 before its tick at 13195 only (another tick of the same value): not this one.
        ['score/1/49', ['exportHud/score'], 13190],
        ['score/0/50', ['exportHud/score'], 13266],
      ]),
      [13154, 13266],
      doc,
      true,
    )
    const byId = new Map(buildCoverage(LEDGER, draws).events.map((e) => [e.id, e]))
    expect(byId.get('kill/K/B/2')).toMatchObject({ drawn: true, by: 'exportHud/killFeed' })
    expect(byId.get('kill/B/K/2')).toMatchObject({ drawn: false, by: null })
    expect(byId.get('score/1/49')).toMatchObject({ drawn: false, by: null })
    expect(byId.get('score/0/50')).toMatchObject({ drawn: true, by: 'exportHud/score' })
  })

  it('says why when the ledger could not be read', () => {
    expect(coverageWarning({ window: { fromFrame: 0, toFrame: 1, fromMs: 0, toMs: 33 }, error: 'HTTP 404' })).toBe('[replay-export] render coverage unavailable: HTTP 404')
    expect(coverageWarning(null)).toBeNull()
  })
})
