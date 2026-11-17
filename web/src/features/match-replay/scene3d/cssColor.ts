// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * cssColor.ts — a resolved CSS color (theme token) turned into a three.js color.
 *
 * The replay's inks come from theme tokens and may be written in a notation three.js cannot read
 * (oklch, resolved variables). The browser, though, reads all of them: we paint a pixel and read
 * its sRGB components back.
 */
import * as THREE from 'three'

// An off-screen pixel, created on first read: it paints nothing visible.
const makeProbe = () => document.createElement('canvas').getContext('2d', { willReadFrequently: true })
let probe: ReturnType<typeof makeProbe> | undefined

export function cssColor(css: string | null, fallback: THREE.Color): THREE.Color {
  if (!css) return fallback.clone()
  probe ??= makeProbe()
  if (!probe) return fallback.clone()
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = css
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace)
}
