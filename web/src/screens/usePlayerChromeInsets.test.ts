import { renderHook } from '@testing-library/react'
import { beforeAll, expect, it, vi } from 'vitest'
import { usePlayerChromeInsets } from './usePlayerChromeInsets'

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})

function at(top: number, bottom: number): HTMLElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON: () => ({}) })
  return el
}

function insets(box: HTMLElement, top: HTMLElement, bar: HTMLElement): [string, string] {
  renderHook(() => usePlayerChromeInsets({ current: box }, { current: top }, { current: bar }))
  return [box.style.getPropertyValue('--bc-chrome-top'), box.style.getPropertyValue('--bc-chrome-bottom')]
}

it('is 0 windowed, where the strip sits above the box and the bar below it', () => {
  expect(insets(at(40, 700), at(0, 40), at(704, 800))).toEqual(['0px', '0px'])
})

it('measures the overlap in fullscreen, where both are laid over the box', () => {
  expect(insets(at(0, 900), at(0, 49), at(804, 888))).toEqual(['49px', '96px'])
})
