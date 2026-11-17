// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import type { ReplayKill } from '../features/match-replay/model/killFeedLogic'
import {
  groupMarks, leadFrame, MARK_LEAD_SECONDS, MIN_MARK_SPACING_PX, nextEventFrame, playerEvents, previousEventFrame,
  type PlayerEvent,
} from './scrubMarks'

function kill(killer: string, victim: string, ms: number, weaponLabel = 'BR75'): ReplayKill {
  return { xuid: killer, victimXuid: victim, victimGamertag: `gt-${victim}`, replayMs: ms, weaponLabel, medals: [] } as unknown as ReplayKill
}
const nameOf = (xuid: string, fallback?: string) => ({ A: 'Alpha', B: 'Bravo', C: 'Charlie' } as Record<string, string>)[xuid] ?? fallback ?? xuid
const kills = [kill('A', 'B', 156_000), kill('C', 'A', 174_000), kill('B', 'C', 100_000), kill('A', 'C', 157_000, '')]
const medals = [{ ms: 157_200, xuid: 'A', name: 'Double Kill' }, { ms: 50_000, xuid: 'B', name: 'Perfect' }]

describe('playerEvents', () => {
  it("keeps only the selected player's kills, deaths and medals, in time order", () => {
    expect(playerEvents('A', kills, medals, nameOf)).toEqual([
      { kind: 'kill', ms: 156_000, label: 'Kill: Bravo (BR75)' },
      { kind: 'kill', ms: 157_000, label: 'Kill: Charlie' },
      { kind: 'medal', ms: 157_200, label: 'Double Kill' },
      { kind: 'death', ms: 174_000, label: 'Death: by Charlie' },
    ])
  })

  it('changes with the selected player, and is empty without one', () => {
    expect(playerEvents('B', kills, medals, nameOf).map((e) => e.kind)).toEqual(['medal', 'kill', 'death'])
    expect(playerEvents(null, kills, medals, nameOf)).toEqual([])
  })

  it('counts a self-kill as a death only', () => {
    expect(playerEvents('A', [kill('A', 'A', 10_000)], [], nameOf)).toEqual([{ kind: 'death', ms: 10_000, label: 'Death' }])
  })
})

describe('leadFrame', () => {
  it('seeks the lead before the event, inside the document', () => {
    expect(leadFrame(10_000, 30, 1000)).toBe((10 - MARK_LEAD_SECONDS) * 30)
    expect(leadFrame(500, 30, 1000)).toBe(0)
    expect(leadFrame(60_000, 30, 1000)).toBe(999)
  })
})

describe('groupMarks', () => {
  const timing = { fps: 1, frameCount: 1001 } // 1 frame per second: fraction = seconds / 1000
  const at = (kind: PlayerEvent['kind'], s: number): PlayerEvent => ({ kind, ms: s * 1000, label: `${kind}@${s}` })

  it('puts each kind in its own lane, so a medal never hides a kill at the same instant', () => {
    const marks = groupMarks([at('kill', 100), at('medal', 100), at('death', 100)], timing, 1000)
    expect(marks.map((m) => m.kind).sort()).toEqual(['death', 'kill', 'medal'])
  })

  it('groups marks of one lane closer than the minimum spacing, measured from the first', () => {
    // 1000 px wide: 1 s = 1 px. Kills at 100, 105, 107 s group; 110 s (10 px from 100) starts a new group.
    const marks = groupMarks([at('kill', 100), at('kill', 105), at('kill', 107), at('kill', 100 + MIN_MARK_SPACING_PX + 2)], timing, 1000)
    expect(marks.map((m) => m.events.length)).toEqual([3, 1])
    expect(marks[0].frame).toBe(leadFrame(100_000, 1, 1001))
    expect(marks[0].title.split('\n')).toHaveLength(3)
  })

  it('keeps marks apart on a wide bar', () => {
    expect(groupMarks([at('kill', 100), at('kill', 105)], timing, 10_000)).toHaveLength(2)
  })
})

describe('previous / next event', () => {
  const events: PlayerEvent[] = [10, 20, 30].map((s) => ({ kind: 'kill' as const, ms: s * 1000, label: '' }))
  it('finds the next lead frame after the current frame', () => {
    expect(nextEventFrame(events, 0, 1, 100)).toBe(8)
    expect(nextEventFrame(events, 8, 1, 100)).toBe(18)
    expect(nextEventFrame(events, 28, 1, 100)).toBeNull()
  })

  it('finds the previous one, stepping past the mark just jumped to', () => {
    expect(previousEventFrame(events, 18, 1, 100)).toBe(8)
    expect(previousEventFrame(events, 18.5, 1, 100)).toBe(8)
    expect(previousEventFrame(events, 25, 1, 100)).toBe(18)
    expect(previousEventFrame(events, 8, 1, 100)).toBeNull()
  })
})
