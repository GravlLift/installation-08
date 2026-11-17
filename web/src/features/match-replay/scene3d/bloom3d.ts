// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * bloom3d.ts — THE GLOW OF SELF-LIT SURFACES: map lamps and light strips, emissive armor paint,
 * energy blades. The composer runs it on the scene's linear HDR image, after the ambient
 * occlusion and before the output pass (tone mapping), so it sees light values, not screen colors.
 *
 * Three's `UnrealBloomPass` with two local changes:
 *  - The bright pass keys on the brightest channel and keeps only the light ABOVE the threshold
 *    (`color * excess / peak`), instead of the whole color of every pixel whose luma passes. A
 *    saturated blue strip (luma about 0.3 of its peak) glows like a white one of the same peak,
 *    and the glow grows from zero at the threshold instead of switching on.
 *  - The halo is added with ONE/ONE blending. The stock pass blends with SRC_ALPHA/ONE while its
 *    composite writes an alpha of 3 x strength, so its real strength was 3 x strength squared;
 *    here `BLOOM_STRENGTH` is a plain gain, and the scene's alpha is left as it was.
 *
 * Cost: the bright pass and the first blur run at half the drawing buffer's size (the pass's own
 * first mip), the four others at 1/4 to 1/32: 13 full-screen quads, the only full-size one the
 * final add. Half size and no less: the bright pass samples once per texel with bilinear
 * filtering, which at half size averages exactly the four pixels under it; at quarter size it
 * would read four pixels of sixteen, and a lamp strip one or two pixels wide would flicker in and
 * out of the glow as the camera moves.
 */
import * as THREE from 'three'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

/**
 * Light (linear radiance, brightest channel, before exposure) above which a pixel glows.
 *
 * Chosen from the view's own lights: a white diffuse surface under the full sun, face on, sends
 * SUN_INTENSITY / pi = 3.2 / pi = 1.02, plus the open-sky fill (SKY_FILL_SHARE, a quarter of it):
 * 1.27 at most, and real albedos (0.8 and under) keep a sunlit wall near 1.0. A map's lamp glows
 * at `glowLevel(force)` = 0.6 log2(1 + force) times its color: 1.5 is a white lamp of game force
 * 4.7, force 20 gives 2.6, force 100 gives 4.0, and the sword's field is lit at its paint's
 * emission (16). Past 1.5 the view's ACES curve (exposure 1.15) is already at 0.87 of white
 * (0.94 on screen): the brighter light can no longer show as brightness, and shows as glow.
 * Mirror-like metal catching the sun goes past it too, as a sun glint does in the game.
 */
export const BLOOM_THRESHOLD = 1.5

/**
 * Gain of the halo: the halo adds about 3 x this of the light above the threshold, spread over
 * the five blur sizes (their weights sum to 3 whatever the radius).
 */
export const BLOOM_STRENGTH = 0.3

/**
 * Spread of the halo, 0 to 1: how the weight moves from the tightest blur (0) to an even share
 * between all five (0.5) and on to the widest. 0.2 keeps the glow close around the lamp, with
 * a faint wide skirt.
 */
export const BLOOM_RADIUS = 0.2

/**
 * Most light above the threshold one pixel feeds the glow: the sun's disk (thousands, near the
 * half-float limit) and single sparkling pixels would otherwise flood the blur and flash from
 * frame to frame. 16 is the sword field's own emission, the brightest surface the view lights.
 */
export const BLOOM_EXCESS_MAX = 16

/** The bright pass: the light above `luminosityThreshold` on the brightest channel, hue kept, capped at `excessMax`. */
const BRIGHT_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float luminosityThreshold;
uniform float excessMax;
varying vec2 vUv;
void main() {
  vec3 c = min(texture2D(tDiffuse, vUv).rgb, vec3(65504.0));
  float peak = max(c.r, max(c.g, c.b));
  float excess = clamp(peak - luminosityThreshold, 0.0, excessMax);
  vec3 bright = peak > 0.0 ? c * (excess / peak) : vec3(0.0);
  if (any(isnan(bright)) || any(isinf(bright))) bright = vec3(0.0);
  gl_FragColor = vec4(bright, 1.0);
}
`

/** GlowBloomPass — `UnrealBloomPass` at the view's constants, with the bright pass and blending above. */
export class GlowBloomPass extends UnrealBloomPass {
  constructor() {
    super(new THREE.Vector2(1, 1), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD)
    const bright = this.materialHighPassFilter
    bright.uniforms.excessMax = { value: BLOOM_EXCESS_MAX }
    bright.fragmentShader = BRIGHT_FRAGMENT
    bright.needsUpdate = true
    const add = this.blendMaterial
    add.blending = THREE.CustomBlending
    add.blendEquation = THREE.AddEquation
    add.blendSrc = THREE.OneFactor
    add.blendDst = THREE.OneFactor
    add.blendSrcAlpha = THREE.ZeroFactor
    add.blendDstAlpha = THREE.OneFactor
    add.needsUpdate = true
  }
}
