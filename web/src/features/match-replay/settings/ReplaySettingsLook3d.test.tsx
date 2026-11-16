/**
 * ReplaySettingsLook3d.test.tsx — the drawer's "3D view" section carries the Bloom switch, on by
 * default, and flipping it writes the persisted setting the 3D view reads.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { registerReplay3DExport, type Replay3DExportEntry } from '../export/replay3dExportStore'
import { SCENE3D_TEXT } from '../i18n/scene3dText'
import { Look3dSection } from './ReplaySettingsLook3d'
import { BLOOM_KEY } from './useReplay3dLook'

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

it.each(['en', 'fr'] as const)('shows the Bloom switch on by default and persists its flip (%s)', (locale) => {
  render(<Look3dSection locale={locale} />)
  const toggle = screen.getByRole('switch', { name: SCENE3D_TEXT[locale].lookBloom })
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  expect(toggle.getAttribute('title')).toBe(SCENE3D_TEXT[locale].lookBloomHint)
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect(localStorage.getItem(BLOOM_KEY)).toBe('false')
})
