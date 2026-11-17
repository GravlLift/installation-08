// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * sessionAssetCache3d.ts — the ONE session cache (`sessionCache3d`) that the 3D view's load path
 * reads and fills for the resources that cost the most to rebuild: the parsed map, a variant layer,
 * and the armor and weapon model libraries. Entries are keyed by the identity the server uses for
 * that build (the served path), so the second match on the same map, or reopening it, finds its map
 * and libraries already decoded and uploaded — only the match-specific state (players, action
 * layers, dress-up) is rebuilt.
 *
 * Every resource kind shares one byte budget (`DEFAULT_CACHE_CAP_BYTES`): a key is tagged by kind
 * (`map:`, `layer:`, `armor-lib:`, `weapon-lib:`) so the LRU competes fairly across them instead of
 * each kind keeping its own cap.
 */
import type { MapModel, SurfaceModel } from './mapModel'
import type { ArmorLibrary } from './armorLibrary3d'
import type { WeaponModels } from './weaponModels3d'
import { DEFAULT_CACHE_CAP_BYTES, SessionCache3d } from './sessionCache3d'
import { surfaceModelBytes } from './sessionResourceBytes3d'

/** The one process-wide cache; a test that needs a clean slate calls `sessionAssetCache.clear()`. */
export const sessionAssetCache = new SessionCache3d(DEFAULT_CACHE_CAP_BYTES, 'it3d:session-cache')

export const mapModelKey = (meshPath: string): string => `map:${meshPath}`
export const layerModelKey = (variantPath: string): string => `layer:${variantPath}`
export const armorLibraryKey = (base: string): string => `armor-lib:${base}`
export const weaponModelsKey = (base: string): string => `weapon-lib:${base}`
/** The weapon-coating library (`ArmorLibrary` pointed at the weapons folder, `armory3d.ts`'s
 *  `libraryArme`): swatches, coating tables and weapon-piece GLBs, kept separate from `weapon-lib`
 *  (the held/world weapon MODELS, `WeaponModels`) even though both read the same served folder. */
export const weaponCoatLibraryKey = (base: string): string => `weapon-coat-lib:${base}`

/** cachedMapModel: the cached map for `meshPath`, undefined on a miss (the caller must load and `set` it). */
export function cachedMapModel(meshPath: string): MapModel | undefined {
  return sessionAssetCache.get<MapModel>(mapModelKey(meshPath))
}

/** storeMapModel: caches a freshly loaded map model under `meshPath`, sized by its own geometries and textures. */
export function storeMapModel(meshPath: string, model: MapModel): void {
  sessionAssetCache.set(mapModelKey(meshPath), {
    value: model,
    bytes: surfaceModelBytes(model.root),
    dispose: (m) => m.dispose(),
  })
}

/** cachedLayerModel / storeLayerModel: the variant layer, keyed by its own served path. */
export function cachedLayerModel(variantPath: string): SurfaceModel | undefined {
  return sessionAssetCache.get<SurfaceModel>(layerModelKey(variantPath))
}

export function storeLayerModel(variantPath: string, layer: SurfaceModel): void {
  sessionAssetCache.set(layerModelKey(variantPath), {
    value: layer,
    bytes: surfaceModelBytes(layer.root),
    dispose: (l) => l.dispose(),
  })
}

/** cachedArmorLibrary / storeArmorLibrary: the armor-piece library, keyed by its served folder (`piecesPath`). */
export function cachedArmorLibrary(base: string): ArmorLibrary | undefined {
  return sessionAssetCache.get<ArmorLibrary>(armorLibraryKey(base))
}

/**
 * storeArmorLibrary caches `library` under `base`, sized by `library.loadedBytes()`. Its own GLB
 * roots and swatches arrive asynchronously (`file`/`swatch` are lazy), so this is only what has
 * loaded SO FAR: `library`'s own `onGrowth` callback (constructor param) is meant to call this
 * again on every new piece or swatch, which re-sizes the SAME cache entry without disposing it
 * (`SessionCache3d.set`'s same-value path) — without that, a library that keeps growing after its
 * first store would stay underestimated, exactly the `bytes: 0` problem this replaces.
 */
export function storeArmorLibrary(base: string, library: ArmorLibrary): void {
  sessionAssetCache.set(armorLibraryKey(base), {
    value: library,
    bytes: library.loadedBytes(),
    dispose: (lib) => lib.dispose(),
  })
}

/** cachedWeaponCoatLibrary / storeWeaponCoatLibrary: the weapon-coating library (swatches, coating
 *  tables, weapon-piece GLBs), kept across matches like `armor-lib` (see `weaponCoatLibraryKey`). */
export function cachedWeaponCoatLibrary(base: string): ArmorLibrary | undefined {
  return sessionAssetCache.get<ArmorLibrary>(weaponCoatLibraryKey(base))
}

export function storeWeaponCoatLibrary(base: string, library: ArmorLibrary): void {
  sessionAssetCache.set(weaponCoatLibraryKey(base), {
    value: library,
    bytes: library.loadedBytes(),
    dispose: (lib) => lib.dispose(),
  })
}

/** cachedWeaponModels / storeWeaponModels: the weapon/Spartan/equipment model library, keyed by its served folder. */
export function cachedWeaponModels(base: string): WeaponModels | undefined {
  return sessionAssetCache.get<WeaponModels>(weaponModelsKey(base))
}

/** storeWeaponModels caches `models` under `base`, sized by `models.loadedBytes()` (see `storeArmorLibrary`). */
export function storeWeaponModels(base: string, models: WeaponModels): void {
  sessionAssetCache.set(weaponModelsKey(base), {
    value: models,
    bytes: models.loadedBytes(),
    dispose: (m) => m.dispose(),
  })
}
