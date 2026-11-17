/**
 * meshoptGeometry3d.ts — compressed geometry (`EXT_meshopt_compression`) in the GLBs the server
 * builds (maps and Forge variant layers since build format 3, `internal/geocompress`).
 *
 * three's `MeshoptDecoder` (the meshoptimizer WebAssembly decoder shipped in three's
 * `examples/jsm/libs`, inlined in the bundle: nothing is fetched) decodes each compressed buffer
 * view into the same accessor types an uncompressed file has: float attributes stay 32-bit floats
 * (the server uses the exponential filter only), indices stay 16 or 32-bit, and no
 * `KHR_mesh_quantization` is used. Everything that reads geometry after the load (ray index,
 * merges, bounds, back faces, shadow proxies) sees the layout it always saw.
 *
 * Every GLTFLoader that reads a server GLB registers it (`withMeshopt`); `withKtx2` does it for
 * its callers. A file that lists the extension as required and reaches a loader without the
 * decoder fails to load with three's own error instead of drawing garbage. An uncompressed
 * GLB (built before format 3) never calls the decoder.
 */
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

import { measureSince, now } from './perf3d'

/** The decoder's workers: decoding a map's few hundred MB of views stays off the main thread. */
const DECODER_WORKERS = 4

/**
 * The decoder as three r170 ships it: its type declarations (from an older meshoptimizer) lack
 * the worker and async entry points the module has and GLTFLoader calls.
 */
type Decoder = typeof MeshoptDecoder & {
  useWorkers(count: number): void
  decodeGltfBufferAsync(count: number, size: number, source: Uint8Array, mode: string, filter?: string): Promise<Uint8Array>
}

const decoderModule = MeshoptDecoder as Decoder

let timed: Decoder | null = null

/**
 * timedDecoder is `MeshoptDecoder` with its workers started (once, where workers exist) and each
 * buffer view's decode recorded as an `it3d:meshopt` measure.
 */
function timedDecoder(): Decoder {
  if (timed) return timed
  if (typeof Worker !== 'undefined') {
    try {
      decoderModule.useWorkers(Math.max(1, Math.min(DECODER_WORKERS, (navigator.hardwareConcurrency || 2) / 2)))
    } catch {
      // Without workers the decoder runs on the main thread: slower, same result.
    }
  }
  const decoder = Object.create(decoderModule) as Decoder
  decoder.decodeGltfBufferAsync = (count, size, source, mode, filter) => {
    const start = now()
    return decoderModule.decodeGltfBufferAsync(count, size, source, mode, filter).then((out) => {
      measureSince('meshopt', start)
      return out
    })
  }
  timed = decoder
  return decoder
}

/** withMeshopt lets `loader` read compressed geometry. Returns `loader`. */
export function withMeshopt(loader: GLTFLoader): GLTFLoader {
  return loader.setMeshoptDecoder(timedDecoder())
}
