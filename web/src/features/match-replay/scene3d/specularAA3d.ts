// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * specularAA3d.ts — the map's texture filtering and specular antialiasing, set on every map material
 * by `guardMaterial` (lighting.ts) before its first draw. Ported from the Library's stage materials
 * (infinite-library `internal/viewer/web/stage-materials.js`, commits 711d475 and 2dd59a5).
 *
 * - Anisotropic filtering: three.js draws a texture with an anisotropy of 1, so plain trilinear
 *   filtering picks the mip level by a pixel's long axis and blurs floors and walls seen at
 *   grazing angles. Every map texture takes MAP_ANISOTROPY taps (three caps it at the GPU's
 *   maximum when it uploads the texture, which is why this must run before the first draw).
 * - Specular antialiasing: three.js widens a highlight only by the change of the interpolated
 *   vertex normal across a pixel (`geometryRoughness` on `nonPerturbedNormal`), never by the
 *   layers' normal maps. Where the shaded normal turns faster than a pixel, a highlight lands on one
 *   pixel and not the next and sparkles as the camera moves. The screen-space variance of the
 *   shaded normal (Kaplanyan and Hoffman 2016, as Filament's normalFiltering does it) is added to
 *   the GGX alpha squared, capped at SPECULAR_AA_THRESHOLD so a flat glossy floor stays glossy.
 *
 * The Library adds a second term, Toksvig's variance from the filtered normal map's length. It does
 * not carry over: a layer's normal is rebuilt from its map's red and green with z = sqrt(1 - x² -
 * y²) (layeredMaterial `normalOf`), always unit length, so the shortening mip filtering leaves in
 * a three-channel map is gone before the shader could read it.
 */
import type * as THREE from 'three'

/** The most texels a map texture's filter takes along a pixel's long axis. */
export const MAP_ANISOTROPY = 8

/** Kaplanyan-Hoffman's screen-space variance factor (Filament's, the Library's). */
export const SPECULAR_AA_VARIANCE = 0.15
/** The most the widening adds to the GGX alpha squared. */
export const SPECULAR_AA_THRESHOLD = 0.2

/** The include of three.js's physical fragment shader that sets `material.roughness`. */
export const LIGHTS_PHYSICAL_INCLUDE = '#include <lights_physical_fragment>'

// `normal` is the shaded normal (the layers' relief included, layeredMaterial's injection after
// normal_fragment_maps); three's alpha is roughness squared.
const WIDEN = /* glsl */ `
{
  vec3 specularAADx = dFdx( normal );
  vec3 specularAADy = dFdy( normal );
  float specularAAVariance = ${SPECULAR_AA_VARIANCE.toFixed(2)} * ( dot( specularAADx, specularAADx ) + dot( specularAADy, specularAADy ) );
  float specularAAKernel = min( 2.0 * specularAAVariance, ${SPECULAR_AA_THRESHOLD.toFixed(2)} );
  float specularAAAlpha = pow2( material.roughness );
  material.roughness = sqrt( sqrt( saturate( pow2( specularAAAlpha ) + specularAAKernel ) ) );
}
`

/** specularAntialias returns the fragment shader with the widening added; unchanged when it has no physical lighting. */
export function specularAntialias(fragmentShader: string): string {
  return fragmentShader.replace(LIGHTS_PHYSICAL_INCLUDE, LIGHTS_PHYSICAL_INCLUDE + WIDEN)
}

// The texture slots of a MeshStandardMaterial that the GLTFLoader fills.
const TEXTURE_SLOTS = ['map', 'metalnessMap', 'roughnessMap', 'normalMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const

/**
 * filterAnisotropically sets every texture of a map material, its own slots and the layers' maps it
 * names in `userData.textures` (layeredMaterial, mergedMaterial), to MAP_ANISOTROPY taps.
 */
export function filterAnisotropically(material: THREE.Material): void {
  const slots = material as unknown as Record<string, unknown>
  const named = (material.userData?.textures ?? []) as unknown[]
  for (const t of [...TEXTURE_SLOTS.map((s) => slots[s]), ...named]) {
    const texture = t as THREE.Texture | null | undefined
    if (texture?.isTexture && texture.anisotropy < MAP_ANISOTROPY) texture.anisotropy = MAP_ANISOTROPY
  }
}
