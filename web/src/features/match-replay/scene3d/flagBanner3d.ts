// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * flagBanner3d.ts — THE CTF FLAG DRESSED WITH ITS TEAM BANNER (`flagBanner3dModel`).
 *
 * A dressed flag is a copy of the flag model with the banner's quads as children, at the marker
 * of the team effects: the cloth (alpha blended, the effect's constant opacity) and the team's
 * emblem (additive, its own opacity). Both are unlit (the game's particles carry their own light),
 * double-sided and do not write depth. Static: the first image of the cloth sheet, no flutter.
 *
 * Color: the effect's color is a white constant; the team color is applied at runtime. The cloth
 * takes the ink the caller gives for the flag's team (the side ink of the followed point of view,
 * so the allied flag shows the allied color); a flag of no team keeps the effect's white. The
 * emblem stays white and additive, so it reads as a lighter shape over the tinted cloth.
 *
 * One dressed copy per (flag, team), built once the index and the model are loaded; until then
 * (and for a weapon without a banner) the bare model is used. The copies share the model's
 * geometries and materials; the banner's own are released by `dispose`.
 */
import * as THREE from 'three'

import {
  BANNER_UP,
  emblemFileOf,
  parseBanners,
  quadCenter,
  type BannerLayer,
  type BannerTable,
  type FlagBanner,
} from './flagBanner3dModel'
import { IndexField, type FetchJson } from './indexField3d'
import { sideInkOf } from './objectives3dModel'
import type { Action3dInputs } from './action3dInputs'
import type { InkCache } from './actionKit'

/** The effect's own color, a white constant (three's default color). */
const EFFECT_WHITE = new THREE.Color()

/**
 * flagBannerInk — the ink of the banner of a flag of team `team`: the side ink of that team from
 * the followed point of view (`sideInkOf`, the objectives' own rule, so it follows the user's
 * side colors), null for a flag of no team or a team the point of view does not place.
 */
export function flagBannerInk(
  inputs: Pick<Action3dInputs, 'allegiance' | 'inks'>,
  team: number,
  ink: Pick<InkCache, 'of'>,
): THREE.Color | null {
  const css = sideInkOf(inputs.allegiance, inputs.inks.teamColorOf)(team)
  return css === null ? null : ink.of(css)
}

export class FlagBanners {
  private readonly table: IndexField<BannerTable>
  private readonly base: string
  private readonly dressedByTeam = new Map<string, { model: THREE.Object3D; dressed: THREE.Object3D; cloth: THREE.MeshBasicMaterial }>()
  private readonly textures = new Map<string, THREE.Texture>()
  private readonly geometry = new THREE.PlaneGeometry(1, 1)
  private readonly materials: THREE.Material[] = []

  /** `base`: the served folder of the weapon library (its index, its models and banner images). */
  constructor(base: string, fetchJson?: FetchJson) {
    this.base = base
    this.table = new IndexField(base, parseBanners, fetchJson)
  }

  /**
   * dress — the flag model `model` (weapon key `key`) with the banner of team `team` (null: a flag
   * of no team), its cloth tinted `ink` (null: the effect's white); `model` itself while the index
   * is not read or when the weapon has no banner. All copies of one team share the cloth's tint.
   */
  dress(model: THREE.Object3D, key: string, team: number | null, ink: THREE.Color | null): THREE.Object3D {
    const banner = this.table.get()?.[key]
    if (!banner) return model
    const id = `${key}:${team ?? 'none'}`
    let entry = this.dressedByTeam.get(id)
    if (entry?.model !== model) {
      const dressed = model.clone()
      const { group, cloth } = this.bannerOf(banner, team)
      dressed.add(group)
      entry = { model, dressed, cloth }
      this.dressedByTeam.set(id, entry)
    }
    entry.cloth.color.copy(ink ?? EFFECT_WHITE)
    return entry.dressed
  }

  dispose(): void {
    this.table.dispose()
    this.geometry.dispose()
    for (const m of this.materials) m.dispose()
    for (const t of this.textures.values()) t.dispose()
    this.materials.length = 0
    this.textures.clear()
    this.dressedByTeam.clear()
  }

  private bannerOf(banner: FlagBanner, team: number | null): { group: THREE.Group; cloth: THREE.MeshBasicMaterial } {
    const group = new THREE.Group()
    group.name = 'team-banner'
    const cloth = this.quad(banner, banner.cloth, banner.cloth.files[0], 0)
    group.add(cloth)
    const emblem = emblemFileOf(banner.emblem, team)
    if (banner.emblem && emblem) group.add(this.quad(banner, banner.emblem, emblem, 1))
    return { group, cloth: cloth.material }
  }

  /** quad — one layer's quad: unit plane scaled to the layer, its +X along `across`, +Y up. */
  private quad(banner: FlagBanner, layer: BannerLayer, file: string, order: number): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
    const material = new THREE.MeshBasicMaterial({
      map: this.texture(file),
      transparent: true,
      opacity: layer.alpha,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: layer.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
    this.materials.push(material)
    const mesh = new THREE.Mesh(this.geometry, material)
    const across = new THREE.Vector3(...layer.across)
    const up = new THREE.Vector3(...BANNER_UP)
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, up, new THREE.Vector3().crossVectors(across, up)))
    mesh.position.set(...quadCenter(banner.marker, layer))
    mesh.scale.set(layer.width, layer.height, 1)
    mesh.renderOrder = order
    mesh.castShadow = false
    mesh.receiveShadow = false
    return mesh
  }

  private texture(file: string): THREE.Texture {
    let t = this.textures.get(file)
    if (!t) {
      t = new THREE.TextureLoader().load(`${this.base}/${file}`, undefined, undefined, (err) => {
        console.warn('replay 3D: banner image unavailable', file, err)
      })
      t.colorSpace = THREE.SRGBColorSpace
      this.textures.set(file, t)
    }
    return t
  }
}
