// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ReplaySettingsDrawer.test.tsx — the texture-quality section in the drawer: both choices
 * render, the high hint is on screen, choosing High is persisted (the match view reads the
 * same key), and the radio state follows the choice.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'

import { ReplaySettingsDrawer } from './ReplaySettingsDrawer'
import type { Action3dShow } from '../scene3d/action3dInputs'
import type { ReplaySound } from '../sound/useReplaySound'

const QUALITY_KEY = 'replay-texture-quality'

const show: Action3dShow = {
  shots: false,
  kills: false,
  weaponPads: false,
  groundWeapons: false,
  groundWeaponsSpecialOnly: false,
  groundWeaponsStarting: false,
  placements: false,
  vehicles: false,
  objectives: false,
  flags: false,
  vipCrown: false,
  bombCarrier: false,
}
const toggle = Object.fromEntries(Object.keys(show).map((key) => [key, () => {}])) as {
  [K in keyof Action3dShow]: () => void
}
const sound = {
  categories: { weapon: false, grenade: false, melee: false, equipment: false, announcer: false },
  toggleCategory: () => {},
} as unknown as ReplaySound

beforeEach(() => {
  localStorage.clear()
})

function openDrawer() {
  return render(
    <ReplaySettingsDrawer locale="en" sound={sound} show={show} toggle={toggle} onClose={() => {}} />,
  )
}

it('shows the section with both choices and the high hint', () => {
  openDrawer()
  expect(screen.getByText('Texture quality')).toBeTruthy()
  expect(screen.getByTestId('texture-quality-standard').getAttribute('aria-checked')).toBe('true')
  expect(screen.getByTestId('texture-quality-high').getAttribute('aria-checked')).toBe('false')
  expect(screen.getByText(/about 4x graphics memory/i)).toBeTruthy()
})

it('persists choosing High to the shared key', () => {
  openDrawer()
  fireEvent.click(screen.getByTestId('texture-quality-high'))
  expect(localStorage.getItem(QUALITY_KEY)).toBe('high')
  expect(screen.getByTestId('texture-quality-high').getAttribute('aria-checked')).toBe('true')
  expect(screen.getByTestId('texture-quality-standard').getAttribute('aria-checked')).toBe('false')
})

it('renders the persisted High as selected on open', () => {
  localStorage.setItem(QUALITY_KEY, 'high')
  openDrawer()
  expect(screen.getByTestId('texture-quality-high').getAttribute('aria-checked')).toBe('true')
})
