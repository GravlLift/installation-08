/**
 * Replay3DView.hud.test.tsx — the HUD (ReplayAth3d) draws its first-person equipment (reticle,
 * ammo, reserve, grenades) only in first person; third person, free view and the top-down view
 * pass `scoreOnly` (Replay3DView) and keep the score strip alone. The 3D view itself needs
 * three.js and WebGL, so this mounts the HUD component directly.
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

describe('ReplayAth3d draws first-person equipment in first person only', () => {
  it('shows magazine, reserve and the reticle in first person', () => {
    const { container } = render(
      <ReplayAth3d doc={hudDoc()} xuid="A" frameRef={frameRef} locale="en" kills={[]} playWindow={null} timeLimitMs={null} />,
    )
    expect(container.textContent).toContain('13')
    expect(container.textContent).toContain('42')
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('keeps only the score strip outside first person (third person, free view, top-down)', () => {
    const { container } = render(
      <ReplayAth3d doc={hudDoc()} xuid="A" frameRef={frameRef} locale="en" kills={[]} playWindow={null} timeLimitMs={null} scoreOnly />,
    )
    expect(container.textContent).not.toContain('13')
    expect(container.textContent).not.toContain('42')
    expect(container.querySelector('svg')).toBeNull()
  })
})
