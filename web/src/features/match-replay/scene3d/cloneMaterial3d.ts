// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import type * as THREE from 'three'

/**
 * cloneMaterial is `m.clone()` with the material's `userData` copied by reference, one level
 * deep. three.js's Material.copy deep-copies userData through JSON, so a material that keeps
 * textures there (an armor piece's masks in `armorMaps`, a layered material's `textures`, a
 * painted copy's `armorUniforms`) has every texture serialized on each copy: one "THREE.Texture:
 * Unable to serialize Texture" warning per compressed texture (761 to 4500 per load on the
 * 2026-11-18 sweep, one painted copy per piece per player), a full Array.from of every
 * DataTexture's pixels, and a copy whose `armorMaps` held plain JSON instead of the textures.
 * Here the copy gets the same references: its flags read the same, and its textures are the
 * source's.
 */
export function cloneMaterial<T extends THREE.Material>(m: T): T {
  const userData = m.userData
  m.userData = {}
  try {
    const copy = m.clone() as T
    copy.userData = { ...userData }
    return copy
  } finally {
    m.userData = userData
  }
}
