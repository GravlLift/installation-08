/**
 * flagBanner3d.ts — THE CTF FLAG DRESSED WITH ITS TEAM BANNER (`flagBanner3dModel`).
 *
 * A dressed flag is a copy of the flag model with the banner's quads as children, at the marker
 * of the team effects: the cloth (alpha blended, the effect's constant opacity) and the team's
 * emblem (additive, its own opacity). Both are unlit (the game's particles carry their own light),
 * double-sided and do not write depth. Static: the first image of the cloth sheet, no flutter.
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

export class FlagBanners {
  private readonly table: IndexField<BannerTable>
  private readonly base: string
  private readonly dressedByTeam = new Map<string, { model: THREE.Object3D; dressed: THREE.Object3D }>()
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
   * of no team), or `model` itself while the index is not read or when the weapon has no banner.
   */
  dress(model: THREE.Object3D, key: string, team: number | null): THREE.Object3D {
    const banner = this.table.get()?.[key]
    if (!banner) return model
    const id = `${key}:${team ?? 'none'}`
    const known = this.dressedByTeam.get(id)
    if (known?.model === model) return known.dressed
    const dressed = model.clone()
    dressed.add(this.bannerOf(banner, team))
    this.dressedByTeam.set(id, { model, dressed })
    return dressed
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

  private bannerOf(banner: FlagBanner, team: number | null): THREE.Group {
    const g = new THREE.Group()
    g.name = 'team-banner'
    g.add(this.quad(banner, banner.cloth, banner.cloth.files[0], 0))
    const emblem = emblemFileOf(banner.emblem, team)
    if (banner.emblem && emblem) g.add(this.quad(banner, banner.emblem, emblem, 1))
    return g
  }

  /** quad — one layer's quad: unit plane scaled to the layer, its +X along `across`, +Y up. */
  private quad(banner: FlagBanner, layer: BannerLayer, file: string, order: number): THREE.Mesh {
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
