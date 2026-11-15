/**
 * topDownStage3d.ts — what every top-down render changes on the shared scene, and gives back after
 * it: the page's studio color as background, the helpers that have no place in a map (sky, structure
 * back faces) hidden, the surfaces that only dress the layout left out (`hiddenFromTop`: foliage,
 * coarse decor, decals, cutout leaves), and the light of a map seen from above, shaded by the
 * match's walked heights.
 *
 * Nothing here depends on where a player stands: the map picture of the 2D view and of the corner
 * minimap is the same at every frame of the match, only panned and zoomed.
 *
 * The light: the 3D view's low sun and its shadow map make sunlit pools under every skylight and
 * dark bands under every beam, readable from eye height but not from above, where they read as the
 * map's colors; the game's lamps and baked light and the probes' reflections do the same with hot
 * spots and skylight pools. Seen from above the map takes one flat light instead (`topDownShade3d`),
 * so every floor is evenly lit and keeps its own color, and the sun is put out for what is not the
 * map (the players' bodies). A soft overhead sun was tried and dropped: a light straight down, seen
 * straight down, puts its specular peak on every flat floor, and the metal floors read white.
 */
import * as THREE from 'three'

import { BACK_FACE_NAME } from './backFaces3d'
import { cssColor } from './cssColor'
import { drawnBy, inObjectLayer, surfaceFamily } from './surfaceProbe3d'
import { flatShare, hiddenFromTop, type HeightSpan } from './topDownLogic'
import { flatTopLight } from './topDownShade3d'

/** The lift of a top-down camera above its cut, keeps the near plane positive (u). */
export const TOP_LIFT = 2
/** Helper meshes not drawn in the top-down view (the sky is passed separately to `sync`). */
const HIDDEN_NAMES = new Set([BACK_FACE_NAME])

/**
 * One top-down render: `mapOnly` also hides everything but the map and its lights (for a cached
 * map image, which must not hold a player); `clear` false leaves the background empty, so the
 * image's alpha tells where the map is.
 */
export interface StageRun {
  mapOnly: boolean
  clear?: boolean
}

interface Saved {
  obj: THREE.Object3D
  visible: boolean
}

export class TopDownStage {
  readonly scene: THREE.Scene
  private readonly sun: THREE.DirectionalLight
  /** The match's walked heights: the absolute scale of the height shading. */
  private readonly span: HeightSpan | null
  private hidden: Saved[] = []
  /** The map surfaces left out of every top-down render (`clutterOf`); null until the first render after a sync. */
  private clutter: Saved[] | null = null
  /** The map's roots (map, posed layer): kept by a map-only render. */
  private roots: THREE.Object3D[] = []
  /** The page's studio color, read from its `--studio-950` token once; null if absent. */
  private studio: THREE.Color | null = null
  private studioRead = false

  constructor(scene: THREE.Scene, sun: THREE.DirectionalLight, span: HeightSpan | null = null) {
    this.scene = scene
    this.sun = sun
    this.span = span
  }

  /** Collect the helpers to hide (by name) plus the sky, and the map roots; run when the scene graph changes. */
  sync(sky: THREE.Object3D | null, roots: readonly THREE.Object3D[]): void {
    this.hidden = []
    this.clutter = null
    this.roots = [...roots]
    if (sky) this.hidden.push({ obj: sky, visible: sky.visible })
    this.scene.traverse((obj) => {
      if (HIDDEN_NAMES.has(obj.name)) this.hidden.push({ obj, visible: obj.visible })
    })
  }

  /**
   * The page's dark studio color from its `--studio-950` token, read once; null if the token is
   * absent or the scene background is not a color. The scene's own background is the fallback the
   * resolver takes when the token cannot be painted, so no color is invented here.
   */
  studioColor(): THREE.Color | null {
    if (!this.studioRead) {
      this.studioRead = true
      const value = getComputedStyle(document.documentElement).getPropertyValue('--studio-950').trim()
      const background = this.scene.background
      if (value && background instanceof THREE.Color) this.studio = cssColor(value, background)
    }
    return this.studio
  }

  /** Run `draw` with the scene staged for a top-down render, and give everything back after it. */
  run(how: StageRun, draw: () => void): void {
    const scene = this.scene
    const saved = { fog: scene.fog, background: scene.background }
    scene.background = how.clear === false ? null : this.studioColor()
    // No fog: it measures from the camera, and the map's shading is by world height alone.
    scene.fog = null
    const always = [...this.hidden, ...this.clutterOf()]
    const hidden = how.mapOnly ? [...always, ...this.transients()] : always
    const states = hidden.map((h) => ({ obj: h.obj, visible: h.obj.visible }))
    for (const h of hidden) h.obj.visible = false
    const restoreLight = this.sunOut()
    const restoreFlat = flatTopLight(this.span)
    try {
      draw()
    } finally {
      restoreFlat()
      restoreLight()
      for (const s of states) s.obj.visible = s.visible
      scene.fog = saved.fog
      scene.background = saved.background
    }
  }

  /**
   * The map surfaces a top-down render leaves out (`hiddenFromTop`: foliage, coarse decor, decals,
   * light cards, glass, cutout leaves), collected at the first render after a `sync`, once the map's
   * merged draws (`layeredBatch3d`) exist: a merged mesh goes with the surfaces it draws, and stays
   * when one of them stays.
   */
  private clutterOf(): Saved[] {
    if (this.clutter) return this.clutter
    const out = new Set<THREE.Object3D>()
    const kept = new Set<THREE.Object3D>()
    for (const root of this.roots) {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const family = surfaceFamily(mesh)
        const materials = [mesh.material].flat()
        const transparent = materials.some((m) => m.transparent)
        const cutout = materials.some((m) => m.alphaTest > 0)
        const objectLayer = inObjectLayer(mesh)
        // The flat share is only read for a map cutout: the rest is decided without it.
        const flat = cutout && !objectLayer && family !== null ? flatShare(...worldTriangles(mesh)) : 1
        const hide = hiddenFromTop({ family, instanced: (mesh as THREE.InstancedMesh).isInstancedMesh === true, transparent, cutout, objectLayer, flat })
        const drawer = drawnBy(mesh)
        if (hide) {
          out.add(mesh)
          if (drawer) out.add(drawer)
        } else if (drawer && family !== null) kept.add(drawer)
      })
    }
    for (const k of kept) out.delete(k)
    this.clutter = [...out].map((obj) => ({ obj, visible: obj.visible }))
    return this.clutter
  }

  /** The scene's children a map-only render hides: all but the map roots and the lights. */
  private transients(): Saved[] {
    const kept = new Set<THREE.Object3D>([...this.roots, this.sun.target])
    return this.scene.children
      .filter((c) => c.visible && !kept.has(c) && !(c as THREE.Light).isLight)
      .map((obj) => ({ obj, visible: true }))
  }

  /** Put the sun out (its intensity, a uniform: nothing recompiles); returns the restore. */
  private sunOut(): () => void {
    const sun = this.sun
    const intensity = sun.intensity
    sun.intensity = 0
    return () => {
      sun.intensity = intensity
    }
  }
}

/**
 * worldTriangles — a mesh's triangles in world space as a flat X, Y, Z soup (`flatShare`'s input):
 * only the vertices its index references, since the map's surfaces share one vertex buffer.
 */
function worldTriangles(mesh: THREE.Mesh): [Float32Array, null] {
  const g = mesh.geometry
  const position = g.getAttribute('position')
  if (!position) return [new Float32Array(0), null]
  mesh.updateWorldMatrix(true, false)
  const index = g.index
  const count = index ? index.count : position.count
  const out = new Float32Array(count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld)
    out[3 * i] = v.x
    out[3 * i + 1] = v.y
    out[3 * i + 2] = v.z
  }
  return [out, null]
}
