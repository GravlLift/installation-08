// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ReplaySettingsLook3d.test.tsx — the drawer's "3D view" section carries the Bloom and glow
 * animation switches, on by default, and flipping one writes the persisted setting the 3D view reads.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { registerReplay3DExport, type Replay3DExportEntry } from '../export/replay3dExportStore'
import { SCENE3D_TEXT } from '../i18n/scene3dText'
import { Look3dSection } from './ReplaySettingsLook3d'
import { BLOOM_KEY, GLOW_ANIMATION_KEY } from './useReplay3dLook'

let unregister: (() => void) | null = null

beforeEach(() => {
  localStorage.clear()
  // The section shows once a 3D map is loaded (a registered export source).
  unregister = registerReplay3DExport({} as Replay3DExportEntry)
})

afterEach(() => {
  cleanup()
  unregister?.()
  unregister = null
})

it('shows the Bloom switch on by default and persists its flip', () => {
  render(<Look3dSection locale="en" />)
  const toggle = screen.getByRole('switch', { name: SCENE3D_TEXT.en.lookBloom })
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  expect(toggle.getAttribute('title')).toBe(SCENE3D_TEXT.en.lookBloomHint)
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect(localStorage.getItem(BLOOM_KEY)).toBe('false')
})

it('shows the glow animation switch on by default and persists its flip', () => {
  render(<Look3dSection locale="en" />)
  const toggle = screen.getByRole('switch', { name: SCENE3D_TEXT.en.lookGlowAnimation })
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  expect(toggle.getAttribute('title')).toBe(SCENE3D_TEXT.en.lookGlowAnimationHint)
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect(localStorage.getItem(GLOW_ANIMATION_KEY)).toBe('false')
  // Bloom stays as it was.
  expect(screen.getByRole('switch', { name: SCENE3D_TEXT.en.lookBloom }).getAttribute('aria-checked')).toBe('true')
})
