/**
 * ktx2Textures3d.ts — GPU-compressed textures (KTX2, `KHR_texture_basisu`) in the map and Forge
 * variant GLBs.
 *
 * One `KTX2Loader` per renderer (`createKtx2Loader`, owned and released by the scene): it asks the
 * renderer which compressed formats the GPU takes, and its workers transcode each Basis texture to
 * one of them (BC7 / BC1 / BC3 on a desktop GPU). The Basis transcoder (three's
 * `examples/jsm/libs/basis`) is served by the app itself, never a CDN: the Vite plugin in
 * `vite.config.ts` serves it in development and writes it into the build's `assets/` folder, which
 * `tools/package.ps1` stages into the release.
 *
 * A GLB whose images are PNG loads as before: the KTX2 loader is only asked for an image that
 * declares `KHR_texture_basisu`.
 */
import * as THREE from 'three'
import type { GLTFLoader, GLTFLoaderPlugin, GLTFParser } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'

import { withMeshopt } from './meshoptGeometry3d'
import { measureSince, now } from './perf3d'

/** The folder that serves the Basis transcoder: the build's own assets, at the app's base URL. */
export const BASIS_TRANSCODER_PATH = `${import.meta.env.BASE_URL}assets/`

/** The two files `KTX2Loader` fetches from `BASIS_TRANSCODER_PATH` (see vite.config.ts). */
export const BASIS_TRANSCODER_FILES = ['basis_transcoder.js', 'basis_transcoder.wasm'] as const

/** What `KTX2Loader.detectSupport` reads from a WebGL renderer. */
export type Ktx2Renderer = Pick<THREE.WebGLRenderer, 'extensions'>

/** createKtx2Loader builds the loader of one renderer, its formats chosen for that renderer's GPU. */
export function createKtx2Loader(renderer: Ktx2Renderer): KTX2Loader {
  return new KTX2Loader().setTranscoderPath(BASIS_TRANSCODER_PATH).detectSupport(renderer as THREE.WebGLRenderer)
}

const MIPMAP_FILTERS = new Set<THREE.TextureFilter>([
  THREE.NearestMipmapNearestFilter, THREE.NearestMipmapLinearFilter, THREE.LinearMipmapNearestFilter, THREE.LinearMipmapLinearFilter,
])

/**
 * completeMips keeps a compressed texture without a mip chain drawable: GLTFLoader gives every
 * texture the sampler's filter (a mipmapped one by default), and a compressed texture cannot have
 * its levels generated, so a single-level one would sample black. It then reads its one level.
 */
export function completeMips(texture: THREE.Texture): void {
  if (!(texture as THREE.CompressedTexture).isCompressedTexture) return
  if ((texture.mipmaps?.length ?? 0) > 1 || !MIPMAP_FILTERS.has(texture.minFilter)) return
  const nearest = texture.minFilter === THREE.NearestMipmapNearestFilter || texture.minFilter === THREE.NearestMipmapLinearFilter
  texture.minFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter
}

/**
 * CompressedMips: the GLTFLoader plugin that runs `completeMips` on every texture the parser makes.
 * `loadTextureImage` is the parser step every glTF texture goes through, KTX2 or not; it applies the
 * sampler last, so the check wraps it (it resolves null for an image that failed to load).
 */
class CompressedMips implements GLTFLoaderPlugin {
  readonly name = 'IT3D_compressed_mips'
  private readonly parser: GLTFParser
  constructor(parser: GLTFParser) {
    this.parser = parser
  }

  beforeRoot(): null {
    const parser = this.parser
    const load = parser.loadTextureImage.bind(parser)
    parser.loadTextureImage = (textureIndex, sourceIndex, loader) => load(textureIndex, sourceIndex, loader).then((t) => {
      if (t) completeMips(t)
      return t
    })
    return null
  }
}

/** The part of a loader GLTFLoader calls for an image (`loadImageSource`). */
type ImageLoader = Pick<KTX2Loader, 'load'>

/**
 * countedBy hands `ktx2`'s images to GLTFLoader counted by `manager` from request to transcoded
 * texture, as the PNG images are counted (the loading bar's `materials` step). The shared loader
 * keeps its own manager: the map and the variant layer each count their own images.
 */
function countedBy(ktx2: KTX2Loader, manager: THREE.LoadingManager): ImageLoader {
  return {
    load(url, onLoad, onProgress, onError) {
      manager.itemStart(url)
      const start = now()
      ktx2.load(url, (texture) => {
        measureSince('ktx2', start)
        manager.itemEnd(url)
        onLoad(texture)
      }, onProgress, (err) => {
        manager.itemError(url)
        manager.itemEnd(url)
        onError?.(err)
      })
    },
  }
}

/**
 * withKtx2 lets `loader` read compressed geometry (`withMeshopt`) and KTX2 images through `ktx2` (the renderer's loader, `createKtx2Loader`),
 * counted by `loader`'s manager. Without one, the GLB loads as before (an image that only exists as
 * KTX2 then has no texture). Returns `loader`.
 */
export function withKtx2(loader: GLTFLoader, ktx2: KTX2Loader | null): GLTFLoader {
  // The same GLBs carry compressed geometry (build format 3): every caller reads it.
  withMeshopt(loader)
  if (!ktx2) return loader
  // GLTFLoader only calls `load` on it (GLTFParser.loadImageSource).
  return loader.setKTX2Loader(countedBy(ktx2, loader.manager) as KTX2Loader).register((parser) => new CompressedMips(parser))
}

/**
 * releaseTexels drops the CPU copy of a compressed texture's levels (the copy three keeps to upload
 * it), once it is on the GPU elsewhere (a merged texture array) and no material reads the texture.
 */
export function releaseTexels(texture: THREE.Texture): void {
  if ((texture as THREE.CompressedTexture).isCompressedTexture) texture.mipmaps = []
}
