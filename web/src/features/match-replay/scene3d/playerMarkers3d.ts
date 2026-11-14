/**
 * playerMarkers3d.ts — the top-down player markers: one filled disc at each living player's
 * feet in his team color, a wedge out of it where he is facing, and a ring around the followed
 * player. Pure geometry (`playerMarkers3d_logic`) decides facing, dimming and size; this file
 * owns the pooled meshes and poses them in the scene. Drawn only in the top-down view.
 *
 * Markers are map symbols, not bodies: they are drawn over the scene (no depth test) at a fixed
 * size in screen pixels, just under the cut so the orthographic camera's near plane never clips
 * them, a player above the cut included. His tag is moved the same way, above his marker on
 * screen, since the label renderer hides a tag outside the camera's depth range.
 */
import * as THREE from 'three'
import { MARKER_RADIUS_PX, topDownMarkers, type MarkerGeometry } from './playerMarkers3d_logic'
import type { Avatar } from './avatar3d'

/** One living player's marker pose at a frame, in scene axes. */
export interface MarkerPose {
  xuid: string
  /** The feet the disc sits on. */
  feet: THREE.Vector3
  /** Yaw in degrees, the tracks' convention. */
  heading: number
  avatar: Avatar
}

/** How far under the cut markers and tags are drawn, inside the camera's depth range (u). */
const MARKER_DEPTH = 0.05
/** The facing wedge, in disc radii: from its base inside the disc to its tip outside. */
const WEDGE_BASE = 0.5
const WEDGE_TIP = 1.9
const WEDGE_HALF = 0.6
/** The dark rim under a disc, in disc radii: it keeps the disc readable on a sunlit floor. */
const RIM_SCALE = 1.3
/** The followed player's ring, inner and outer radius in disc radii. */
const RING_INNER = 1.5
const RING_OUTER = 1.9
/** The tag's center above the marker's on screen (CSS px): a radius, a gap, half a tag. */
const TAG_OFFSET_PX = MARKER_RADIUS_PX + 16
/** Draw order: off-floor markers, then on-floor ones over them, the ring last; a rim under its disc. */
const ORDER_DIMMED = 10
const ORDER_ON_FLOOR = 11
const ORDER_RING = 12
const ORDER_OVER_RIM = 0.5

/** What the view tells the markers each frame. */
export interface MarkerView {
  /** The cut height (scene Y): players above it are on a floor not drawn. */
  cutY: number
  /** The ringed player, null in free camera. */
  followed: string | null
  /** World units per CSS pixel of the view, so a marker keeps its size on screen. */
  unitsPerPx: number
  /** The rim color under each disc (the page's studio color), null for no rim. */
  rim: THREE.Color | null
}

interface MarkerSet {
  root: THREE.Group
  rim: THREE.Mesh
  disc: THREE.Mesh
  wedge: THREE.Mesh
  material: THREE.MeshBasicMaterial
  rimMaterial: THREE.MeshBasicMaterial
}

/** A material drawn over the scene: no depth test or write, no fog, translucent when dimmed. */
function overlayMaterial(color: THREE.Color): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide })
}

/** The shared unit geometries (disc radius 1, flat on the floor, the wedge along +Z). */
function unitGeometries(): { disc: THREE.BufferGeometry; wedge: THREE.BufferGeometry; ring: THREE.BufferGeometry } {
  const disc = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2)
  const wedge = new THREE.BufferGeometry()
  wedge.setAttribute('position', new THREE.Float32BufferAttribute([WEDGE_HALF, 0, WEDGE_BASE, -WEDGE_HALF, 0, WEDGE_BASE, 0, 0, WEDGE_TIP], 3))
  const ring = new THREE.RingGeometry(RING_INNER, RING_OUTER, 40).rotateX(-Math.PI / 2)
  return { disc, wedge, ring }
}

export class PlayerMarkers3d {
  private readonly root = new THREE.Group()
  private readonly of = new Map<string, MarkerSet>()
  private readonly geo = unitGeometries()
  private readonly ring: THREE.Mesh
  /** The tags this view changed (text, place), so `hide` gives them their plain name back. */
  private touched: Avatar[] = []

  constructor(scene: THREE.Scene) {
    this.ring = new THREE.Mesh(this.geo.ring, overlayMaterial(new THREE.Color()))
    this.ring.renderOrder = ORDER_RING
    this.root.add(this.ring)
    this.root.visible = false
    scene.add(this.root)
  }

  /** Hide every marker, restoring the tag text a chevron overwrote. */
  hide(): void {
    if (!this.root.visible) return
    this.root.visible = false
    for (const a of this.touched) a.tag.element.textContent = a.name
    this.touched = []
  }

  /** Remove the markers from the scene and free their geometry and materials. */
  dispose(scene: THREE.Scene): void {
    scene.remove(this.root)
    for (const m of this.of.values()) m.material.dispose(), m.rimMaterial.dispose()
    this.of.clear()
    ;(this.ring.material as THREE.Material).dispose()
    for (const g of Object.values(this.geo)) g.dispose()
  }

  /** Pose this frame's markers: `poses` one per living player, `view` what the top-down view tells. */
  update(poses: readonly MarkerPose[], view: MarkerView): void {
    this.root.visible = true
    const before = this.touched
    this.touched = []
    const radius = MARKER_RADIUS_PX * view.unitsPerPx
    const y = view.cutY - MARKER_DEPTH
    const geos = topDownMarkers(poses.map((p) => ({ y: p.feet.y, heading: p.heading })), view.cutY)
    for (const m of this.of.values()) m.root.visible = false
    this.ring.visible = false
    poses.forEach((p, i) => {
      const set = this.setFor(p.xuid, p.avatar)
      this.place(set, p, geos[i], { radius, y, rim: view.rim })
      this.placeTag(p, geos[i], y, view.unitsPerPx)
      if (p.xuid === view.followed) this.placeRing(p, radius, y)
    })
    for (const a of before) if (!this.touched.includes(a)) a.tag.element.textContent = a.name
  }

  /** Pose one player's rim, disc and wedge at his feet, at the drawing height `at.y`. */
  private place(set: MarkerSet, p: MarkerPose, g: MarkerGeometry, at: { radius: number; y: number; rim: THREE.Color | null }): void {
    set.root.visible = true
    set.root.position.set(p.feet.x, at.y, p.feet.z)
    set.root.scale.setScalar(at.radius)
    set.wedge.rotation.y = Math.atan2(g.dirX, g.dirZ)
    set.material.opacity = g.opacity
    set.rim.visible = at.rim !== null
    if (at.rim) set.rimMaterial.color.copy(at.rim)
    set.rimMaterial.opacity = g.opacity
    const order = g.chevron ? ORDER_DIMMED : ORDER_ON_FLOOR
    set.rim.renderOrder = order
    set.disc.renderOrder = order + ORDER_OVER_RIM
    set.wedge.renderOrder = order + ORDER_OVER_RIM
  }

  /** The followed player's ring, around his disc in his team color. */
  private placeRing(p: MarkerPose, radius: number, y: number): void {
    this.ring.visible = true
    this.ring.position.set(p.feet.x, y, p.feet.z)
    this.ring.scale.setScalar(radius)
    ;(this.ring.material as THREE.MeshBasicMaterial).color.copy(p.avatar.tint)
  }

  /**
   * Put the player's tag above his marker on screen (scene -Z is screen up in this view), give it
   * his floor chevron and dim it off-floor; the opacity the tag already has is multiplied.
   */
  private placeTag(p: MarkerPose, g: MarkerGeometry, y: number, unitsPerPx: number): void {
    const { tag, name } = p.avatar
    tag.position.set(p.feet.x, y, p.feet.z - TAG_OFFSET_PX * unitsPerPx)
    const el = tag.element
    const text = g.chevron ? `${name} ${g.chevron === 'above' ? '↑' : '↓'}` : name
    if (el.textContent !== text) el.textContent = text
    if (g.chevron) this.touched.push(p.avatar)
    const base = el.style.opacity === '' ? 1 : Number(el.style.opacity)
    const opacity = Math.round(base * g.opacity * 100) / 100
    const css = opacity >= 1 ? '' : String(opacity)
    if (el.style.opacity !== css) el.style.opacity = css
  }

  /** A marker set for the player, minted in his team color on first use. */
  private setFor(xuid: string, avatar: Avatar): MarkerSet {
    let set = this.of.get(xuid)
    if (!set) {
      const material = overlayMaterial(avatar.tint)
      const rimMaterial = overlayMaterial(avatar.tint)
      const root = new THREE.Group()
      const rim = new THREE.Mesh(this.geo.disc, rimMaterial)
      rim.scale.setScalar(RIM_SCALE)
      const disc = new THREE.Mesh(this.geo.disc, material)
      const wedge = new THREE.Mesh(this.geo.wedge, material)
      root.add(rim, disc, wedge)
      this.root.add(root)
      set = { root, rim, disc, wedge, material, rimMaterial }
      this.of.set(xuid, set)
    }
    return set
  }
}
