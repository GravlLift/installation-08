// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * playerMarkers3d.ts — the top-down player markers: one filled disc at each living player's
 * feet in his team color, a wedge out of it where he is facing, a light arrow inside it when he is
 * on another floor than the drawn one (up or down, `levelArrow`), a ring around the followed
 * player, and a cross where a dead player fell, until he is back. Every living player gets one,
 * whatever his floor: the marker is drawn over the scene, never cut or fogged with it. Pure geometry
 * (`playerMarkers3d_logic`) decides facing, dimming, size and tag places; this file owns the pooled
 * meshes and poses them in the scene. Drawn only in the top-down view.
 *
 * Markers are map symbols, not bodies: they are drawn over the scene (no depth test) at a fixed
 * size in screen pixels, just under the cut so the orthographic camera's near plane never clips
 * them, a player above the cut included. Each sits on a light edge and a dark halo (the page's ink
 * and studio tokens), so it reads on a dark floor and on a bright one. His tag is moved the same
 * way, over or under his marker on screen (`declutterTags`), since the label renderer hides a tag
 * outside the camera's depth range.
 */
import * as THREE from 'three'
import { DIMMED_MARKER_OPACITY, MARKER_RADIUS_PX, TAG_OFFSET_PX, declutterTags, floorOf, levelArrow, topDownMarkers, type MarkerGeometry, type TagPlace } from './playerMarkers3d_logic'
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

/** A dead player waiting to come back: where he fell, in scene axes. */
export interface DeadPose {
  xuid: string
  feet: THREE.Vector3
  avatar: Avatar
}

/** How far under the cut markers and tags are drawn, inside the camera's depth range (u). */
const MARKER_DEPTH = 0.05
/** The facing wedge, in disc radii: from its base inside the disc to its tip outside. */
const WEDGE_BASE = 0.5
const WEDGE_TIP = 1.9
const WEDGE_HALF = 0.6
/** Under a disc, in disc radii: the light edge, and the dark halo around it. */
const EDGE_SCALE = 1.25
const HALO_SCALE = 1.5
/** The level arrow inside the disc, in disc radii: its tip and its base from the center, its half width. */
const ARROW_TIP = 0.7
const ARROW_BASE = 0.45
const ARROW_HALF = 0.6
/** The followed player's ring, inner and outer radius in disc radii. */
const RING_INNER = 1.6
const RING_OUTER = 2
/** The cross of a dead player: arm length and width in disc radii, its halo's scale. */
const CROSS_ARM = 2
const CROSS_WIDTH = 0.45
const CROSS_HALO = 1.35
/** A dead player's cross is a reminder, not a player: drawn translucent. */
const DEAD_OPACITY = 0.6
/** A tag's size before the page has laid it out (CSS px): about a short name. */
const TAG_GUESS = { w: 90, h: 16 }
/** Tag ranks: the followed player first, then the drawn floor, then the other floors. */
const RANK_FOLLOWED = 0
const RANK_ON_FLOOR = 1
const RANK_OFF_FLOOR = 2
/** Draw order: dead, off-floor markers, then on-floor ones over them, the ring last; each layer of a marker over the one under it. */
const ORDER_DEAD = 9
const ORDER_DIMMED = 10
const ORDER_ON_FLOOR = 11
const ORDER_RING = 12
const ORDER_STEP = 0.25

/** What the view tells the markers each frame. */
export interface MarkerView {
  /** The followed floor's cut (scene Y, `CutFollower`): players above it or well under its floor are on another floor. */
  cutY: number
  /** The picture's cut (scene Y): markers and tags are drawn just under it, inside the camera's depth range. */
  drawY: number
  /** The ringed player, null in free camera. */
  followed: string | null
  /** World units per CSS pixel of the view, so a marker keeps its size on screen. */
  unitsPerPx: number
  /** The dark halo (the page's studio color) and the light edge (its ink) under each marker; null for none. */
  halo: THREE.Color | null
  edge: THREE.Color | null
  /** The canvas point (CSS px) of a scene (X, Z). */
  toScreen: (x: number, z: number) => [number, number]
}

interface MarkerSet {
  root: THREE.Group
  halo: THREE.Mesh
  edge: THREE.Mesh
  disc: THREE.Mesh
  wedge: THREE.Mesh
  arrow: THREE.Mesh
  cross: THREE.Mesh
  crossHalo: THREE.Mesh
  material: THREE.MeshBasicMaterial
  haloMaterial: THREE.MeshBasicMaterial
  edgeMaterial: THREE.MeshBasicMaterial
  arrowMaterial: THREE.MeshBasicMaterial
}

/** A material drawn over the scene: no depth test or write, no fog, translucent when dimmed. */
function overlayMaterial(color: THREE.Color): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide })
}

/** The shared unit geometries (disc radius 1, flat on the floor, the wedge along +Z, the arrow along -Z: screen up). */
function unitGeometries(): Record<'disc' | 'wedge' | 'arrow' | 'ring' | 'cross', THREE.BufferGeometry> {
  const disc = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2)
  const wedge = new THREE.BufferGeometry()
  wedge.setAttribute('position', new THREE.Float32BufferAttribute([WEDGE_HALF, 0, WEDGE_BASE, -WEDGE_HALF, 0, WEDGE_BASE, 0, 0, WEDGE_TIP], 3))
  const arrow = new THREE.BufferGeometry()
  arrow.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -ARROW_TIP, -ARROW_HALF, 0, ARROW_BASE, ARROW_HALF, 0, ARROW_BASE], 3))
  const ring = new THREE.RingGeometry(RING_INNER, RING_OUTER, 40).rotateX(-Math.PI / 2)
  const h = CROSS_ARM / 2
  const w = CROSS_WIDTH / 2
  const arm = (s: number) => [-h, 0, -h * s + w, -h, 0, -h * s - w, h, 0, h * s - w, -h, 0, -h * s + w, h, 0, h * s - w, h, 0, h * s + w]
  const cross = new THREE.BufferGeometry()
  cross.setAttribute('position', new THREE.Float32BufferAttribute([...arm(1), ...arm(-1)], 3))
  return { disc, wedge, arrow, ring, cross }
}

export class PlayerMarkers3d {
  private readonly root = new THREE.Group()
  private readonly of = new Map<string, MarkerSet>()
  private readonly geo = unitGeometries()
  private readonly ring: THREE.Mesh
  /** Laid-out tag sizes by text (CSS px). */
  private readonly tagSize = new Map<string, { w: number; h: number }>()
  /** The tags this view changed (text, place), so `hide` gives them their plain name back. */
  private touched: Avatar[] = []

  constructor(scene: THREE.Scene) {
    this.ring = new THREE.Mesh(this.geo.ring, overlayMaterial(new THREE.Color()))
    this.ring.renderOrder = ORDER_RING
    this.ring.frustumCulled = false
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
    for (const m of this.of.values()) m.material.dispose(), m.haloMaterial.dispose(), m.edgeMaterial.dispose(), m.arrowMaterial.dispose()
    this.of.clear()
    ;(this.ring.material as THREE.Material).dispose()
    for (const g of Object.values(this.geo)) g.dispose()
  }

  /** Pose this frame's markers: `poses` one per living player, `dead` one per dead player, `view` what the top-down view tells. */
  update(poses: readonly MarkerPose[], dead: readonly DeadPose[], view: MarkerView): void {
    this.root.visible = true
    const before = this.touched
    this.touched = []
    const at = { radius: MARKER_RADIUS_PX * view.unitsPerPx, y: view.drawY - MARKER_DEPTH, view }
    const geos = topDownMarkers(poses.map((p) => ({ y: p.feet.y, heading: p.heading })), view.cutY)
    for (const m of this.of.values()) m.root.visible = false
    this.ring.visible = false
    const places = this.tagPlaces(poses, geos, view)
    poses.forEach((p, i) => {
      const set = this.setFor(p.xuid, p.avatar)
      this.place(set, p, geos[i], at)
      this.placeTag(p, geos[i], places[i], at)
      if (p.xuid === view.followed) this.placeRing(p, at.radius, at.y)
    })
    for (const d of dead) this.placeDead(this.setFor(d.xuid, d.avatar), d, at)
    for (const a of before) if (!this.touched.includes(a)) a.tag.element.textContent = a.name
  }

  /** Where each living player's tag goes this frame (`declutterTags`). */
  private tagPlaces(poses: readonly MarkerPose[], geos: readonly MarkerGeometry[], view: MarkerView): TagPlace[] {
    return declutterTags(poses.map((p, i) => {
      const [x, y] = view.toScreen(p.feet.x, p.feet.z)
      const rank = p.xuid === view.followed ? RANK_FOLLOWED : geos[i].chevron ? RANK_OFF_FLOOR : RANK_ON_FLOOR
      return { x, y, ...this.sizeOf(p.avatar, tagText(p.avatar.name, geos[i])), rank }
    }))
  }

  /** A tag's laid-out size for `text`, measured once the page has laid it out; a guess before. */
  private sizeOf(a: Avatar, text: string): { w: number; h: number } {
    const known = this.tagSize.get(text)
    if (known) return known
    const el = a.tag.element
    if (el.textContent !== text || el.offsetWidth === 0) return TAG_GUESS
    const size = { w: el.offsetWidth, h: el.offsetHeight }
    this.tagSize.set(text, size)
    return size
  }

  /** Pose one player's halo, edge, disc and wedge at his feet, at the drawing height `at.y`. */
  private place(set: MarkerSet, p: MarkerPose, g: MarkerGeometry, at: { radius: number; y: number; view: MarkerView }): void {
    this.show(set, p.feet, at, g.opacity)
    for (const m of [set.halo, set.edge, set.disc, set.wedge]) m.visible = true
    set.cross.visible = set.crossHalo.visible = false
    set.halo.visible = at.view.halo !== null
    set.edge.visible = at.view.edge !== null
    set.wedge.rotation.y = Math.atan2(g.dirX, g.dirZ)
    const arrow = levelArrow(g.chevron)
    set.arrow.visible = arrow !== 0
    set.arrow.rotation.y = arrow > 0 ? Math.PI : 0
    const order = g.chevron ? ORDER_DIMMED : ORDER_ON_FLOOR
    set.halo.renderOrder = order
    set.edge.renderOrder = order + ORDER_STEP
    set.disc.renderOrder = order + 2 * ORDER_STEP
    set.wedge.renderOrder = order + 2 * ORDER_STEP
    set.arrow.renderOrder = order + 3 * ORDER_STEP
  }

  /** A dead player's cross where he fell, on its halo, dimmed when that is off the drawn floor. */
  private placeDead(set: MarkerSet, d: DeadPose, at: { radius: number; y: number; view: MarkerView }): void {
    const opacity = floorOf(d.feet.y, at.view.cutY) ? DIMMED_MARKER_OPACITY * DEAD_OPACITY : DEAD_OPACITY
    this.show(set, d.feet, at, opacity)
    for (const m of [set.halo, set.edge, set.disc, set.wedge, set.arrow]) m.visible = false
    set.cross.visible = true
    set.crossHalo.visible = at.view.halo !== null
    set.crossHalo.renderOrder = ORDER_DEAD
    set.cross.renderOrder = ORDER_DEAD + ORDER_STEP
  }

  /** Show a player's marker root at his feet with this frame's colors and opacity. */
  private show(set: MarkerSet, feet: THREE.Vector3, at: { radius: number; y: number; view: MarkerView }, opacity: number): void {
    set.root.visible = true
    set.root.position.set(feet.x, at.y, feet.z)
    set.root.scale.setScalar(at.radius)
    if (at.view.halo) set.haloMaterial.color.copy(at.view.halo)
    if (at.view.edge) set.edgeMaterial.color.copy(at.view.edge), set.arrowMaterial.color.copy(at.view.edge)
    for (const m of [set.material, set.haloMaterial, set.edgeMaterial, set.arrowMaterial]) m.opacity = opacity
  }

  /** The followed player's ring, around his disc in his team color. */
  private placeRing(p: MarkerPose, radius: number, y: number): void {
    this.ring.visible = true
    this.ring.position.set(p.feet.x, y, p.feet.z)
    this.ring.scale.setScalar(radius)
    ;(this.ring.material as THREE.MeshBasicMaterial).color.copy(p.avatar.tint)
  }

  /**
   * Put the player's tag over or under his marker on screen (scene -Z is screen up in this view),
   * or hide it, give it his floor chevron and dim it off-floor; the opacity the tag already has is
   * multiplied.
   */
  private placeTag(p: MarkerPose, g: MarkerGeometry, place: TagPlace, at: { y: number; view: MarkerView }): void {
    const { tag, name } = p.avatar
    tag.visible = tag.visible && place !== 'hidden'
    const dz = (place === 'below' ? TAG_OFFSET_PX : -TAG_OFFSET_PX) * at.view.unitsPerPx
    tag.position.set(p.feet.x, at.y, p.feet.z + dz)
    const el = tag.element
    const text = tagText(name, g)
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
      const haloMaterial = overlayMaterial(new THREE.Color())
      const edgeMaterial = overlayMaterial(new THREE.Color())
      // White until the page's ink is known (`show`): light on every team color.
      const arrowMaterial = overlayMaterial(new THREE.Color(1, 1, 1))
      const root = new THREE.Group()
      const halo = new THREE.Mesh(this.geo.disc, haloMaterial)
      halo.scale.setScalar(HALO_SCALE)
      const edge = new THREE.Mesh(this.geo.disc, edgeMaterial)
      edge.scale.setScalar(EDGE_SCALE)
      const disc = new THREE.Mesh(this.geo.disc, material)
      const wedge = new THREE.Mesh(this.geo.wedge, material)
      const crossHalo = new THREE.Mesh(this.geo.cross, haloMaterial)
      crossHalo.scale.setScalar(CROSS_HALO)
      const cross = new THREE.Mesh(this.geo.cross, material)
      const arrow = new THREE.Mesh(this.geo.arrow, arrowMaterial)
      root.add(halo, edge, disc, wedge, arrow, crossHalo, cross)
      // Map symbols: always drawn when posed, never culled against the cut camera's depth range.
      for (const m of root.children) m.frustumCulled = false
      this.root.add(root)
      set = { root, halo, edge, disc, wedge, arrow, cross, crossHalo, material, haloMaterial, edgeMaterial, arrowMaterial }
      this.of.set(xuid, set)
    }
    return set
  }
}

/** A tag's text: the name, with an arrow toward his floor when it is not the drawn one. */
function tagText(name: string, g: MarkerGeometry): string {
  return g.chevron ? `${name} ${g.chevron === 'above' ? '↑' : '↓'}` : name
}
