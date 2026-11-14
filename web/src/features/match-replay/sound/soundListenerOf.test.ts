import { describe, expect, it } from 'vitest'
import { testReplayDoc } from '../test/testDoc'
import { listenerAtOfPlayer } from './soundListenerOf'

describe('listenerAtOfPlayer', () => {
  it('interpolates position and heading along the shortest arc', () => {
    const doc = testReplayDoc({ frameIntervalMs: 100, tracks: [{
      slot: 1, team: 0, xuid: 'A', startFrame: 0, endFrame: 40,
      points: [{ t: 0, x: 0, y: 0, h: 350 }, { t: 10, x: 10, y: 0, h: 10 }],
    }] })
    expect(listenerAtOfPlayer(doc, 'A')(500)).toEqual({ x: 5, y: 0, heading: 0 })
    expect(listenerAtOfPlayer(doc, 'unknown')(500)).toBeNull()
  })
})
