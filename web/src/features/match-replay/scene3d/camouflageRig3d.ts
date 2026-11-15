/**
 * camouflageRig3d.ts — ACTIVE CAMO ON THE FIRST-PERSON ARMS AND WEAPON.
 *
 * The followed player's camo episode (`equipmentEpisodes`, strength by `equip3d.equipFxAt`) fades
 * his own arms and weapon as it fades his Spartan seen from outside (`avatar3d.cloak`, same
 * opacity rule): the rig's materials turn translucent while the strength is above zero, and get
 * back their own state (transparency, depth writing, opacity) when it falls to zero or another rig
 * takes the view. The rig's materials belong to the first-person view alone, so nothing else fades.
 */
import * as THREE from 'three'

import { cloakOpacity } from './avatar3d'

interface MaterialState {
  transparent: boolean
  depthWrite: boolean
  opacity: number
}

export class CamouflageRig3d {
  /** The rig root whose materials are cloaked now, null when none is. */
  private root: THREE.Object3D | null = null
  private readonly saved = new Map<THREE.Material, MaterialState>()

  /** apply cloaks the rig `root` at strength `camo` (0 visible, 1 full); null or 0 restores what was cloaked. */
  apply(root: THREE.Object3D | null, camo: number): void {
    if (this.root && (this.root !== root || camo <= 0)) this.restore()
    if (!root || camo <= 0) return
    this.root = root
    const opacity = cloakOpacity(camo)
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      if (Array.isArray(o.material)) for (const m of o.material) this.cloak(m, opacity)
      else this.cloak(o.material, opacity)
    })
  }

  private cloak(m: THREE.Material, opacity: number): void {
    let state = this.saved.get(m)
    if (!state) {
      state = { transparent: m.transparent, depthWrite: m.depthWrite, opacity: m.opacity }
      this.saved.set(m, state)
      m.transparent = true
      m.depthWrite = false
      m.needsUpdate = true
    }
    m.opacity = state.opacity * opacity
  }

  private restore(): void {
    for (const [m, state] of this.saved) {
      m.transparent = state.transparent
      m.depthWrite = state.depthWrite
      m.opacity = state.opacity
      m.needsUpdate = true
    }
    this.saved.clear()
    this.root = null
  }
}
