/**
 * exportHud.test.ts — the export HUD resolves the team colors at PAINT TIME, not once when
 * the HUD is built: a team color changed after `createExportHud` runs (through the settings
 * CSS variables) is served by the next paint of the same frame.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { KillEvent } from '../../match-view/_momentum'
import { toReplayKills } from '../model/killFeedLogic'
import { testReplayDoc } from '../test/testDoc'
import { createExportHud } from './exportHud'

it('draws the requested player HUD without inventing an unknown player state', async () => {
  const doc = testReplayDoc()
  const ctx = {
    save: vi.fn(), restore: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(),
    arc: vi.fn(), stroke: vi.fn(), fill: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D
  const paint = await createExportHud(doc, 'unknown', [], null, null, 'en')
  paint(ctx, { width: 960, height: 540 }, 0)
  expect(ctx.save).toHaveBeenCalledOnce()
  expect(ctx.restore).toHaveBeenCalledOnce()
  expect(ctx.arc).not.toHaveBeenCalled()
})

/** A kill where an enemy ('C') takes an ally ('B'); the viewpoint ('A') is on the ally team. */
function enemyKill(): KillEvent {
  return {
    tMs: 0,
    xuid: 'C',
    ally: false,
    teamID: 1,
    weaponKey: '',
    weaponLabel: '',
    weaponImageUrl: '',
    weaponTinted: false,
    assistState: '',
    assistGamertag: '',
    assistTeamID: null,
    killerDamagePct: null,
    assistDamagePct: null,
    victimXuid: 'B',
    victimGamertag: 'Bravo',
  }
}

function doc() {
  return testReplayDoc({
    roster: [
      { filmIndex: 0, xuid: 'A', name: 'Alpha', team: 0 },
      { filmIndex: 1, xuid: 'B', name: 'Bravo', team: 0 },
      { filmIndex: 2, xuid: 'C', name: 'Charlie', team: 1 },
    ],
  })
}

/** A recording canvas context: every `fillStyle` write is captured, every method is a no-op. */
function recordingCtx() {
  const state: Record<string, unknown> = {}
  const fills: string[] = []
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop === 'measureText') return () => ({ width: 8 })
      if (typeof prop === 'string' && prop in target) return target[prop]
      return () => {}
    },
    set(target, prop, value) {
      if (prop === 'fillStyle') fills.push(String(value))
      target[prop as string] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, fills }
}

const VIEW = { width: 1280, height: 720 }

beforeEach(() => {
  localStorage.clear()
  // jsdom does not load index.css: pose the defaults the way the app does.
  document.documentElement.style.setProperty('--team-ally', '#22c55e')
  document.documentElement.style.setProperty('--team-enemy', '#ef4444')
})

afterEach(() => {
  document.documentElement.style.removeProperty('--team-ally')
  document.documentElement.style.removeProperty('--team-enemy')
})

describe('createExportHud', () => {
  it('paints the kill feed with the team colors current at paint time', async () => {
    const hud = await createExportHud(doc(), 'A', toReplayKills([enemyKill()], 0), null, null, 'en')

    const first = recordingCtx()
    hud(first.ctx, VIEW, 100)
    expect(first.fills).toContain('#ef4444')
    expect(first.fills).toContain('#22c55e')

    // The user changes the enemy color after the HUD was built (the settings section does
    // exactly this on the document root).
    document.documentElement.style.setProperty('--team-enemy', '#8b5cf6')

    const second = recordingCtx()
    hud(second.ctx, VIEW, 100)
    expect(second.fills).toContain('#8b5cf6')
    expect(second.fills).not.toContain('#ef4444')
  })
})
