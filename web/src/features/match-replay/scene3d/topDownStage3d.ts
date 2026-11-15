/**
 * topDownStage3d.ts — what every top-down render changes on the shared scene, and gives back after
 * it: the page's studio color as background, a fog in that color that fades the floors under the
 * drawn one with their depth, the helpers that have no place in a map (sky, structure back faces)
 * hidden, and the light of a map seen from above.
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
import { CUT_HEADROOM } from './topDownLogic'
import { flatTopLight } from './topDownShade3d'

/** The lift of a top-down camera above its cut, keeps the near plane positive (u). */
export const TOP_LIFT = 2
/** The fog under the drawn floor: where it starts below it, and the depth it takes to full (u). */
const FADE_START = 0.5
const FADE_DEPTH = 12
/** Helper meshes not drawn in the top-down view (the sky is passed separately to `sync`). */
const HIDDEN_NAMES = new Set([BACK_FACE_NAME])

/**
 * One top-down render: `mapOnly` also hides everything but the map, its lights and `keep` (for a
 * cached map image, which must not hold a player); `clear` false leaves the background empty, so
 * the image's alpha tells where the map is.
 */
export interface StageRun {
  mapOnly: boolean
  keep?: readonly THREE.Object3D[]
  clear?: boolean
}

interface Saved {
  obj: THREE.Object3D
  visible: boolean
}

export class TopDownStage {
  readonly scene: THREE.Scene
  private readonly sun: THREE.DirectionalLight
  private hidden: Saved[] = []
  /** The map's roots (map, posed layer): kept by a map-only render. */
  private roots: THREE.Object3D[] = []
  /** The page's studio color, read from its `--studio-950` token once; null if absent. */
  private studio: THREE.Color | null = null
  private studioRead = false
  private fog: THREE.Fog | null = null

  constructor(scene: THREE.Scene, sun: THREE.DirectionalLight) {
    this.scene = scene
    this.sun = sun
  }

  /** Collect the helpers to hide (by name) plus the sky, and the map roots; run when the scene graph changes. */
  sync(sky: THREE.Object3D | null, roots: readonly THREE.Object3D[]): void {
    this.hidden = []
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
    const studio = this.studioColor()
    scene.background = how.clear === false ? null : studio
    scene.fog = studio ? this.fadeBelow(studio) : null
    const hidden = how.mapOnly ? [...this.hidden, ...this.transients(how.keep ?? [])] : this.hidden
    const states = hidden.map((h) => ({ obj: h.obj, visible: h.obj.visible }))
    for (const h of hidden) h.obj.visible = false
    const restoreLight = this.sunOut()
    const restoreFlat = flatTopLight()
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

  /** The scene's children a map-only render hides: all but the map roots, the lights and `keep`. */
  private transients(keep: readonly THREE.Object3D[]): Saved[] {
    const kept = new Set<THREE.Object3D>([...this.roots, ...keep, this.sun.target])
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
  /**
   * The fog that fades what lies under the drawn floor into the studio color with its depth;
   * distances are from the camera, which rides `TOP_LIFT` over the cut in every top-down render.
   */
  private fadeBelow(color: THREE.Color): THREE.Fog {
    const near = TOP_LIFT + CUT_HEADROOM + FADE_START
    this.fog ??= new THREE.Fog(color, near, near + FADE_DEPTH)
    return this.fog
  }
}
