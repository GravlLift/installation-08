// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * padNavpointMarkers3d.ts — THE GAME'S PAD NAVPOINTS IN THE 3D SCENE, one marker per pad.
 *
 * The game marks every weapon pad with a small icon and, while the pad is empty, a numeric
 * countdown to the weapon's return. This layer draws the same markers in the 3D view: one
 * `CSS2DObject` per pad, projected by the scene's label renderer (`CSS2DRenderer`) to the
 * pad's screen point and moved imperatively each frame, the way the name tags are.
 *
 * THE PAD, THE ANCHOR AND THE TIMER ARE THE 3D PICKUPS LAYER'S OWN. The markers anchor on the
 * spot the pickups layer drew (`spot.last.pos`), not on the pad's base: a full pad's item floats
 * and turns above the kit, so the icon rides with it (`padItemCenter`, shared with `paintPads`).
 * A pad the layer does not draw (empty, or its model not loaded) anchors on the kit itself
 * (`spot.feet`). The pad's state and countdown come from the same pure rule as 2D
 * (`navpointStateAt`).
 *
 * THE SIZES ARE THE GAME'S, FROM THE `nvpt` NAVPOINT TAG (`padnavpoint.json`): the icon's
 * width and height, its alpha, and the numeric timer's size and offset. Those values are UI
 * units of the game's 1080p HUD, not CSS pixels: they are scaled to the view through `cqh`
 * (the container-query height, 1cqh = 1% of the view height), the same reference the 3D HUD
 * uses, so the icon keeps its share of the screen the way the game does. The timer text is set
 * in the HUD's own face (`hudFonts`), not the page font.
 *
 * THE COLOR IS NOT INVENTED: the tag names the icon's color symbolically (`item_power`,
 * `powerColor`), and no table in the build resolves that symbol to an RGB. The icon therefore
 * draws untinted, and the timer in the HUD's neutral on-dark text, never a guessed tint.
 */
import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

import type { ActionContext, ActionLayer3d } from './actionScene3d'
import type { PadSpot } from './pickups3d'
import type { Pickups3dLayer } from './pickups3d'
import { navpointStateAt } from './padNavpoint3d'
import { padIconRefFor } from '../layers/useReplayWeaponPads'
import { HUD_FONT_FAMILY } from '../ui/hudFonts'
import { frameToMs } from '@/lib/replay/replayLogic'

/**
 * One UI unit of the game's 1080p HUD, as a share of the view height: the HUD is 1080 UI units
 * tall, so `n` units are `n / 1080` of the height, expressed in `cqh` (1cqh = 1% of the height).
 */
const cq = (uiUnits: number): string => `${uiUnits / 10.8}cqh`

/** The served pad-navpoint presentation (`padnavpoint.json`, the `nvpt` tag). */
interface NavpointStyle {
  iconWidth: number
  iconHeight: number
  iconAlpha: number
  numericTimerSize: number
  numericTimerOffsetY: number
}

/** One marker: its projected element and the DOM the timer and the icon update per frame. */
interface Marker {
  spot: PadSpot
  obj: CSS2DObject
  /** The icon image (its mode and orientation), or null when the pad has none (the marker is hidden). */
  icon: { url: string; mirrored: boolean } | null
  timer: HTMLSpanElement
  timerText: string
  timerShown: boolean
}

/** The layer of pad navpoint markers, one per pad the pickups layer draws. */
export class PadNavpoints3dLayer implements ActionLayer3d {
  private readonly ctx: ActionContext
  private readonly root: THREE.Object3D
  private readonly spots: readonly PadSpot[]
  private readonly markers: Marker[] = []
  private readonly frameMs: number
  private ready = false
  private shown = false

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
        if (data && data.iconWidth > 0 && data.iconHeight > 0 && data.numericTimerSize > 0) style = data
      }
    } catch {
      // The set may predate the navpoint asset: no markers, never an error.
    }
    if (!style) return
    const titleSlug = this.ctx.doc.titleSlug ?? 'halo_infinite'
    for (const spot of this.spots) {
      const icon = padIconRefFor(spot.pad.weapon, this.ctx.doc.weaponLabels, titleSlug)
      if (!icon) continue // no game icon for this item: the marker is not drawn, nothing is invented.
      this.markers.push(this.buildMarker(spot, icon, style))
    }
    this.ready = true
  }

  /** buildMarker makes one marker's element and its DOM (the icon, the timer) once. */
  private buildMarker(spot: PadSpot, icon: { url: string; mirrored: boolean }, style: NavpointStyle): Marker {
    const point = document.createElement('div')
    point.style.cssText = 'width:0;height:0;'
    // The icon box, raised so its bottom sits on the anchor point (the item's center): the icon
    // floats above the item, as in the game.
    const box = document.createElement('div')
    box.style.cssText = `position:absolute;bottom:0;left:-50%;width:${cq(style.iconWidth)};height:${cq(style.iconHeight)};opacity:${style.iconAlpha};font-family:${HUD_FONT_FAMILY};`
    const img = document.createElement('img')
    img.alt = ''
    img.src = icon.url
    img.style.cssText = `width:100%;height:100%;object-fit:contain;${icon.mirrored ? 'transform:scaleX(-1);' : ''}`
    box.appendChild(img)
    const timer = document.createElement('span')
    timer.style.cssText = `position:absolute;left:50%;top:calc(50% + ${cq(style.numericTimerOffsetY)});transform:translateX(-50%);font-size:${cq(style.numericTimerSize)};font-weight:700;line-height:1;font-variant-numeric:tabular-nums;color:var(--replay-hud-on-dark,#fff);text-shadow:0 1px 2px var(--replay-hud-shadow,rgba(0,0,0,0.7));pointer-events:none;`
    box.appendChild(timer)
    point.appendChild(box)
    const obj = new CSS2DObject(point)
    obj.visible = false
    this.root.add(obj)
    return { spot, obj, icon: { url: icon.url, mirrored: icon.mirrored }, timer, timerText: '', timerShown: false }
  }

  /** update places each marker at its pad's drawn point and refreshes its timer, once per frame. */
  update(frame: number): void {
    const shown = this.ctx.inputs().show.weaponPads
    if (shown === this.shown && !this.ready) return
    this.shown = shown
    if (!this.ready || !shown) {
      for (const m of this.markers) m.obj.visible = false
      return
    }
    for (const m of this.markers) {
      // The anchor: where the pickups layer drew this pad's item this frame, else the kit itself.
      const anchor = m.spot.last?.pos ?? m.spot.feet
      m.obj.position.copy(anchor)
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
