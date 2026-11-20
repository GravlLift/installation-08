// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * exportReadback3d.ts — copies an exported 3D frame out of WebGL with `readPixels`.
 *
 * The export used to hand the WebGL canvas itself to `drawImage`. Chrome serves that copy from
 * the canvas's own snapshot, which it refreshes as the page composites frames. An export runs for
 * minutes and the user switches away meanwhile: in a hidden tab no frame is composited, and every
 * read returned the same image while the scene kept moving under it (2026-11-15: an 11-minute
 * Solitude export showed its first frame, arms not yet loaded, for the whole clip, over a HUD
 * that updated). `readPixels` reads the drawing buffer itself, in the task of the render, so the
 * copy is the frame just drawn whatever the page's visibility.
 */

/** The WebGL calls the readback makes (the renderer's context in the app; a double in the tests). */
export type ReadbackGl = Pick<
  WebGLRenderingContext,
  'drawingBufferWidth' | 'drawingBufferHeight' | 'readPixels' | 'isContextLost' | 'RGBA' | 'UNSIGNED_BYTE'
>

/** Copies the default framebuffer into a 2D canvas the export composes from. */
export class ExportReadback3d {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  /** Rows as WebGL returns them, bottom row first. */
  private raw = new Uint8Array(0)
  /** The same rows top first, the canvas's order. */
  private image: ImageData | null = null

  /**
   * read copies what the default framebuffer holds NOW (call it right after the render, with
   * the default framebuffer bound) into the returned canvas, upright. A lost context throws:
   * its framebuffer reads as black, and a black clip encoded silently is worse than a failure.
   * `size`: read the BOUND framebuffer at that size instead (the motion-blur average's target,
   * `exportAccumulator3d`); absent, the drawing buffer's size.
   */
  read(gl: ReadbackGl, size?: { width: number; height: number }): HTMLCanvasElement {
    if (gl.isContextLost()) throw new Error('3D view lost its WebGL context during the export')
    const width = size?.width ?? gl.drawingBufferWidth
    const height = size?.height ?? gl.drawingBufferHeight
    const { ctx, image } = this.surface(width, height)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, this.raw)
    const row = width * 4
    const out = image.data
    for (let y = 0; y < height; y++) {
      const from = (height - 1 - y) * row
      out.set(this.raw.subarray(from, from + row), y * row)
    }
    ctx.putImageData(image, 0, 0)
    return ctx.canvas
  }

  /** pixels: the last frame read, upright (the canvas's own pixels), null before any read. */
  pixels(): ImageData | null {
    return this.image
  }

  /** dispose releases the buffers (about 16 MB at 1080p); the next read allocates again. */
  dispose(): void {
    this.canvas = null
    this.ctx = null
    this.raw = new Uint8Array(0)
    this.image = null
  }

  /** The canvas and buffers at the frame's size, kept between frames. */
  private surface(width: number, height: number): { ctx: CanvasRenderingContext2D; image: ImageData } {
    if (this.ctx && this.image && this.image.width === width && this.image.height === height) {
      return { ctx: this.ctx, image: this.image }
    }
    const canvas = this.canvas ?? document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D context unavailable for the 3D export readback')
    this.canvas = canvas
    this.ctx = ctx
    this.raw = new Uint8Array(width * height * 4)
    this.image = new ImageData(width, height)
    return { ctx, image: this.image }
  }
}
