/**
 * playerMarkers3d.ts — the top-down player markers: one filled disc at each living player's
 * feet in his team color, a short wedge where he is facing, and a ring around the followed
 * player. Pure geometry (`playerMarkers3d_logic`) decides where, facing, and dimming; this
 * file owns the pooled meshes and poses them in the scene. Drawn only in the top-down view.
 */
import * as THREE from 'three'
import { MARKER_RADIUS, topDownMarkers, type MarkerGeometry } from './playerMarkers3d_logic'
import type { FloorBand } from './topDownLogic'
import type { Avatar } from './avatar3d'

/** One player's marker pose at a frame, in scene axes. */
export interface MarkerPose {
  xuid: string
  /** The feet the disc sits on. */
  feet: THREE.Vector3
  /** Scene Y of the feet, to tell the player's floor. */
  y: number
  /** Yaw in degrees, the tracks' convention. */
  heading: number
  avatar: Avatar
}

/** A hair above the floor so a marker does not z-fight the surface under the player. */
const MARKER_LIFT = 0.02
/** How long the facing wedge runs from the disc center, in marker radii. */
const WEDGE_LENGTH = MARKER_RADIUS * 1.7
/** Half the wedge's base, in marker radii. */
const WEDGE_HALF = MARKER_RADIUS * 0.35

interface MarkerSet {
  disc: THREE.Mesh
  wedge: THREE.Mesh
}

/** The scene objects of one player's marker (a disc and a facing wedge). */
function makeMarker(color: THREE.Color): MarkerSet {
  const discGeo = new THREE.CircleGeometry(MARKER_RADIUS, 24)
  discGeo.rotateX(-Math.PI / 2)
  const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }))
  const wedgeGeo = new THREE.BufferGeometry()
  wedgeGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, WEDGE_HALF, 0, WEDGE_LENGTH, -WEDGE_HALF, 0, WEDGE_LENGTH], 3))
  const wedge = new THREE.Mesh(wedgeGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide }))
  return { disc, wedge }
}

export class PlayerMarkers3d {
  private readonly root = new THREE.Group()
  private readonly of = new Map<string, MarkerSet>()
  private readonly ring: THREE.Mesh
  /** The tags this view gave a chevron, so `hide` restores their plain name. */
  private chevroned: Avatar[] = []

  constructor() {
    const ringGeo = new THREE.RingGeometry(MARKER_RADIUS * 1.3, MARKER_RADIUS * 1.55, 32)
    ringGeo.rotateX(-Math.PI / 2)
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }))
    this.ring.visible = false
    this.root.add(this.ring)
  }

  /** Add the (hidden) marker root to the scene. */
  attach(scene: THREE.Scene): void {
    this.root.visible = false
    scene.add(this.root)
  }

  /** Show the marker root; pose per player with `update`. */
  show(): void { this.root.visible = true }

  /** Hide the root and every marker, restoring the tag text any chevron overwrote. */
  hide(): void {
    this.root.visible = false
    this.ring.visible = false
    for (const m of this.of.values()) m.disc.visible = false, (m.wedge.visible = false)
    for (const a of this.chevroned) a.tag.element.textContent = a.name
    this.chevroned = []
  }

  /** Remove the marker root from the scene and free its geometry. */
  dispose(scene: THREE.Scene): void {
    scene.remove(this.root)
    for (const m of this.of.values()) m.disc.geometry.dispose(), (m.disc.material as THREE.MeshBasicMaterial).dispose(), m.wedge.geometry.dispose(), (m.wedge.material as THREE.MeshBasicMaterial).dispose()
    this.of.clear()
    this.ring.geometry.dispose()
    ;(this.ring.material as THREE.MeshBasicMaterial).dispose()
  }

  /**
   * Pose this frame's markers: `poses` one per living player, `bands` and the drawn `band`
   * the view's, `followed` the ringed player (null: no ring). No band: everything hidden.
   */
  update(poses: MarkerPose[], bands: readonly FloorBand[], band: FloorBand | null, followed: string | null): void {
    if (!band) {
      this.hide()
      return
    }
    this.show()
    const geos = topDownMarkers(poses.map((p) => ({ xuid: p.xuid, y: p.y, heading: p.heading, alive: true })), bands, band)
    this.place(poses.map((p, i) => ({ xuid: p.xuid, feet: p.feet, geometry: geos[i], avatar: p.avatar })), followed)
  }

  /**
   * Pose the computed markers. `players` is one entry per living player, parallel to the
   * geometry; `followed` is the ringed player (null: no ring).
   */
  private place(players: { xuid: string; feet: THREE.Vector3; geometry: MarkerGeometry; avatar: Avatar }[], followed: string | null): void {
    this.chevroned = []
    const seen = new Set<string>()
    for (const { xuid, feet, geometry, avatar } of players) {
      seen.add(xuid)
      const set = this.setFor(xuid, avatar)
      const op = geometry.opacity
      set.disc.position.set(feet.x, feet.y + MARKER_LIFT, feet.z)
      set.wedge.position.copy(set.disc.position)
      set.wedge.rotation.y = Math.atan2(geometry.dirX, geometry.dirZ)
      for (const mesh of [set.disc, set.wedge]) mesh.visible = geometry.visible
      for (const material of [set.disc.material, set.wedge.material]) (material as THREE.MeshBasicMaterial).opacity = op
      if (geometry.visible) this.chevronTag(avatar, geometry)
    }
    for (const [xuid, m] of this.of) if (!seen.has(xuid)) m.disc.visible = false, (m.wedge.visible = false)
    this.placeRing(followed ? players.find((p) => p.xuid === followed) ?? null : null)
  }

  /** The followed player's ring, at his feet in his team color; hidden without one. */
  private placeRing(target: { feet: THREE.Vector3; avatar: Avatar } | null): void {
    if (!target) {
      this.ring.visible = false
      return
    }
    this.ring.visible = true
    this.ring.position.set(target.feet.x, target.feet.y + MARKER_LIFT, target.feet.z)
    ;(this.ring.material as THREE.MeshBasicMaterial).color.copy(target.avatar.tint)
  }

  /** A marker set for the player, minted in his team color on first use. */
  private setFor(xuid: string, avatar: Avatar): MarkerSet {
    let set = this.of.get(xuid)
    if (!set) {
      set = makeMarker(avatar.tint)
      this.root.add(set.disc, set.wedge)
      this.of.set(xuid, set)
    }
    return set
  }

  /**
   * Give a player's tag its floor chevron (in-band: plain name) and dim it off-band. The base
   * opacity placeTag set this frame is read, then multiplied by the marker opacity.
   */
  private chevronTag(avatar: Avatar, geometry: MarkerGeometry): void {
    const el = avatar.tag.element
    const chevron = geometry.chevron
    const text = chevron ? `${avatar.name} ${chevron === 'above' ? '↑' : '↓'}` : avatar.name
    if (el.textContent !== text) el.textContent = text
    if (chevron) this.chevroned.push(avatar)
    const base = el.style.opacity === '' ? 1 : Number(el.style.opacity)
    if (base > 0) el.style.opacity = String(Math.round(base * geometry.opacity * 100) / 100)
  }
}
