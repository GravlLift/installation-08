/**
 * cssColor.ts — une couleur CSS résolue (jeton de thème) en couleur three.
 *
 * Les encres du rejeu viennent des jetons du thème et peuvent être écrites dans une notation que
 * three ne lit pas (oklch, variables résolues). Le navigateur, lui, les lit toutes : on peint un
 * pixel et on relit ses composantes sRGB.
 */
import * as THREE from 'three'

// Un pixel hors écran, créé à la première lecture : il ne peint rien de visible.
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
