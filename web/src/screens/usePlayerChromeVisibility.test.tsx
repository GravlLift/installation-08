import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CHROME_HIDE_DELAY_MS, usePlayerChromeVisibility } from './usePlayerChromeVisibility'

function dispatchKey(key = 'ArrowLeft') {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

it('hides 3 s after the last activity in the overlay (fullscreen), and comes back on key press', () => {
  const { result } = renderHook(() => usePlayerChromeVisibility({ overlay: true, menuOpen: false }))
  expect(result.current.visible).toBe(true)
  act(() => { vi.advanceTimersByTime(CHROME_HIDE_DELAY_MS) })
  expect(result.current.visible).toBe(false)
  act(() => { dispatchKey(' ') })
  expect(result.current.visible).toBe(true)
})

it('re-arms the hide window on every activity', () => {
  const { result } = renderHook(() => usePlayerChromeVisibility({ overlay: true, menuOpen: false }))
  act(() => { vi.advanceTimersByTime(CHROME_HIDE_DELAY_MS - 1000) })
  act(() => { dispatchKey('a') })
  expect(result.current.visible).toBe(true)
  act(() => { vi.advanceTimersByTime(CHROME_HIDE_DELAY_MS - 1000) })
  expect(result.current.visible).toBe(true)
  act(() => { vi.advanceTimersByTime(1000) })
  expect(result.current.visible).toBe(false)
})

it('comes back on a key press and on focus', () => {
  const { result } = renderHook(() => usePlayerChromeVisibility({ overlay: true, menuOpen: false }))
  act(() => { vi.advanceTimersByTime(CHROME_HIDE_DELAY_MS) })
  expect(result.current.visible).toBe(false)
  act(() => { dispatchKey(' ') })
  expect(result.current.visible).toBe(true)
  act(() => { vi.advanceTimersByTime(CHROME_HIDE_DELAY_MS) })
  expect(result.current.visible).toBe(false)
  act(() => { window.dispatchEvent(new FocusEvent('focusin', { bubbles: true })) })
  expect(result.current.visible).toBe(true)
})

it('never hides when windowed (the chrome is not over the scene)', () => {
  const { result } = renderHook(() => usePlayerChromeVisibility({ overlay: false, menuOpen: false }))
  act(() => { vi.advanceTimersByTime(CHROME_HIDE_DELAY_MS * 2) })
  expect(result.current.visible).toBe(true)
})

it('comes back up for good when leaving fullscreen', () => {
  const { result, rerender } = renderHook(({ overlay }: { overlay: boolean }) => usePlayerChromeVisibility({ overlay, menuOpen: false }), { initialProps: { overlay: true } })
  act(() => { vi.advanceTimersByTime(CHROME_HIDE_DELAY_MS) })
  expect(result.current.visible).toBe(false)
  act(() => { rerender({ overlay: false }) })
  act(() => { vi.advanceTimersByTime(CHROME_HIDE_DELAY_MS * 2) })
  expect(result.current.visible).toBe(true)
})

it('stays visible while one of its own menus is open', () => {
  const { result } = renderHook(() => usePlayerChromeVisibility({ overlay: true, menuOpen: true }))
  act(() => { vi.advanceTimersByTime(CHROME_HIDE_DELAY_MS * 2) })
  expect(result.current.visible).toBe(true)
})

it('hides again when a menu closes and the idle window passes', () => {
  const wrapper = ({ menuOpen }: { menuOpen: boolean }) =>
    usePlayerChromeVisibility({ overlay: true, menuOpen })
  const { result, rerender } = renderHook(wrapper, { initialProps: { menuOpen: true } })
  act(() => { rerender({ menuOpen: false }) })
  expect(result.current.visible).toBe(true)
  act(() => { vi.advanceTimersByTime(CHROME_HIDE_DELAY_MS) })
  expect(result.current.visible).toBe(false)
})

it('keeps the chrome up while the pointer is over its scope, and hides on leave', () => {
  const { result } = renderHook(() => usePlayerChromeVisibility({ overlay: true, menuOpen: false }))
  const { onScopeEnter, onScopeLeave } = result.current

  act(() => { onScopeEnter() })
  expect(result.current.visible).toBe(true)
  act(() => { vi.advanceTimersByTime(CHROME_HIDE_DELAY_MS * 2) })
  expect(result.current.visible).toBe(true) // hover holds it

  act(() => { onScopeLeave() })
  act(() => { vi.advanceTimersByTime(CHROME_HIDE_DELAY_MS) })
  expect(result.current.visible).toBe(false)
})

it('re-shows on mouse moves inside the chrome scope', () => {
  const { result } = renderHook(() => usePlayerChromeVisibility({ overlay: true, menuOpen: false }))
  const scope = document.createElement('div')
  const inner = document.createElement('button')
  scope.appendChild(inner)
  document.body.appendChild(scope)
  ;(result.current.scopeRef as { current: HTMLElement | null }).current = scope
  act(() => { vi.advanceTimersByTime(CHROME_HIDE_DELAY_MS) })
  expect(result.current.visible).toBe(false)
  act(() => { inner.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })) })
  expect(result.current.visible).toBe(true)
  document.body.removeChild(scope)
})

it('does not re-show from mouse moves outside the chrome scope', () => {
  const { result } = renderHook(() => usePlayerChromeVisibility({ overlay: true, menuOpen: false }))
  const scope = document.createElement('div')
  document.body.appendChild(scope)
  ;(result.current.scopeRef as { current: HTMLElement | null }).current = scope
  act(() => { vi.advanceTimersByTime(CHROME_HIDE_DELAY_MS) })
  expect(result.current.visible).toBe(false)
  act(() => { document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })) })
  expect(result.current.visible).toBe(false)
  document.body.removeChild(scope)
})
