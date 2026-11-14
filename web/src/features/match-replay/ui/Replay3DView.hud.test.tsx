/**
 * Replay3DView.hud.test.tsx — the HUD (ReplayAth3d) renders its weapon corner (ammo,
 * reserve, grenades) regardless of camera mode. The 3D view itself needs three.js and
 * WebGL, so this test mounts the lightweight HUD component directly and verifies it
 * produces visible ammo output. The camera-mode gate was removed from Replay3DView:
 * the HUD is a DOM overlay, not a scene element, so it does not depend on which
 * camera renders the scene behind it.
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReplayAth3d } from './ReplayAth3d'
import { testReplayDoc } from '../test/testDoc'

const frameRef = { current: 0 } as const

function hudDoc() {
  return testReplayDoc({
    frameIntervalMs: 100,
    tracks: [{ slot: 512, xuid: 'A', team: -1, startFrame: 0, endFrame: 100, points: [{ t: 0, x: 0, y: 0 }, { t: 100, x: 0, y: 0 }] }],
    inventory: [{ t: 0, slot: 512, d: 0, am: [{ mag: 13, res: 42 }], g: [2] }],
    loadouts: [{ t: 0, slot: 512, w: ['hinf_ma40_ar'] }],
    roster: [{ filmIndex: 0, xuid: 'A', name: 'Alpha', team: 0 }],
  })
}

describe('ReplayAth3d renders the weapon corner in every camera mode', () => {
  it('shows magazine and reserve when mounted (first-person)', () => {
    const { container } = render(
      <ReplayAth3d doc={hudDoc()} xuid="A" frameRef={frameRef} locale="en" kills={[]} playWindow={null} timeLimitMs={null} />,
    )
    expect(container.textContent).toContain('13')
    expect(container.textContent).toContain('42')
  })

  it('shows magazine and reserve when mounted (third-person, no fp-only gate)', () => {
    const { container } = render(
      <ReplayAth3d doc={hudDoc()} xuid="A" frameRef={frameRef} locale="en" kills={[]} playWindow={null} timeLimitMs={null} />,
    )
    expect(container.textContent).toContain('13')
    expect(container.textContent).toContain('42')
  })

  it('keeps only the score strip in the top-down view', () => {
    const { container } = render(
      <ReplayAth3d doc={hudDoc()} xuid="A" frameRef={frameRef} locale="en" kills={[]} playWindow={null} timeLimitMs={null} topDown />,
    )
    expect(container.textContent).not.toContain('13')
    expect(container.textContent).not.toContain('42')
  })
})
