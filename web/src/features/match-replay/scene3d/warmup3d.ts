// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { cloak, type Avatar } from './avatar3d'
import { timed, timedSync } from './perf3d'
import type { Outline3d } from './outline3d'

type Objets = { roots: readonly THREE.Object3D[]; detaches: readonly THREE.Object3D[]; composer: EffectComposer; avatars: readonly Avatar[]; outline: Outline3d }

/**
 * Compiles the scene and the detached models, and loads each texture of the prepared copies
 * exactly once. `roots` (attached to the scene: avatars, bodies, first-person rigs) are compiled
 * by the scene; `detaches` (weapon models, unattached) are compiled against the scene
 * (`compileAsync` with the target scene: the scene's lights and environment).
 */
export async function prechauffer3d(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  objets: Objets,
): Promise<void> {
  try {
    await compilerEtCharger(renderer, scene, camera, objets)
  } catch (error) { console.warn('3D replay: prewarming unavailable', error) }
}

async function compilerEtCharger(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  objets: Objets,
): Promise<void> {
  const { roots, detaches, composer } = objets
  const cible = renderer.getRenderTarget()
  const ombres = renderer.shadowMap.needsUpdate
  const compilations = timedSync('warmup-compile-start', () => {
    try {
      renderer.setRenderTarget(composer.readBuffer)
      return [renderer.compileAsync(scene, camera), ...detaches.map((source) => renderer.compileAsync(source, camera, scene))]
    } finally { renderer.setRenderTarget(cible) }
  })
  timedSync('warmup-init-texture', () => {
    for (const texture of texturesDe([...roots, ...detaches])) renderer.initTexture(texture)
  })
  for (const source of detaches) scene.add(source)
  timedSync('warmup-render-passes', () => {
    try {
      avecObjetsVisibles([...roots, ...detaches], () => objets.outline.avecSujetsPrepares(objets.avatars.map((a) => a.group), (plan) => {
        renderer.shadowMap.needsUpdate = true
        plan('whole')
        composer.render()
        avecCamouflage(objets.avatars.flatMap((a) => a.spartan ? [a.spartan.materials] : []), () => {
          plan('stand')
          composer.render()
        })
      }))
    } finally {
      for (const source of detaches) scene.remove(source)
      renderer.setRenderTarget(cible)
      renderer.shadowMap.needsUpdate = ombres
    }
  })
  await timed('warmup-compile', () => Promise.all(compilations))
}

/** Applies the game's camouflage to the prepared materials and restores their state after drawing. */
export function avecCamouflage(groupes: readonly (readonly THREE.Material[])[], rendre: () => void): void {
  const etats = new Map<THREE.Material, [boolean, boolean, number]>()
  for (const groupe of groupes) for (const m of groupe) if (!etats.has(m)) etats.set(m, [m.transparent, m.depthWrite, m.opacity])
  try {
    for (const groupe of groupes) cloak(groupe, 0.5)
    rendre()
  } finally {
    for (const [m, [transparent, depthWrite, opacity]] of etats) {
      if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true }
      m.depthWrite = depthWrite
      m.opacity = opacity
    }
  }
}

/** Renders the prepared objects and restores their visibility and frustum culling. */
export function avecObjetsVisibles(roots: readonly THREE.Object3D[], rendre: () => void): void {
  const etats = new Map<THREE.Object3D, [boolean, boolean]>()
  for (const root of roots) root.traverse((objet) => {
    if (etats.has(objet)) return
    etats.set(objet, [objet.visible, objet.frustumCulled])
    objet.visible = true
    objet.frustumCulled = false
  })
  try { rendre() } finally {
    for (const [objet, [visible, filtre]] of etats) { objet.visible = visible; objet.frustumCulled = filtre }
  }
}

/** texturesDe: the textures of materials under the roots, deduplicated; painted armor's uniforms are counted. */
export function texturesDe(roots: readonly THREE.Object3D[]): THREE.Texture[] {
  const textures = new Set<THREE.Texture>()
  const ajouter = (valeur: unknown) => { if (valeur instanceof THREE.Texture) textures.add(valeur) }
  for (const racine of roots) racine.traverse((objet) => {
    const materiau = (objet as THREE.Mesh).material
    if (!materiau) return
    for (const m of Array.isArray(materiau) ? materiau : [materiau]) collecterTextures(m, ajouter)
  })
  return [...textures]
}

function collecterTextures(materiau: THREE.Material, ajouter: (valeur: unknown) => void): void {
  const champs = materiau as THREE.MeshStandardMaterial
  for (const t of [champs.map, champs.normalMap, champs.roughnessMap, champs.metalnessMap, champs.emissiveMap, champs.aoMap]) ajouter(t)
  if (materiau instanceof THREE.ShaderMaterial) for (const u of Object.values(materiau.uniforms)) ajouter(u.value)
  // Painted armor carries its masks and gradients in uniforms set by `onBeforeCompile` (cf. `armorMaterial3d`).
  const armure = materiau.userData.armorUniforms as Record<string, THREE.IUniform> | undefined
  if (armure) for (const u of Object.values(armure)) ajouter(u.value)
}
