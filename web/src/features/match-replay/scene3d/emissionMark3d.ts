// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * emissionMark3d.ts — WHICH PIXELS ARE LIGHT GIVEN OFF RATHER THAN LIGHT RECEIVED, written into the
 * scene image's alpha so the highlight ceiling (`highlightMeter3d`) meters lit surfaces only.
 *
 * The scene renders into a half-float target whose alpha nothing downstream reads as coverage (the
 * passes after it pass alpha through or use their own, and the canvas has no alpha). An OPAQUE
 * material draws with blending off, so the alpha its shader writes changes no color. Here:
 *  - a standard (lit) material writes 1 + the share of its outgoing light that is its own emission
 *    (`totalEmissiveRadiance` over `outgoingLight`, by luma): 1 on a lit wall or armor however bright
 *    a lamp or a detonation's flash makes it, toward 2 on a lamp panel or a light strip;
 *  - an unlit basic material (an orb core, a vehicle's nose light, a death link) writes 2: all of
 *    its light is its own;
 *  - the sky (`ciel3d`) writes 2 (`markEmissive`).
 * Transparent effects (explosions, sparks, muzzle flashes, beams, additive glows, glass) are not
 * marked: the meter reads the scene before they are drawn (`postFx3d`'s probe, between three's opaque
 * and transparent lists).
 *
 * The marks go in after `premultiplied_alpha_fragment`, so no material multiplies its color by them.
 * Installed on three's shader library once (`installEmissionMarks`), before the session's renderer
 * exists (`sessionRenderer3d`): three caches built-in programs by parameters, not by source, so a
 * program compiled before the patch would be reused without it.
 */
import * as THREE from 'three'

/** The alpha of a pixel whose light is all emission. */
export const EMISSION_ALPHA = 2

/** The line every built-in material's fragment shader has, after which the marks are written. */
const AFTER = '#include <premultiplied_alpha_fragment>'

/** The standard material's mark: 1 + the emissive share of its outgoing light. */
export const STANDARD_MARK = /* glsl */ `
#ifdef OPAQUE
{
  const vec3 hmLuma = vec3(0.2126, 0.7152, 0.0722);
  float hmEmit = max(dot(totalEmissiveRadiance, hmLuma), 0.0);
  float hmAll = max(dot(outgoingLight, hmLuma), 0.0);
  gl_FragColor.a = 1.0 + (hmEmit > 0.0 ? clamp(hmEmit / max(hmAll, 1e-6), 0.0, 1.0) : 0.0);
}
#endif`

/** The basic (unlit) material's mark. */
export const BASIC_MARK = /* glsl */ `
#ifdef OPAQUE
gl_FragColor.a = ${EMISSION_ALPHA.toFixed(1)};
#endif`

let installed = false

/** markAfter: `source` with `mark` after its premultiplied-alpha step; null if it has none. */
export function markAfter(source: string, mark: string): string | null {
  if (!source.includes(AFTER)) return null
  return source.replace(AFTER, `${AFTER}${mark}`)
}

/**
 * installEmissionMarks patches three's standard, physical and basic fragment shaders (once). A
 * library missing the anchor line is reported and left as it is: the meter then counts that
 * material's emission as lit surface, as it would without marks.
 */
export function installEmissionMarks(): void {
  if (installed) return
  installed = true
  const lib = THREE.ShaderLib as Record<string, { fragmentShader: string }>
  for (const [name, mark] of [['standard', STANDARD_MARK], ['physical', STANDARD_MARK], ['basic', BASIC_MARK]] as const) {
    const marked = markAfter(lib[name].fragmentShader, mark)
    if (marked === null) console.error(`3D replay: three's ${name} shader has no premultiplied_alpha_fragment; its emission is not marked for the highlight meter`)
    else lib[name].fragmentShader = marked
  }
}

/** markEmissive: a custom opaque shader's source with its alpha set to `EMISSION_ALPHA` at the end of `main`. */
export function markEmissive(source: string): string {
  const end = source.lastIndexOf('}')
  if (end < 0) return source
  return `${source.slice(0, end)}\tgl_FragColor.a = ${EMISSION_ALPHA.toFixed(1)};\n${source.slice(end)}`
}
