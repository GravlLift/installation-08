/**
 * RingBackdrop.test.tsx — the home backdrop's image: on a failed load (a fresh install, the
 * image not built yet) it retries every 5 s with a cache-busting query until it exists, gives
 * up after about ten minutes, and stops on unmount; the star field shows meanwhile.
 * Fake timers; each advance is wrapped in `act` so the state update it schedules flushes.
 */
import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MAX_RETRIES, RETRY_MS, RingBackdrop } from './RingBackdrop'

const BASE = '/api/backdrop/home'

function backdropImg(container: HTMLElement): HTMLImageElement {
  const img = container.querySelector('img')
  expect(img).not.toBeNull()
  return img as HTMLImageElement
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('RingBackdrop', () => {
  it('retries the image with a cache-busting query 5 s after a failed load', () => {
    vi.useFakeTimers()
    const { container } = render(<RingBackdrop />)
    const img = backdropImg(container)
    expect(img.getAttribute('src')).toBe(BASE)
    fireEvent.error(img)
    // The first retry only after the 5 s interval.
    advance(RETRY_MS - 1)
    expect(img.getAttribute('src')).toBe(BASE)
    advance(1)
    expect(img.getAttribute('src')).toBe(`${BASE}?t=1`)
    fireEvent.error(img)
    advance(RETRY_MS)
    expect(img.getAttribute('src')).toBe(`${BASE}?t=2`)
  })

  it('stops retrying once the image loads', () => {
    vi.useFakeTimers()
    const { container } = render(<RingBackdrop />)
    const img = backdropImg(container)
    fireEvent.error(img)
    advance(RETRY_MS)
    expect(img.hidden).toBe(true)
    fireEvent.load(img)
    expect(img.hidden).toBe(false)
    advance(10 * 60 * 1000)
    expect(img.getAttribute('src')).toBe(`${BASE}?t=1`)
  })

  it('gives up after about ten minutes and keeps the star field', () => {
    vi.useFakeTimers()
    const { container } = render(<RingBackdrop />)
    const img = backdropImg(container)
    fireEvent.error(img)
    for (let i = 1; i <= MAX_RETRIES; i++) {
      advance(RETRY_MS)
      expect(img.getAttribute('src')).toBe(`${BASE}?t=${i}`)
      fireEvent.error(img)
    }
    // The last retry failed: no further one is scheduled.
    advance(RETRY_MS)
    expect(img.getAttribute('src')).toBe(`${BASE}?t=${MAX_RETRIES}`)
    expect(img.hidden).toBe(true)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('does not retry after unmount', () => {
    vi.useFakeTimers()
    const { container, unmount } = render(<RingBackdrop />)
    const img = backdropImg(container)
    fireEvent.error(img)
    unmount()
    advance(RETRY_MS)
    expect(img.getAttribute('src')).toBe(BASE)
  })
})
