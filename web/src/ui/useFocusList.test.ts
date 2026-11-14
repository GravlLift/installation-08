import { describe, expect, it } from 'vitest'

import { focusAfterKey } from './useFocusList'

describe('focusAfterKey', () => {
  it('moves down and up one row', () => {
    expect(focusAfterKey('ArrowDown', 1, 4)).toBe(2)
    expect(focusAfterKey('ArrowUp', 1, 4)).toBe(0)
  })
  it('stops at the ends instead of wrapping', () => {
    expect(focusAfterKey('ArrowDown', 3, 4)).toBe(3)
    expect(focusAfterKey('ArrowUp', 0, 4)).toBe(0)
  })
  it('jumps to the first and last row', () => {
    expect(focusAfterKey('Home', 2, 4)).toBe(0)
    expect(focusAfterKey('End', 0, 4)).toBe(3)
  })
  it('ignores other keys and an empty list', () => {
    expect(focusAfterKey('Enter', 1, 4)).toBeNull()
    expect(focusAfterKey('ArrowDown', 0, 0)).toBeNull()
  })
})
