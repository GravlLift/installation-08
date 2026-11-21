// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * padNavpointMarkers3d.ts — THE GAME'S PAD NAVPOINTS IN THE 3D SCENE, one marker per pad.
 *
 * The game marks every weapon pad with a small icon and, while the pad is empty, a numeric
 * countdown to the weapon's return. This layer draws the same markers in the 3D view: one
 * `CSS2DObject` per pad, positioned imperatively each frame.
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
 * width and height, its alpha, and the numeric timer's size and offset, in the game's UI units,
 * scaled to the view through `cqh` (1cqh = 1% of the view height).
 *
 * THE COLOR is the 3D HUD's weapon ink (`--replay-hud-weapon`): the icon is a mask filled with
 * it, as `WeaponIcon` tints its icons.
 */
import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

import type { ActionContext, ActionLayer3d } from './actionScene3d'
import { padItemCenter, type PadSpot, type Pickups3dLayer } from './pickups3d'
import { navpointStateAt } from './padNavpoint3d'
import { padIconRefFor } from '../layers/useReplayWeaponPads'
import { HUD_FONT_FAMILY } from '../ui/hudFonts'
import { frameToMs } from '@/lib/replay/replayLogic'
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
  numericTimerSize: number
  numericTimerOffsetY: number
  badge?: NavpointBadge
}

const HUD_SET = '/static/weapons-assets/halo_infinite/hud/'

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

/** One marker: its projected element and the DOM the timer and the icon update per frame. */
interface Marker {
  spot: PadSpot
  obj: CSS2DObject
  /** The icon image (its mode and orientation), or null when the pad has none (the marker is hidden). */
  icon: { url: string; mirrored: boolean } | null
  /** The icon box (raised above the anchor). */
  box: HTMLDivElement
  /** The line from the icon down to the anchor. */
  line: HTMLDivElement
  timer: HTMLSpanElement
  timerText: string
  timerShown: boolean
  /** Whether the icon was docked last frame (to avoid redundant style writes). */
  wasDocked: boolean
  /** The oval parameter angle (radians) for docked markers, null when on screen. */
  dockAngle: number | null
  /** The screen direction (radians, y down) from the screen centre toward the item, when docked. */
  dockDir: number
  /** The off-screen arrow (the navpoint's rotated element), null without a served badge. */
  arrow: HTMLDivElement | null
  /** A rack weapon's marker: the hex badge alone, at the item, without the raised icon or line. */
  badge: boolean
}

/** Scratch vectors for per-frame projection (avoids allocation). */
const _worldPos = new THREE.Vector3()
const _camPos = new THREE.Vector3()
const _dockedWorld = new THREE.Vector3()

/** The layer of pad navpoint markers, one per pad the pickups layer draws. */
export class PadNavpoints3dLayer implements ActionLayer3d {
  private readonly ctx: ActionContext
  private readonly root: THREE.Object3D
  private readonly spots: readonly PadSpot[]
  private readonly markers: Marker[] = []
  private readonly frameMs: number
  private ready = false
  private shown = false
  private style: NavpointStyle | null = null

  constructor(ctx: ActionContext, pickups: Pickups3dLayer) {
    this.ctx = ctx
    this.root = ctx.root
    this.spots = pickups.spots
    this.frameMs = frameToMs(1, ctx.doc)
    void this.loadStyle()
  }

  /** loadStyle fetches the pad-navpoint presentation and builds the markers when it answers. */
  private async loadStyle(): Promise<void> {
    let style: NavpointStyle | null = null
    try {
      const res = await fetch('/static/weapons-assets/halo_infinite/hud/pad-navpoint.json')
      if (res.ok) {
        const data = (await res.json()) as NavpointStyle | null
        if (data && data.iconWidth > 0 && data.iconHeight > 0 && data.numericTimerSize > 0) style = { ...data, badge: badgeOf(data.badge) }
      }
    } catch {
      // The set may predate the navpoint asset: no markers, never an error.
    }
    if (!style) return
    this.style = style
    const titleSlug = this.ctx.doc.titleSlug ?? 'halo_infinite'
    for (const spot of this.spots) {
      // A rack weapon shows the navpoint's badge state (3d319069): the item's icon faded out, the
      // hex outline in, the "weapon" glyph.
      if ((spot.rack || spot.mounted) && style.badge) {
        this.markers.push(this.buildBadge(spot, style.badge))
        continue
      }
      const icon = padIconRefFor(spot.pad.weapon, this.ctx.doc.weaponLabels, titleSlug)
      if (!icon) continue // no game icon for this item: the marker is not drawn, nothing is invented.
      this.markers.push(this.buildMarker(spot, icon, style))
    }
    this.ready = true
  }

  /** buildMarker makes one marker's element and its DOM (the icon, the line, the timer) once. */
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
    line.style.cssText = `position:absolute;left:50%;top:100%;transform:translateX(-50%);width:${LINE_WIDTH_PX}px;height:${cq(ICON_OFFSET_UI)};background:var(--replay-hud-weapon,#c7ebfa);opacity:0.7;pointer-events:none;`
    box.appendChild(line)

    // The timer: below the line, at the game's offset from the anchor.
    const timer = document.createElement('span')
    timer.style.cssText = `position:absolute;left:50%;top:calc(100% + ${cq(ICON_OFFSET_UI)});transform:translateX(-50%);font-size:${cq(style.numericTimerSize)};font-weight:700;line-height:1;font-variant-numeric:tabular-nums;color:var(--replay-hud-weapon,#c7ebfa);text-shadow:0 1px 2px var(--replay-hud-shadow,rgba(0,0,0,0.7));pointer-events:none;white-space:nowrap;`
    box.appendChild(timer)

    point.appendChild(box)
    const arrow = this.style?.badge ? this.arrowEl(this.style.badge, point) : null
    const obj = new CSS2DObject(point)
    obj.visible = false
    this.root.add(obj)
    return { spot, obj, icon: { url: icon.url, mirrored: icon.mirrored }, box, line, timer, timerText: '', timerShown: false, wasDocked: false, dockAngle: null, dockDir: 0, arrow, badge: false }
  }

  /** arrowEl adds the off-screen arrow to a marker, hidden until the marker docks. */
  private arrowEl(badge: NavpointBadge, point: HTMLDivElement): HTMLDivElement {
    const arrow = spriteEl(badge.arrow)
    arrow.style.display = 'none'
    point.appendChild(arrow)
    return arrow
  }

  /** buildBadge makes a rack weapon's marker: the filled hex, the outline, the weapon glyph. */
  private buildBadge(spot: PadSpot, badge: NavpointBadge): Marker {
    const point = document.createElement('div')
    point.style.cssText = 'width:0;height:0;'
    const box = document.createElement('div')
    box.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;'
    // Draw order: fill (0), outline (3), glyph (5).
    for (const s of [badge.fill, badge.outline, badge.glyphs.weapon]) box.appendChild(spriteEl(s))
    point.appendChild(box)
    const arrow = this.arrowEl(badge, point)
    const line = document.createElement('div')
    const timer = document.createElement('span')
    const obj = new CSS2DObject(point)
    obj.visible = false
    this.root.add(obj)
    return { spot, obj, icon: null, box, line, timer, timerText: '', timerShown: false, wasDocked: false, dockAngle: null, dockDir: 0, arrow, badge: true }
  }

  /**
   * update places each marker at its pad's drawn point and refreshes its timer, once per frame.
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

      if (!project || !screenToWorld) {
        m.obj.position.copy(_worldPos)
        m.dockAngle = null
        continue
      }

      const screen = project([_worldPos.x, _worldPos.y, _worldPos.z])
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
        // On screen: the CSS2DRenderer projects the world position.
        m.obj.position.copy(_worldPos)
        m.dockAngle = null
      }
    }

    // Second pass: place the docked markers on the oval, each in its item's direction. The game
    // stacks them there (Jordan's capture of 2026-11-21: rack badges overlap at the upper left and
    // right); nothing in its data spreads them apart.
    if (dockedAngles.length > 0 && screenToWorld) {
      for (let k = 0; k < dockedIdx.length; k++) {
        const m = this.markers[dockedIdx[k]]
        const [ox, oy] = ovalPoint(dockedAngles[k])
        screenToWorld(ox, oy, DOCK_DISTANCE, _dockedWorld)
        m.obj.position.copy(_dockedWorld)
      }
    }

    // Third pass: toggle lines, update timers, set visibility.
    for (const m of this.markers) {
      const docked = m.dockAngle !== null
      if (docked !== m.wasDocked) {
        if (!m.badge) m.line.style.display = docked ? 'none' : ''
        if (m.arrow) m.arrow.style.display = docked ? '' : 'none'
        m.wasDocked = docked
      }
      // The arrow's frame points down (+y on screen): turn it toward the item.
      if (docked && m.arrow) m.arrow.style.transform = `translate(-50%,-50%) rotate(${m.dockDir - Math.PI / 2}rad)`
      if (m.badge) {
        m.obj.visible = true
        continue
      }

      const reading = navpointStateAt(m.spot.pad, frame, this.frameMs)
      const text = reading.seconds != null ? String(Math.ceil(reading.seconds)) : ''
      if (text !== m.timerText) {
        m.timer.textContent = text
        m.timerText = text
      }
      const timerShown = text !== ''
      if (timerShown !== m.timerShown) {
        m.timer.style.display = timerShown ? '' : 'none'
        m.timerShown = timerShown
      }
      m.obj.visible = true
    }
  }

  dispose(): void {
    for (const m of this.markers) {
      m.obj.element.remove()
      m.obj.removeFromParent()
    }
    this.markers.length = 0
  }
}
