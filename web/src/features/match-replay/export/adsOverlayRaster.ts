/**
 * adsOverlayRaster.ts — THE ADS OVERLAYS IN THE VIDEO FILE. The live HUD draws each weapon's
 * aim-down-sights overlay as SVG (`ui/ReplayAthLunette3d`), which never reaches the exported file.
 * Rather than keep a second, canvas copy of every overlay's geometry, the export renders THE SAME
 * component to markup, resolves its CSS variables (an SVG image cannot read the page's theme),
 * and loads it as an image at the file's pixel size, before the first frame. The paint is then
 * one `drawImage` per frame, faded with the zoom.
 *
 * One raster per (overlay, level, reticle color): the magazine count is the one part that
 * changes every shot, so it is left out of the raster and printed by `paintAdsAmmo` at the place
 * the drawing prints it (`ADS_AMMO_TEXT`).
 */
import { createElement } from 'react'
// A STATIC import on purpose: a lazy `import('react-dom/server')` chunk never settled in a
// production build (headless Chromium probe, 2026-11-15), which would stall the export forever.
import { renderToStaticMarkup } from 'react-dom/server'

import { resolveToken } from '@/lib/accessibility/resolveToken'
import { tokenCssVar } from '@/lib/accessibility/semantic-tokens'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { ADS_MINIMAL, adsOverlayFor, type AdsDesign, type AdsOverlaySpec } from '../model/adsOverlay'
import { heldModelKey } from '../model/aimHud'
import { specLunette } from '../model/scopeLogic'
import { ADS_AMMO_TEXT, ReplayAthLunette3d } from '../ui/ReplayAthLunette3d'

/** Loads an SVG document as an image; null when it cannot be decoded. */
export type SvgImageLoader = (svg: string) => Promise<CanvasImageSource | null>

/** A raster that does not decode in this time is given up: the export goes on without it. */
const LOAD_TIMEOUT_MS = 5000

/** loadSvgImage: the default loader, an `Image` from a data URL. */
export function loadSvgImage(svg: string): Promise<CanvasImageSource | null> {
  return new Promise((resolve) => {
    const img = new Image()
    const timer = setTimeout(() => resolve(null), LOAD_TIMEOUT_MS)
    img.onload = () => { clearTimeout(timer); resolve(img) }
    img.onerror = () => { clearTimeout(timer); resolve(null) }
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

/**
 * adsOverlaysOfDoc: the overlays the match's weapons can show (`adsOverlayFor` of each labeled
 * weapon), plus the minimal one any unlisted scoped weapon falls back to.
 */
export function adsOverlaysOfDoc(doc: ReplayDocumentReady): AdsOverlaySpec[] {
  const out = new Set<AdsOverlaySpec>([ADS_MINIMAL])
  for (const [id, label] of Object.entries(doc.weaponLabels ?? {})) {
    const key = heldModelKey(id)
    const spec = adsOverlayFor(key, label?.key, specLunette(key, label?.key))
    if (spec) out.add(spec)
  }
  return [...out]
}

type RenderMarkup = (element: ReturnType<typeof createElement>) => string

/**
 * adsOverlaySvg: the standalone SVG document of the overlay at `levelIndex`, `width` x `height`
 * pixels, its `var(--token)` colors and font resolved, without the magazine count.
 */
export function adsOverlaySvg(render: RenderMarkup, spec: AdsOverlaySpec, levelIndex: number, hostile: boolean, width: number, height: number): string {
  const markup = render(createElement(ReplayAthLunette3d, {
    spec,
    levelIndex,
    amount: 1,
    reticleColor: hostile ? tokenCssVar('reticle-hostile') : undefined,
    ammo: null,
  }))
  // The root's page style (absolute, 100 %, opacity) has no meaning in an image: the size is
  // the file's, the fade is the paint's `globalAlpha`.
  return markup
    .replace(/^<svg([^>]*?) style="[^"]*"/, `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"$1`)
    .replace(/var\(--([a-zA-Z0-9-]+)\)/g, (_, name: string) => resolveToken(name).replace(/"/g, '&quot;'))
}

export interface AdsOverlayAtlas {
  /**
   * The raster of `spec` at `levelIndex` with the white or the hostile center reticle; null while
   * it is not loaded (an overlay the preload did not foresee starts loading on its first miss).
   */
  get(spec: AdsOverlaySpec, levelIndex: number, hostile: boolean): CanvasImageSource | null
}

/**
 * createAdsOverlayAtlas rasterizes every level of `specs`, white and (with `hostile`) red
 * reticle, at the file's pixel size, and resolves once they are all loaded.
 */
export async function createAdsOverlayAtlas(
  specs: readonly AdsOverlaySpec[],
  size: { width: number; height: number },
  options: { hostile: boolean; load?: SvgImageLoader },
): Promise<AdsOverlayAtlas> {
  const load = options.load ?? loadSvgImage
  const rasters = new Map<string, CanvasImageSource | null>()
  const keyOf = (spec: AdsOverlaySpec, level: number, hostile: boolean) => `${spec.design}|${spec.levels.length}|${level}|${hostile}`
  const start = (spec: AdsOverlaySpec, level: number, hostile: boolean): Promise<void> => {
    const key = keyOf(spec, level, hostile)
    rasters.set(key, null)
    return load(adsOverlaySvg(renderToStaticMarkup, spec, level, hostile, size.width, size.height)).then((img) => { rasters.set(key, img) })
  }
  const jobs: Promise<void>[] = []
  for (const spec of specs) {
    for (let level = 0; level < spec.levels.length; level++) {
      jobs.push(start(spec, level, false))
      if (options.hostile) jobs.push(start(spec, level, true))
    }
  }
  await Promise.all(jobs)
  return {
    get(spec, levelIndex, hostile) {
      const level = Math.max(0, Math.min(levelIndex, spec.levels.length - 1))
      const key = keyOf(spec, level, hostile)
      if (!rasters.has(key)) void start(spec, level, hostile)
      return rasters.get(key) ?? null
    },
  }
}

/**
 * paintAdsAmmo prints the magazine count of the overlay `design` (`ADS_AMMO_TEXT`), in the
 * drawing's units (1/720 of the view height, origin at the center), at the current alpha.
 */
export function paintAdsAmmo(ctx: CanvasRenderingContext2D, view: { width: number; height: number }, design: AdsDesign, ammo: string | null, font: string): void {
  const t = ADS_AMMO_TEXT[design]
  if (!t || !ammo) return
  const u = view.height / 720
  ctx.save()
  ctx.font = `${t.weight} ${t.size * u}px ${font}`
  ctx.textAlign = t.anchor === 'middle' ? 'center' : 'right'
  ctx.textBaseline = 'alphabetic'
  ctx.globalAlpha *= t.opacity
  ctx.fillStyle = resolveToken(`replay-ads-${t.ink}`)
  ctx.fillText(ammo, view.width / 2 + t.x * u, view.height / 2 + t.y * u)
  ctx.restore()
}
