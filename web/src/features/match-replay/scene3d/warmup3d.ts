// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { cloak, type Avatar } from './avatar3d'
import { timed, timedSync } from './perf3d'
import type { Outline3d } from './outline3d'

type WarmupObjects = { roots: readonly THREE.Object3D[]; detaches: readonly THREE.Object3D[]; composer: EffectComposer; avatars: readonly Avatar[]; outline: Outline3d }

/**
 * Compiles the scene and the detached models, and loads each texture of the prepared copies
 * exactly once. `roots` (attached to the scene: avatars, bodies, first-person rigs) are compiled
 * by the scene; `detaches` (weapon models, unattached) are compiled against the scene
 * (`compileAsync` with the target scene: the scene's lights and environment).
 */
export async function warmUp3d(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  objects: WarmupObjects,
): Promise<void> {
  try {
    await compileAndLoad(renderer, scene, camera, objects)
  } catch (error) { console.warn('3D replay: prewarming unavailable', error) }
}

async function compileAndLoad(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  objects: WarmupObjects,
): Promise<void> {
  const { roots, detaches, composer } = objects
  const target = renderer.getRenderTarget()
  const shadows = renderer.shadowMap.needsUpdate
  const compilations = timedSync('warmup-compile-start', () => {
    try {
      renderer.setRenderTarget(composer.readBuffer)
      return [renderer.compileAsync(scene, camera), ...detaches.map((source) => renderer.compileAsync(source, camera, scene))]
    } finally { renderer.setRenderTarget(target) }
  })
  timedSync('warmup-init-texture', () => {
    for (const texture of texturesOf([...roots, ...detaches])) renderer.initTexture(texture)
  })
  for (const source of detaches) scene.add(source)
  timedSync('warmup-render-passes', () => {
    try {
      withVisibleObjects([...roots, ...detaches], () => objects.outline.avecSujetsPrepares(objects.avatars.map((a) => a.group), (plan) => {
        renderer.shadowMap.needsUpdate = true
        plan('whole')
        composer.render()
        withCamouflage(objects.avatars.flatMap((a) => a.spartan ? [a.spartan.materials] : []), () => {
          plan('stand')
          composer.render()
        })
      }))
    } finally {
      for (const source of detaches) scene.remove(source)
      renderer.setRenderTarget(target)
      renderer.shadowMap.needsUpdate = shadows
    }
  })
  await timed('warmup-compile', () => Promise.all(compilations))
}

/** Applies the game's camouflage to the prepared materials and restores their state after drawing. */
export function withCamouflage(groups: readonly (readonly THREE.Material[])[], render: () => void): void {
  const states = new Map<THREE.Material, [boolean, boolean, number]>()
  for (const group of groups) for (const m of group) if (!states.has(m)) states.set(m, [m.transparent, m.depthWrite, m.opacity])
  try {
    for (const group of groups) cloak(group, 0.5)
    render()
  } finally {
    for (const [m, [transparent, depthWrite, opacity]] of states) {
      if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true }
      m.depthWrite = depthWrite
      m.opacity = opacity
    }
  }
}

/** Renders the prepared objects and restores their visibility and frustum culling. */
export function withVisibleObjects(roots: readonly THREE.Object3D[], render: () => void): void {
  const states = new Map<THREE.Object3D, [boolean, boolean]>()
  for (const root of roots) root.traverse((object) => {
    if (states.has(object)) return
    states.set(object, [object.visible, object.frustumCulled])
    object.visible = true
    object.frustumCulled = false
  })
  try { render() } finally {
    for (const [object, [visible, culled]] of states) { object.visible = visible; object.frustumCulled = culled }
  }
}

/** texturesOf: the textures of materials under the roots, deduplicated; painted armor's uniforms are counted. */
export function texturesOf(roots: readonly THREE.Object3D[]): THREE.Texture[] {
  const textures = new Set<THREE.Texture>()
  const add = (value: unknown) => { if (value instanceof THREE.Texture) textures.add(value) }
  for (const root of roots) root.traverse((object) => {
    const material = (object as THREE.Mesh).material
    if (!material) return
    for (const m of Array.isArray(material) ? material : [material]) collectTextures(m, add)
  })
  return [...textures]
}

function collectTextures(material: THREE.Material, add: (value: unknown) => void): void {
  const standard = material as THREE.MeshStandardMaterial
  for (const t of [standard.map, standard.normalMap, standard.roughnessMap, standard.metalnessMap, standard.emissiveMap, standard.aoMap]) add(t)
  if (material instanceof THREE.ShaderMaterial) for (const u of Object.values(material.uniforms)) add(u.value)
  // Painted armor carries its masks and gradients in uniforms set by `onBeforeCompile` (cf. `armorMaterial3d`).
  const armorUniforms = material.userData.armorUniforms as Record<string, THREE.IUniform> | undefined
  if (armorUniforms) for (const u of Object.values(armorUniforms)) add(u.value)
}
