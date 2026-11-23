// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * padNavpointMarkers3d.ts — THE GAME'S PAD NAVPOINTS IN THE 3D SCENE, one marker per pad.
 *
 * The game marks every weapon pad with a small icon. It writes no countdown under it (Jordan,
 * 2026-11-21: the pad's ring fills as the item's return nears, and the navpoint shows no number),
 * although the `nvpt` tag carries a numeric timer element. This layer draws the same markers in
 * the 3D view: one `CSS2DObject` per pad, positioned imperatively each frame.
 *
 * ON SCREEN: the icon sits ABOVE the item's anchor, with a thin vertical line from the icon
 * down to the item (F2). The icon is raised by `ICON_OFFSET_UI` nvpt UI units (fitted to the
 * in-game screenshot; the game's line element is in the Template Navpoint, which is null in
 * the pad nvpt tag).
 *
 * OFF SCREEN: when the item is off the screen or behind the camera, the icon is docked on an
 * invisible oval around the screen in the item's direction (F1). The oval is fitted to the
 * in-game screenshot: centred slightly above the screen centre, with the icons bunching at
 * the upper-left and upper-right when the player faces away from all pads.
 *
 * THE SIZES ARE THE GAME'S, FROM THE `nvpt` NAVPOINT TAG (`padnavpoint.json`): the icon's
 * width and height and its alpha, in the game's UI units,
 * scaled to the view through `cqh` (1cqh = 1% of the view height).
 *
 * THE COLOR is the 3D HUD's weapon ink (`--replay-hud-weapon`): the icon is a mask filled with
 * it, as `WeaponIcon` tints its icons.
 *
 * A POWER WEAPON'S PAD shows the navpoint's hex badge, not the weapon's icon, with the weapon's
 * name and its distance stacked above it (the tag's group 2: "name_text" in Industry Demi, the
 * distance number in Normative Pro Bold Italic; Jordan's capture of 2026-11-22: "53.8m" over
 * "SHOCK RIFLE" over the hex). Equipment and power-up pads keep the item's icon. Racks and loose
 * weapons get no navpoint at all: only power weapons, which spawn on pads, carry one (Jordan,
 * 2026-11-22).
 */
import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

import type { ActionContext, ActionLayer3d } from './actionScene3d'
import { padItemCenter, type PadSpot, type Pickups3dLayer } from './pickups3d'
import { padIconRefFor, padNameFor } from '../layers/useReplayWeaponPads'
import { HUD_FONT_FAMILY } from '../ui/hudFonts'
import { REPLAY_TEXT } from '../i18n/i18n'
import { ovalAngle, ovalPoint, DOCK_CENTER_X, DOCK_CENTER_Y } from './padNavpointMath3d'

/**
 * One navpoint UI unit as a share of the view height. The navpoint's units are those of a
 * 2160-unit screen, so `n` units are `n / 2160` of the height, in `cqh`.
 */
export const NAVPOINT_UI_HEIGHT = 2160
const cq = (uiUnits: number): string => `${(uiUnits * 100) / NAVPOINT_UI_HEIGHT}cqh`

/** The line from the icon down to the item: 1px wide, in the HUD's weapon ink. */
const LINE_WIDTH_PX = 1

/** The distance (world units) at which docked icons are placed in front of the camera. */
const DOCK_DISTANCE = 50

/**
 * The raised-icon offset above the anchor, in nvpt UI units (2160-unit screen).
 * Fitted to the in-game screenshot (F2): at 15-20 m the icon sits about 20-25 px
 * above the item at 720p, which is about 44 UI units (20-25 / 720 * 2160). The
 * game's line element is in the Template Navpoint, which is null in the pad nvpt tag.
 */
const ICON_OFFSET_UI = 44

/** One served frame of the navpoint's badge sprites (Go `NavpointSprite`). */
interface BadgeSprite {
  frame: number
  width: number
  height: number
  file: string
}

/**
 * The navpoint's hex badge (Go `NavpointBadge`, read from `nvpt` 259f5148 and its animations):
 * a filled hex, a hex outline and the item type's glyph; the arrow shows off screen only.
 */
interface NavpointBadge {
  fill: BadgeSprite
  outline: BadgeSprite
  glyphs: Record<string, BadgeSprite>
  arrow: BadgeSprite
}

/** The served pad-navpoint presentation (`padnavpoint.json`, the `nvpt` tag). */
interface NavpointStyle {
  iconWidth: number
  iconHeight: number
  iconAlpha: number
  /** The text group's offset (UI units, negative up): the name's center, from the icon's top edge. */
  timerOffsetY: number
  /** The distance number's font size. */
  timerSize: number
  /** The name's font size; absent from sets built before 2026-11-22. */
  nameTextSize?: number
  numericTimerSize: number
  numericTimerOffsetY: number
  badge?: NavpointBadge
}

/**
 * The navpoint's text sizes are font sizes; drawn, a size-32 line's capitals stand about 31 UI
 * units tall (Jordan's capture of 2026-11-22: 6 px of 418). Both faces' capitals are 0.7 em (their
 * OS/2 tables), so the em is the size times this factor (32 x 1.4 x 0.7 = 31). Inferred from that
 * one capture, not read from the game.
 */
const NAV_TEXT_EM_PER_SIZE = 1.4
/** The pitch of the name and distance lines, in ems: 46 UI units between their centers in the same capture. */
const NAV_TEXT_LINE_EM = 1.05
/** Halo world units to meters (1 u = 3.048 m, `replayScene3d`). */
const METERS_PER_UNIT = 3.048

/** The distance line for `units` world units: meters with one decimal and a unit, "53.8m". */
export function navpointDistanceText(units: number): string {
  return `${(units * METERS_PER_UNIT).toFixed(1)}m`
}

const HUD_SET = '/static/weapons-assets/halo_infinite/hud/'

/** The map spawner kinds whose navpoint shows the item's own icon (the "power" state). */
const ICON_SLOTS = new Set(['power', 'powerup', 'equipment'])

function isSprite(v: unknown): v is BadgeSprite {
  const s = v as BadgeSprite | null
  return !!s && typeof s.file === 'string' && s.file !== '' && s.width > 0 && s.height > 0
}

function badgeOf(v: unknown): NavpointBadge | undefined {
  const b = v as NavpointBadge | null
  if (!b || !isSprite(b.fill) || !isSprite(b.outline) || !isSprite(b.arrow) || !b.glyphs || !isSprite(b.glyphs.weapon)) return undefined
  return b
}

/** A layer of the marker drawn from one served sprite, centred on the marker. */
function spriteEl(s: BadgeSprite): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = `position:absolute;left:0;top:0;transform:translate(-50%,-50%);width:${cq(s.width)};height:${cq(s.height)};background:url("${HUD_SET}${s.file}") center / contain no-repeat;pointer-events:none;`
  return el
}

/** One marker: its projected element and the DOM the icon updates per frame. */
interface Marker {
  spot: PadSpot
  obj: CSS2DObject
  /** The icon image (its mode and orientation), or null when the pad has none (the marker is hidden). */
  icon: { url: string; mirrored: boolean } | null
  /** The icon box (raised above the anchor). */
  box: HTMLDivElement
  /** The line from the icon down to the anchor. */
  line: HTMLDivElement
  /** Whether the icon was docked last frame (to avoid redundant style writes). */
  wasDocked: boolean
  /** The oval parameter angle (radians) for docked markers, null when on screen. */
  dockAngle: number | null
  /** The screen direction (radians, y down) from the screen centre toward the item, when docked. */
  dockDir: number
  /** The off-screen arrow (the navpoint's rotated element), null without a served badge. */
  arrow: HTMLDivElement | null
  /** A power weapon's marker: the hex badge, at full size at any distance, with its distance line. */
  power: boolean
  /** The distance line of a power weapon's marker, and the text last written to it. */
  distance: HTMLDivElement | null
  distanceText: string
  /** Off screen with nowhere to dock (equipment): not drawn this frame. */
  hidden: boolean
  /** The icon's last written scale and line length (cqh), to skip redundant style writes. */
  scale: number
  lineCqh: number
  lineAngle: number
}

/** Scratch vectors for per-frame projection (avoids allocation). */
const _worldPos = new THREE.Vector3()
const _camPos = new THREE.Vector3()
const _dockedWorld = new THREE.Vector3()
const _anchor = new THREE.Vector3()

/**
 * The distance (u) inside which a pad icon draws at the navpoint's full size; farther, it shrinks
 * as the distance grows, down to ICON_MIN_SCALE. Not read from the game (the navpoint's "Scale Far
 * Override" is unset and its default is not decoded yet): Jordan judged the nearest pad's icon,
 * a few units away, the right size.
 */
const ICON_FULL_SIZE_DISTANCE = 3

/**
 * The icon's height above its pad: this many times the item's float height over the pad's feet,
 * and at least ICON_TOP_GAP (u) over the item's top. Inferred from Jordan's captures (2026-11-21):
 * the icon stays at one height whatever the item, just above the tallest ones.
 */
const ICON_HEIGHT_FACTOR = 1.5
const ICON_TOP_GAP = 0.05
const ICON_MIN_SCALE = 0.25

/** The layer of pad navpoint markers, one per pad the pickups layer draws. */
export class PadNavpoints3dLayer implements ActionLayer3d {
  private readonly ctx: ActionContext
  private readonly root: THREE.Object3D
  private readonly spots: readonly PadSpot[]
  private readonly markers: Marker[] = []
  private ready = false
  private shown = false
  private style: NavpointStyle | null = null

  constructor(ctx: ActionContext, pickups: Pickups3dLayer) {
    this.ctx = ctx
    this.root = ctx.root
    this.spots = pickups.spots
    void this.loadStyle()
  }

  /** loadStyle fetches the pad-navpoint presentation and builds the markers when it answers. */
  private async loadStyle(): Promise<void> {
    let style: NavpointStyle | null = null
    try {
      const res = await fetch('/static/weapons-assets/halo_infinite/hud/pad-navpoint.json')
      if (res.ok) {
        const data = (await res.json()) as NavpointStyle | null
        if (data && data.iconWidth > 0 && data.iconHeight > 0) style = { ...data, badge: badgeOf(data.badge) }
      }
    } catch {
      // The set may predate the navpoint asset: no markers, never an error.
    }
    if (!style) return
    this.style = style
    const titleSlug = this.ctx.doc.titleSlug ?? 'halo_infinite'
    for (const spot of this.spots) {
      // Only the pads (power weapon, powerup, equipment spawners) carry a navpoint; racks and loose
      // weapons have none.
      if (!ICON_SLOTS.has(spot.slot ?? '')) continue
      // A power weapon shows the hex badge with its name and distance, never its own icon.
      if (spot.slot === 'power' && style.badge) {
        this.markers.push(this.buildPower(spot, style, style.badge))
        continue
      }
      const icon = padIconRefFor(spot.pad.weapon, this.ctx.doc.weaponLabels, titleSlug)
      if (!icon) continue // no game icon for this item: the marker is not drawn, nothing is invented.
      this.markers.push(this.buildMarker(spot, icon, style))
    }
    this.ready = true
  }

  /** buildMarker makes one marker's element and its DOM (the icon, the line) once. */
  private buildMarker(spot: PadSpot, icon: { url: string; mirrored: boolean }, style: NavpointStyle): Marker {
    const point = document.createElement('div')
    point.style.cssText = 'width:0;height:0;'

    // The icon box, centred on the anchor. The CSS2DRenderer centres the element on the
    // projected point; we use the element's own layout to raise the icon and draw the line.
    const box = document.createElement('div')
    box.style.cssText = `position:absolute;left:0;top:0;transform:translate(-50%,-100%);width:${cq(style.iconWidth)};height:${cq(style.iconHeight)};opacity:${style.iconAlpha};font-family:${HUD_FONT_FAMILY};`

    // The icon: a mask filled with the HUD's weapon ink.
    const img = document.createElement('span')
    const mask = `url("${icon.url}") center / contain no-repeat`
    img.style.cssText = `display:block;width:100%;height:100%;background:var(--replay-hud-weapon,#c7ebfa);-webkit-mask:${mask};mask:${mask};${icon.mirrored ? 'transform:scaleX(-1);' : ''}`
    box.appendChild(img)

    // The line: a thin vertical strip from the icon's bottom edge down to the anchor.
    // Its height is the icon offset (the distance from the icon to the anchor).
    const line = document.createElement('div')
    line.style.cssText = `position:absolute;left:50%;top:100%;transform:translateX(-50%);transform-origin:50% 0;width:${LINE_WIDTH_PX}px;height:${cq(ICON_OFFSET_UI)};background:var(--replay-hud-weapon,#c7ebfa);opacity:0.7;pointer-events:none;`
    box.appendChild(line)

    point.appendChild(box)
    const arrow = this.style?.badge ? this.arrowEl(this.style.badge, point) : null
    const obj = new CSS2DObject(point)
    obj.visible = false
    this.root.add(obj)
    return { spot, obj, icon: { url: icon.url, mirrored: icon.mirrored }, box, line, wasDocked: false, dockAngle: null, dockDir: 0, arrow, power: false, distance: null, distanceText: '', hidden: false, scale: 1, lineCqh: -1, lineAngle: 0 }
  }

  /**
   * buildPower makes a power weapon's marker: in the icon's box, the filled hex, its outline and
   * the "weapon" glyph (draw order 0, 3, 5); above the box, the weapon's name and over it the
   * distance; below it, the line to the item.
   */
  private buildPower(spot: PadSpot, style: NavpointStyle, badge: NavpointBadge): Marker {
    const point = document.createElement('div')
    point.style.cssText = 'width:0;height:0;'
    const box = document.createElement('div')
    box.style.cssText = `position:absolute;left:0;top:0;transform:translate(-50%,-100%);width:${cq(style.iconWidth)};height:${cq(style.iconHeight)};pointer-events:none;`
    const hex = document.createElement('div')
    hex.style.cssText = 'position:absolute;left:50%;top:50%;width:0;height:0;'
    for (const s of [badge.fill, badge.outline, badge.glyphs.weapon]) hex.appendChild(spriteEl(s))
    box.appendChild(hex)

    // The text group: its first line (the name) centered `timerOffsetY` above the box's top edge,
    // the distance one line above it.
    const nameEm = (style.nameTextSize ?? style.timerSize) * NAV_TEXT_EM_PER_SIZE
    const distanceEm = style.timerSize * NAV_TEXT_EM_PER_SIZE
    const textLine = (font: string, em: number, lift: number): HTMLDivElement => {
      const el = document.createElement('div')
      el.style.cssText = `position:absolute;left:50%;top:${cq(style.timerOffsetY - lift)};transform:translate(-50%,-50%);white-space:nowrap;line-height:1;color:#fff;font:${font};font-size:${cq(em)};text-transform:uppercase;pointer-events:none;`
      box.appendChild(el)
      return el
    }
    const name = textLine(`600 1em Industry, ${HUD_FONT_FAMILY}`, nameEm, 0)
    name.textContent = padNameFor(spot.pad.weapon, this.ctx.doc.weaponLabels, REPLAY_TEXT.en, 'en').split(/\s*\/\s*/)[0]
    const distance = textLine(`italic 700 1em 'Normative Pro', ${HUD_FONT_FAMILY}`, distanceEm, NAV_TEXT_LINE_EM * nameEm)
    distance.style.textTransform = 'none'

    const line = document.createElement('div')
    line.style.cssText = `position:absolute;left:50%;top:100%;transform:translateX(-50%);transform-origin:50% 0;width:${LINE_WIDTH_PX}px;height:${cq(ICON_OFFSET_UI)};background:var(--replay-hud-weapon,#c7ebfa);opacity:0.7;pointer-events:none;`
    box.appendChild(line)

    point.appendChild(box)
    const arrow = this.arrowEl(badge, point)
    const obj = new CSS2DObject(point)
    obj.visible = false
    this.root.add(obj)
    return { spot, obj, icon: null, box, line, wasDocked: false, dockAngle: null, dockDir: 0, arrow, power: true, distance, distanceText: '', hidden: false, scale: 1, lineCqh: -1, lineAngle: 0 }
  }

  /** arrowEl adds the off-screen arrow to a marker, hidden until the marker docks. */
  private arrowEl(badge: NavpointBadge, point: HTMLDivElement): HTMLDivElement {
    const arrow = spriteEl(badge.arrow)
    arrow.style.display = 'none'
    point.appendChild(arrow)
    return arrow
  }

  /**
   * update places each marker at its pad's drawn point, once per frame.
   * When the item is off screen or behind the camera, the icon is docked on the oval.
   * Docked icons are spread along the oval so they do not pile up.
   */
  update(frame: number): void {
    const shown = this.ctx.inputs().show.weaponPads
    if (shown === this.shown && !this.ready) return
    this.shown = shown
    if (!this.ready || !shown || !this.style) {
      for (const m of this.markers) m.obj.visible = false
      return
    }
    const project = this.ctx.projectToScreen
    const screenToWorld = this.ctx.screenToWorld

    // First pass: project each marker and collect the docked ones with their angles.
    const dockedAngles: number[] = []
    const dockedIdx: number[] = []

    for (let i = 0; i < this.markers.length; i++) {
      const m = this.markers[i]
      padItemCenter(m.spot, frame, null, null, null, null, null, _worldPos)
      if (m.distance) this.writeDistance(m, _worldPos)

      if (!project || !screenToWorld) {
        m.obj.position.copy(_worldPos)
        m.dockAngle = null
        continue
      }

      const screen = project([_worldPos.x, _worldPos.y, _worldPos.z])
      const offScreen = !screen || screen[0] < -0.02 || screen[0] > 1.02 || screen[1] < -0.02 || screen[1] > 1.02
      // Only weapons dock at the screen's edge; an equipment item's navpoint is simply not drawn
      // off screen (Jordan, 2026-11-21).
      m.hidden = offScreen && m.spot.slot !== 'power'
      if (m.hidden) {
        m.dockAngle = null
        continue
      }
      if (!screen) {
        // Behind the camera: dock in the mirrored direction.
        this.ctx.cameraPosition?.(_camPos)
        const dx = _worldPos.x - _camPos.x
        const dy = _worldPos.y - _camPos.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > 0.001) {
          const angle = ovalAngle(dx / dist, -(dy / dist))
          m.dockAngle = angle
          m.dockDir = Math.atan2(-(dy / dist), dx / dist)
          dockedAngles.push(angle)
          dockedIdx.push(i)
        } else {
          m.dockAngle = null
        }
      } else if (screen[0] < -0.02 || screen[0] > 1.02 || screen[1] < -0.02 || screen[1] > 1.02) {
        // Off screen: dock on the oval in the item's direction from the oval centre.
        const dirX = screen[0] - DOCK_CENTER_X
        const dirY = screen[1] - DOCK_CENTER_Y
        const angle = ovalAngle(dirX, dirY)
        m.dockAngle = angle
        m.dockDir = Math.atan2(dirY, dirX)
        dockedAngles.push(angle)
        dockedIdx.push(i)
      } else {
        m.dockAngle = null
        this.placeRaised(m, _worldPos, project)
      }
    }

    // Second pass: place the docked markers on the oval, each in its item's direction. The game
    // stacks them there (Jordan's capture of 2026-11-21 on Aimbotz: pad badges overlap at the upper
    // left and right); nothing in its data spreads them apart.
    if (dockedAngles.length > 0 && screenToWorld) {
      for (let k = 0; k < dockedIdx.length; k++) {
        const m = this.markers[dockedIdx[k]]
        const [ox, oy] = ovalPoint(dockedAngles[k])
        screenToWorld(ox, oy, DOCK_DISTANCE, _dockedWorld)
        m.obj.position.copy(_dockedWorld)
      }
    }

    // Third pass: toggle lines and arrows, set visibility.
    for (const m of this.markers) {
      if (m.hidden) {
        m.obj.visible = false
        continue
      }
      const docked = m.dockAngle !== null
      if (docked && m.scale !== 1) this.setIconScale(m, 1)
      if (docked !== m.wasDocked) {
        m.line.style.display = docked ? 'none' : ''
        if (m.arrow) m.arrow.style.display = docked ? '' : 'none'
        m.wasDocked = docked
      }
      // The arrow's frame points down (+y on screen): turn it toward the item.
      if (docked && m.arrow) m.arrow.style.transform = `translate(-50%,-50%) rotate(${m.dockDir - Math.PI / 2}rad)`
      m.obj.visible = true
    }
  }

  /**
   * placeRaised places an on-screen pad icon: at a point above its pad, twice the item's float
   * height over the pad's feet (inferred from Jordan's captures of 2026-11-21: the icon stays at
   * one height whatever the item, and the line takes up the difference), shrunk with its distance
   * from the camera, its line running from the icon's bottom down to the top of the item.
   */
  private placeRaised(m: Marker, center: THREE.Vector3, project: NonNullable<ActionContext['projectToScreen']>): void {
    const feetY = m.spot.feet.y
    const top = m.spot.last?.top ?? center.y
    _anchor.set(center.x, Math.max(top + ICON_TOP_GAP, feetY + ICON_HEIGHT_FACTOR * (center.y - feetY)), center.z)
    m.obj.position.copy(_anchor)
    // An item's icon shrinks with its distance; a power weapon's hex stays at the navpoint's size
    // (Jordan's capture of 2026-11-22: 100 UI units tall at 53.8 m).
    if (!m.power) {
      this.ctx.cameraPosition?.(_camPos)
      const distance = _camPos.distanceTo(_anchor)
      this.setIconScale(m, Math.max(ICON_MIN_SCALE, Math.min(1, ICON_FULL_SIZE_DISTANCE / Math.max(distance, 1e-3))))
    }
    // The line runs from the icon's bottom center to the item's top as projected: with the camera
    // pitched, that point is not straight below the icon.
    const a = project([_anchor.x, _anchor.y, _anchor.z])
    const t = project([center.x, top, center.z])
    const host = m.obj.element.parentElement
    const aspect = host && host.clientHeight > 0 ? host.clientWidth / host.clientHeight : 16 / 9
    let dx = 0
    let dy = 0
    if (a && t) {
      dx = (t[0] - a[0]) * 100 * aspect
      dy = (t[1] - a[1]) * 100
    }
    const lineCqh = Math.hypot(dx, dy)
    const angle = Math.atan2(-dx, dy)
    if (Math.abs(lineCqh - m.lineCqh) > 0.05 || Math.abs(angle - m.lineAngle) > 0.005) {
      m.line.style.height = `${lineCqh.toFixed(2)}cqh`
      m.line.style.transform = `translateX(-50%) rotate(${angle.toFixed(4)}rad)`
      m.lineCqh = lineCqh
      m.lineAngle = angle
    }
  }

  /**
   * writeDistance writes a power weapon's distance from the camera to its item, in meters with one
   * decimal ("53.8m"), when it changed. The camera stands in for the player's eye (inferred: the
   * game measures from the player).
   */
  private writeDistance(m: Marker, item: THREE.Vector3): void {
    if (!m.distance || !this.ctx.cameraPosition) return
    this.ctx.cameraPosition(_camPos)
    const text = navpointDistanceText(_camPos.distanceTo(item))
    if (text !== m.distanceText) {
      m.distance.textContent = text
      m.distanceText = text
    }
  }

  /** setIconScale sizes the icon box at `scale` times the navpoint's icon size. */
  private setIconScale(m: Marker, scale: number): void {
    if (!this.style || Math.abs(scale - m.scale) < 0.01) return
    m.box.style.width = cq(this.style.iconWidth * scale)
    m.box.style.height = cq(this.style.iconHeight * scale)
    m.scale = scale
  }

  dispose(): void {
    for (const m of this.markers) {
      m.obj.element.remove()
      m.obj.removeFromParent()
    }
    this.markers.length = 0
  }
}
