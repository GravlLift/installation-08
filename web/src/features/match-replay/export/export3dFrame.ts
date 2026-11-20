// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** Compose the rendered 3D scene, player labels, optional minimap, and overlays into a video frame.
 * The 3D image is a 2D canvas the scene filled from its drawing buffer (`exportReadback3d`), valid until its next frame.
 * Both export formats use the same 960x540 logical layout at their respective pixel densities. */
import type { CameraMode3d } from '../scene3d/replayScene3d'
import type { ExportFormat } from './exportFormats'
import type { ExportSubframe3d, ExportTag3d, Replay3DExportSource } from './replay3dExportStore'

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
/** Label dimensions in CSS px, matching the on-screen tag's styles (`text-xs` font, `px-1`, `border-l-[3px]`, `rounded`, `bg-background/70`). */
const TAG_FONT_PX = 12
const TAG_PAD_X = 4
const TAG_HEIGHT = 16
const TAG_BORDER = 3
const TAG_RADIUS = 4
const TAG_ALPHA = 0.7
/**
 * The typical viewer's viewport height in CSS px (a 1080p screen with taskbar and browser
 * chrome). On screen a tag is a fixed CSS size in a viewport that tall; the export gives it the
 * same share of the frame height it has there, at whatever the file's height is.
 */
export const TAG_VIEWER_CSS_HEIGHT = 900

/** One CSS px in logical export px: the tag keeps its on-screen share of a frame `formatHeight` tall. */
export function tagScale(formatHeight: number, pixelRatio: number): number {
  return formatHeight / TAG_VIEWER_CSS_HEIGHT / pixelRatio
}

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
  /**
   * Clean frame: paint the bare 3D image only, no name tags, minimap, HUD or panels. For
   * footage that gets graphics composited over it later.
   */
  clean?: boolean
  /**
   * Motion blur: the subframes of file frame `index` (film frame `frame`), or null for a single
   * pose. Absent: every frame is a single pose. The tags, minimap and overlays are painted once
   * per file frame either way (the scene reads its tags at the center subframe).
   */
  subframes?: (frame: number, index: number | undefined) => readonly ExportSubframe3d[] | null
}

/** Create a video-sized canvas and repaint it for each frame. */
export function make3dPainter(d: Paint3dDeps): (frame: number, index?: number) => HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = d.format.width
  canvas.height = d.format.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable for 3D composition')
  const view = { width: d.format.width / d.pixelRatio, height: d.format.height / d.pixelRatio }
  return (frame, index) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    const subframes = d.subframes?.(frame, index) ?? null
    const image = subframes ? d.source.exportFrame(frame, subframes) : d.source.exportFrame(frame)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    if (!d.clean) {
      ctx.setTransform(d.pixelRatio, 0, 0, d.pixelRatio, 0, 0)
      paintTags(ctx, d.source.exportTags(), d.pixelRatio, d)
      if (d.map2d) paintMinimap(ctx, d.map2d(frame), view, d.ink.background)
      d.overlay(ctx, view, frame)
    }
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

/**
 * Center player labels on their projected points, as the screen renderer does. The box and font
 * are the on-screen CSS sizes scaled to the frame's share (`tagScale`), and the tag's distance
 * opacity is painted (background at its 70%, text and border at full).
 */
export function paintTags(
  ctx: CanvasRenderingContext2D,
  tags: readonly ExportTag3d[],
  pixelRatio: number,
  d: Pick<Paint3dDeps, 'ink' | 'font' | 'format'>,
): void {
  if (tags.length === 0) return
  const s = tagScale(d.format.height, pixelRatio)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  for (const tag of tags) {
    ctx.font = `${TAG_FONT_PX * s}px ${d.font}`
    const width = TAG_BORDER * s + 2 * TAG_PAD_X * s + ctx.measureText(tag.name).width
    const h = TAG_HEIGHT * s
    const x = tag.x / pixelRatio - width / 2
    const y = tag.y / pixelRatio - h / 2
    ctx.globalAlpha = TAG_ALPHA * tag.opacity
    ctx.fillStyle = d.ink.background
    ctx.beginPath()
    ctx.roundRect(x, y, width, h, TAG_RADIUS * s)
    ctx.fill()
    ctx.globalAlpha = tag.opacity
    ctx.fillStyle = tag.color
    ctx.fillRect(x, y, TAG_BORDER * s, h)
    ctx.fillStyle = d.ink.foreground
    ctx.fillText(tag.name, x + TAG_BORDER * s + TAG_PAD_X * s, y + h / 2)
  }
  ctx.globalAlpha = 1
}
