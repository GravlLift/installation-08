// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import type { ReplayDocumentReady } from './replayNormalize'
import { vitalityPresence } from './rosterLogic'

const docOf = (points: object[], records?: number) =>
  ({ tracks: [{ points }], coverage: records === undefined ? undefined : { keyframes: { records } } }) as unknown as ReplayDocumentReady

describe('vitalityPresence', () => {
  it('has a shield when a point carries one', () => {
    expect(vitalityPresence(docOf([{ t: 0, sh: 0.5 }])).shield).toBe(true)
  })

  it('has a shield when the bipeds\' records were read and none changed it (nobody was hurt)', () => {
    expect(vitalityPresence(docOf([{ t: 0 }], 10283)).shield).toBe(true)
  })

  it('has none when nothing says the shield was readable', () => {
    expect(vitalityPresence(docOf([{ t: 0 }])).shield).toBe(false)
    expect(vitalityPresence(docOf([{ t: 0 }], 0)).shield).toBe(false)
  })
})
