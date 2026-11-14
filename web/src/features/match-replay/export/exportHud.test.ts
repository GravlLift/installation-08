import { expect, it, vi } from 'vitest'
import { testReplayDoc } from '../test/testDoc'
import { createExportHud } from './exportHud'

it('draws the requested player HUD without inventing an unknown player state', async () => {
  const doc = testReplayDoc()
  const ctx = {
    save: vi.fn(), restore: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(),
    arc: vi.fn(), stroke: vi.fn(), fill: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D
  const paint = await createExportHud(doc, 'unknown', [], null, null, 'en')
  paint(ctx, { width: 960, height: 540 }, 0)
  expect(ctx.save).toHaveBeenCalledOnce()
  expect(ctx.restore).toHaveBeenCalledOnce()
  expect(ctx.arc).not.toHaveBeenCalled()
})
