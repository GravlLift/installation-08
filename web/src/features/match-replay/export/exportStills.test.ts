// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { stillIndices } from './exportStills'

describe('stillIndices', () => {
  const ms = [0, 16.7, 33.3, 50, 66.7]

  it('picks the nearest frame for each time, in the order asked', () => {
    expect(stillIndices(ms, [50, 0, 20])).toEqual([3, 0, 1])
  })

  it('takes the earlier frame on a tie', () => {
    expect(stillIndices([0, 10], [5])).toEqual([0])
  })

  it('clamps times outside the plan to its ends', () => {
    expect(stillIndices(ms, [-5, 1000])).toEqual([0, 4])
  })

  it('gives nothing for an empty plan', () => {
    expect(stillIndices([], [10])).toEqual([])
  })
})
