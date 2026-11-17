// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * Replay3DView.hud.test.tsx — what the HUD (ReplayAth3d) draws at each level (`hudLevel`):
 * first person everything; third person the followed player's whole HUD (weapon corner with
 * magazine and reserve, as pinned since 1e3164c) but no reticle; free view no weapon corner;
 * 2D the score strip alone. The 3D view itself needs three.js and WebGL, so this mounts the
 * HUD component directly.
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReplayAth3d } from './ReplayAth3d'
import type { HudLevel } from '../model/hudLevel'
import { testReplayDoc } from '../test/testDoc'
import { prepareCallouts } from '../model/mapCallouts'

const frameRef = { current: 0 } as const

function hudDoc() {
  return testReplayDoc({
    frameIntervalMs: 100,
    tracks: [{ slot: 512, xuid: 'A', team: -1, startFrame: 0, endFrame: 100, points: [{ t: 0, x: 0, y: 0 }, { t: 100, x: 0, y: 0 }] }],
    inventory: [{ t: 0, slot: 512, d: 0, am: [{ mag: 13, res: 42 }], g: [2] }],
    loadouts: [{ t: 0, slot: 512, w: ['hinf_ma40_ar'] }],
    roster: [{ filmIndex: 0, xuid: 'A', name: 'Alpha', team: 0 }],
    abilityLabels: { '12': { en: 'Threat Seeker', fr: 'traqueur de menaces', family: 'threat_seeker' } },
    abilities: [{ t: 0, slot: 512, r: 12, src: 'i48' }],
    equipmentChanges: [{ t: 0, slot: 512, kind: 'taken', r: 12, from: -1 }],
    carriedEquipment: [{ slot: 512, r: 12, t0: 0, t1: 100, energy: [{ t: 0, e: 1, n: 2, tag: true }], uses: [] }],
  })
}

const callouts = prepareCallouts({ version: 1, source: 'level', zones: [{ en: 'Overhang', polygon: [[-1, -1], [1, -1], [1, 1], [-1, 1]], zBottom: -1, zTop: 2 }] })

function renderHud(hud?: HudLevel, withCallouts = false) {
  return render(
    <ReplayAth3d doc={hudDoc()} xuid="A" frameRef={frameRef} locale="en" kills={[]} playWindow={null} timeLimitMs={null} hud={hud} callouts={withCallouts ? callouts : null} />,
  ).container
}

describe('ReplayAth3d at each HUD level', () => {
  it('first person: weapon corner and reticle', () => {
    const container = renderHud('full')
    expect(container.textContent).toContain('13')
    expect(container.textContent).toContain('42')
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('third person: the weapon corner renders magazine and reserve', () => {
    const container = renderHud('noReticle')
    expect(container.textContent).toContain('13')
    expect(container.textContent).toContain('42')
  })

  it('first and third person: the equipment slot beside the grenades, with its uses left', () => {
    for (const hud of ['full', 'noReticle'] as const) {
      expect(renderHud(hud).querySelector('[data-hud-equipment="threat_seeker"]')?.getAttribute('aria-label')).toBe('Threat Seeker 2')
    }
    expect(renderHud('spectator').querySelector('[data-hud-equipment]')).toBeNull()
  })

  it('third person: no reticle', () => {
    expect(renderHud('noReticle').querySelector('svg')).toBeNull()
  })

  it('free view: no weapon corner and no reticle', () => {
    const container = renderHud('spectator')
    expect(container.textContent).not.toContain('13')
    expect(container.textContent).not.toContain('42')
    expect(container.querySelector('svg')).toBeNull()
  })

  it('2D: the score strip alone', () => {
    const container = renderHud('score')
    expect(container.textContent).not.toContain('13')
    expect(container.querySelector('[role="list"]')).toBeNull()
  })

  it('first and third person: the place name under the motion tracker, none without areas', () => {
    for (const hud of ['full', 'noReticle'] as const) {
      expect(renderHud(hud, true).querySelector('[data-hud-callout]')?.textContent).toBe('Overhang')
      expect(renderHud(hud).querySelector('[data-hud-callout]')).toBeNull()
    }
    expect(renderHud('spectator', true).querySelector('[data-hud-callout]')).toBeNull()
  })

  it('free view keeps the kill feed', () => {
    expect(renderHud('spectator').querySelector('[role="list"]')).not.toBeNull()
  })
})
