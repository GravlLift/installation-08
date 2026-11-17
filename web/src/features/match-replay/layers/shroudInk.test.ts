// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SHROUD_INK_VARS, readShroudInk } from './shroudInk'

const root = document.documentElement

afterEach(() => {
  for (const name of Object.values(SHROUD_INK_VARS)) root.style.removeProperty(name)
})

describe('readShroudInk — the bubble inks come from the theme', () => {
  it('reads body, rim and cell from their theme variables', () => {
    root.style.setProperty(SHROUD_INK_VARS.core, 'rgb(1, 2, 3)')
    root.style.setProperty(SHROUD_INK_VARS.glow, 'rgb(4, 5, 6)')
    root.style.setProperty(SHROUD_INK_VARS.cell, 'rgb(7, 8, 9)')
    expect(readShroudInk()).toEqual({ core: 'rgb(1, 2, 3)', glow: 'rgb(4, 5, 6)', cell: 'rgb(7, 8, 9)' })
  })

  it('a missing variable reads empty, never an invented color', () => {
    expect(readShroudInk()).toEqual({ core: '', glow: '', cell: '' })
  })

  it('every variable is declared in the theme', () => {
    const css = readFileSync(join(__dirname, '../../../index.css'), 'utf8')
    for (const name of Object.values(SHROUD_INK_VARS)) expect(css).toContain(`${name}:`)
  })
})
