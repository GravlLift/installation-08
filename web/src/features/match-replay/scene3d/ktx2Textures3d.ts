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

/** The loader GLTFLoader is handed for KTX2 images: `load` for an image behind a URL (what
 *  GLTFLoader calls), `parseBytes` for one embedded in the GLB (what `DirectKtx2Images` calls). */
interface ImageLoader extends Pick<KTX2Loader, 'load'> {
  parseBytes(bytes: ArrayBuffer): Promise<THREE.CompressedTexture>
}

/**
 * countedBy hands `ktx2`'s images to GLTFLoader counted by `manager` from request to transcoded
 * texture, as the PNG images are counted (the loading bar's `materials` step). The shared loader
 * keeps its own manager: the map and the variant layer each count their own images.
 */
function countedBy(ktx2: KTX2Loader, manager: THREE.LoadingManager): ImageLoader {
  let embedded = 0
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
    parseBytes(bytes) {
      const item = `ktx2-embedded:${embedded++}`
      manager.itemStart(item)
      const start = now()
      return new Promise<THREE.CompressedTexture>((resolve, reject) => {
        ktx2.parse(bytes, (texture) => {
          measureSince('ktx2', start)
          manager.itemEnd(item)
          resolve(texture as THREE.CompressedTexture)
        }, (err: unknown) => {
          manager.itemError(item)
          manager.itemEnd(item)
          reject(err)
        })
      })
    },
  }
}

/**
 * DirectKtx2Images: the GLTFLoader plugin that hands each KTX2 image embedded in the GLB (an image
 * read from a buffer view) to the KTX2 loader as its bytes. GLTFLoader's own path copies the bytes
 * into a Blob, makes an object URL and has the loader fetch it back: thousands of blobs at once on
 * a large map (Streets High: 2349 images, 803 MB), past the browser's blob storage limit when it
 * cannot page blobs to disk (`net::ERR_BLOB_OUT_OF_MEMORY`, the textures then missing), and two
 * extra copies of every image. The result is the same texture GLTFLoader's path makes: cached per
 * image (a second use is a clone), the image's extras in userData, its MIME type recorded. An image
 * behind a URI, or one for another loader, takes GLTFLoader's own path.
 */
class DirectKtx2Images implements GLTFLoaderPlugin {
  readonly name = 'IT3D_direct_ktx2_images'
  private readonly parser: GLTFParser
  private readonly images: ImageLoader
  constructor(parser: GLTFParser, images: ImageLoader) {
    this.parser = parser
    this.images = images
  }

  beforeRoot(): null {
    const parser = this.parser as GLTFParser & { sourceCache: Record<number, Promise<THREE.Texture>> }
    const images = this.images
    const load = parser.loadImageSource.bind(parser)
    parser.loadImageSource = (sourceIndex, loader) => {
      const def = (parser.json.images as Array<{ bufferView?: number; mimeType?: string; extras?: unknown }> | undefined)?.[sourceIndex]
      if ((loader as unknown) !== images || def?.bufferView === undefined) return load(sourceIndex, loader)
      const cached = parser.sourceCache[sourceIndex]
      if (cached !== undefined) return cached.then((t) => t.clone())
      // The buffer view is its own copy (GLTFLoader slices it) and is read once: the transcoder
      // worker may take it.
      const promise = parser.getDependency('bufferView', def.bufferView).then((bytes: ArrayBuffer) => images.parseBytes(bytes)).then((texture) => {
        if (def.extras && typeof def.extras === 'object') Object.assign(texture.userData, def.extras)
        texture.userData.mimeType = def.mimeType ?? 'image/ktx2'
        return texture as THREE.Texture
      })
      parser.sourceCache[sourceIndex] = promise
      return promise
    }
    return null
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
  // GLTFLoader only calls `load` on it (GLTFParser.loadImageSource); embedded images go through
  // `parseBytes` (DirectKtx2Images).
  const images = countedBy(ktx2, loader.manager)
  return loader
    .setKTX2Loader(images as unknown as KTX2Loader)
    .register((parser) => new CompressedMips(parser))
    .register((parser) => new DirectKtx2Images(parser, images))
}

/**
 * releaseTexels drops the CPU copy of a compressed texture's levels (the copy three keeps to upload
 * it), once it is on the GPU elsewhere (a merged texture array) and no material reads the texture.
 */
export function releaseTexels(texture: THREE.Texture): void {
  if ((texture as THREE.CompressedTexture).isCompressedTexture) texture.mipmaps = []
}
