// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * loadedImage.ts — THE REPLAY SPRITE IMAGES, loaded once per URL.
 *
 * # WHY (2026-09-16, decision D9 of the "video formats" plan)
 *
 * The grenade, ground weapon and pedestal sprites are TINTED with a theme ink, and re-tinted
 * when the ink changes. They used to do it by RELOADING the image: the sprite went missing
 * for the duration of an `onload`. No consequence while the ink only changed with the theme;
 * but the export switches the inks to the dark theme at its start, and its first frames would
 * have come out WITHOUT sprites — or with, depending on the browser cache speed.
 *
 * An already loaded image is therefore rendered SYNCHRONOUSLY: the re-tint happens in the same
 * effects pass as the rest of the ink change, before the export paints its first frame.
 *
 * # THE ONLY `new Image()` OF THE LAYERS
 *
 * Four hooks were copying this loading (grenades, ground weapons, pedestals, vehicles). It
 * lives here, and the guardrail `loadedImage.guard.test.ts` forbids rewriting a copy of it.
 */

const images = new Map<string, HTMLImageElement>()

/**
 * withLoadedImage — calls `ready` with the image of `url`: right away if it is already loaded,
 * on its load otherwise. An image that fails calls only `failed` if it is provided (the layer
 * keeps its fallback stroke); it is not cached, a following call retries it.
 */
export function withLoadedImage(
  url: string,
  ready: (image: HTMLImageElement) => void,
  failed?: () => void,
): void {
  const cached = images.get(url)
  if (cached) {
    ready(cached)
    return
  }
  const im = new Image()
  im.onload = () => {
    images.set(url, im)
    ready(im)
  }
  if (failed) im.onerror = failed
  im.src = url
}
