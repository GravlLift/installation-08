// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { BLAST_LIFT, blastLiftOver } from './explosions3d'

describe('blastLiftOver', () => {
  it('lifts a blast on the floor by the full lift, so the flash discs clear the ground', () => {
    expect(blastLiftOver(4.6, 4.6)).toBeCloseTo(BLAST_LIFT)
    expect(blastLiftOver(4.6, null)).toBe(BLAST_LIFT)
  })

  it('keeps a detonation in the air at its own point (a plasma stuck at a head: 0.42 u up)', () => {
    expect(blastLiftOver(5.02, 4.6)).toBe(0)
  })

  it('lifts a low detonation only up to the floor clearance', () => {
    expect(blastLiftOver(4.7, 4.6)).toBeCloseTo(BLAST_LIFT - 0.1)
  })
})
