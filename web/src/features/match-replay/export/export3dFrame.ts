/** Compose the rendered 3D scene, player labels, optional minimap, and overlays into a video frame.
 * Copy the WebGL canvas in the same task as rendering because its drawing buffer is not preserved.
 * Both export formats use the same 960x540 logical layout at their respective pixel densities. */
import type { CameraMode3d } from '../scene3d/replayScene3d'
import type { ExportFormat } from './exportFormats'
import type { ExportTag3d, Replay3DExportSource } from './replay3dExportStore'

/** Options selected for a 3D export. */
export interface Export3dOptions {
  camera: CameraMode3d
  /** Followed player, or null for free camera. */
  pov: string | null
  /** Show the 2D minimap in a corner. */
  minimap: boolean
}

/** Minimap width as a fraction of frame width. */
export const MINIMAP_SHARE = 0.3
/** Minimap margin in logical pixels. */
const MINIMAP_MARGIN = 16
/** Minimap background opacity under the map's transparent edges. */
const MINIMAP_ALPHA = 0.8
/** Corner radius matching rounded-md. */
const MINIMAP_RADIUS = 6
/** Label dimensions matching the on-screen styles. */
const TAG_FONT_PX = 12
const TAG_PAD_X = 4
const TAG_HEIGHT = 16
const TAG_BORDER = 3
const TAG_RADIUS = 4
const TAG_ALPHA = 0.7

/** Frame colors resolved in the export theme. */
export interface Export3dInk {
  background: string
  foreground: string
}

export interface Paint3dDeps {
  source: Replay3DExportSource
  format: ExportFormat
  /** Logical frame density: `format.height / EXPORT_LAYOUT.height`. */
  pixelRatio: number
  ink: Export3dInk
  /** Font family for labels. */
  font: string
  /** Paint the 2D map for this frame, or null without a minimap. */
  map2d: ((frame: number) => CanvasImageSource & { width: number; height: number }) | null
  /** Paint panels in logical coordinates with the density already applied. */
  overlay: (ctx: CanvasRenderingContext2D, view: { width: number; height: number }, frame: number) => void
}

/** Create a video-sized canvas and repaint it for each frame. */
export function make3dPainter(d: Paint3dDeps): (frame: number) => HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = d.format.width
  canvas.height = d.format.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable for 3D composition')
  const view = { width: d.format.width / d.pixelRatio, height: d.format.height / d.pixelRatio }
  return (frame) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.drawImage(d.source.exportFrame(frame), 0, 0, canvas.width, canvas.height)
    ctx.setTransform(d.pixelRatio, 0, 0, d.pixelRatio, 0, 0)
    paintTags(ctx, d.source.exportTags(), d.pixelRatio, d)
    if (d.map2d) paintMinimap(ctx, d.map2d(frame), view, d.ink.background)
    d.overlay(ctx, view, frame)
    return canvas
  }
}

/** Position the minimap at bottom right, preserving the map aspect ratio. */
export function minimapBox(
  view: { width: number; height: number },
  map: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const width = view.width * MINIMAP_SHARE
  const height = map.width > 0 ? (width * map.height) / map.width : 0
  return { x: view.width - MINIMAP_MARGIN - width, y: view.height - MINIMAP_MARGIN - height, width, height }
}

function paintMinimap(
  ctx: CanvasRenderingContext2D,
  map: CanvasImageSource & { width: number; height: number },
  view: { width: number; height: number },
  background: string,
): void {
  const box = minimapBox(view, map)
  if (box.height <= 0) return
  ctx.globalAlpha = MINIMAP_ALPHA
  ctx.fillStyle = background
  ctx.beginPath()
  ctx.roundRect(box.x, box.y, box.width, box.height, MINIMAP_RADIUS)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(map, box.x, box.y, box.width, box.height)
}

/** Center player labels on their projected points, as the screen renderer does. */
function paintTags(
  ctx: CanvasRenderingContext2D,
  tags: readonly ExportTag3d[],
  pixelRatio: number,
  d: Pick<Paint3dDeps, 'ink' | 'font'>,
): void {
  if (tags.length === 0) return
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  for (const tag of tags) {
    ctx.font = `${TAG_FONT_PX}px ${d.font}`
    const width = TAG_BORDER + 2 * TAG_PAD_X + ctx.measureText(tag.name).width
    const x = tag.x / pixelRatio - width / 2
    const y = tag.y / pixelRatio - TAG_HEIGHT / 2
    ctx.globalAlpha = TAG_ALPHA
    ctx.fillStyle = d.ink.background
    ctx.beginPath()
    ctx.roundRect(x, y, width, TAG_HEIGHT, TAG_RADIUS)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.fillStyle = tag.color
    ctx.fillRect(x, y, TAG_BORDER, TAG_HEIGHT)
    ctx.fillStyle = d.ink.foreground
    ctx.fillText(tag.name, x + TAG_BORDER + TAG_PAD_X, y + TAG_HEIGHT / 2)
  }
}
