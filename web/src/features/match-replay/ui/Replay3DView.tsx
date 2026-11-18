// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * Replay3DView — THE REPLAY'S 3D VIEW, laid over the 2D canvas, in the same frame.
 *
 * It doesn't own time: the page's playback advances `frameRef` (scrub bar, timeline,
 * shortcuts, sound) and the view reads it on every screen frame. The followed player is
 * the page's POINT OF VIEW; with no point of view, the roster's first player.
 *
 * The mesh (hundreds of MiB, cached locally on the machine) streams down when the view
 * opens, never before: the 2D view alone doesn't pay for it. Loaded on demand
 * (`React.lazy`), the view also keeps three.js out of the page's bundle. Once opened, it
 * stays mounted when going back to the 2D view (`active` false: no more rendering), so it
 * can light back up without reloading the map.
 *
 * The match variant's object layer (`variantPath`) downloads alongside the map and gets
 * prepared once the map is placed (`useVariantLayer`). The load is one honest progress
 * (`LoadProgress3d`): map and variant downloads, decode, ray index, variant preparation, models,
 * shader warm-up (with the variant posed, so its shaders compile too) and a first drawn frame.
 * The view reports `ready` only when all of them are over.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'

import { framesPerSecond } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import { useReplaySpartans, type ReplayArmorSource } from '@/lib/replay/spartanArmor'

import { registerReplay3DExport } from '../export/replay3dExportStore'
import { newPlaybackMeter, recordFrame, recordScript } from '../model/playbackMeter_logic'
import { LOAD_STALL_MS, LoadProgress3d, sceneLoadSignal, type LoadState } from '../model/loading3d_logic'
import { reportClientError } from '@/lib/clientLog'
import { hudLevelOf } from '../model/hudLevel'
import type { ReplayLocale } from '../i18n/i18n'
import { SCENE3D_TEXT } from '../i18n/scene3dText'
import type { Action3dInputs, PageAction3dInputs } from '../scene3d/action3dInputs'
import { ArmorLibrary } from '../scene3d/armorLibrary3d'
import { SpartanArmory } from '../scene3d/armory3d'
import { mark, runWhenIdle, timed, timedSync } from '../scene3d/perf3d'
import { cssColor } from '../scene3d/cssColor'
import { loadMapModel } from '../scene3d/mapModel'
import { LoadGate } from '../scene3d/loadGate3d'
import { preloadAssets3d } from '../scene3d/preloadAssets3d'
import { fetchMesh } from '../scene3d/meshFetch'
import {
  armorLibraryKey, cachedArmorLibrary, cachedMapModel, cachedWeaponCoatLibrary, cachedWeaponModels, mapModelKey,
  sessionAssetCache, storeArmorLibrary, storeMapModel, storeWeaponCoatLibrary, storeWeaponModels,
  weaponCoatLibraryKey, weaponModelsKey,
} from '../scene3d/sessionAssetCache3d'
import { fetchBVHCache, uploadBVHCache } from '@/lib/api/standalone'
import { ReplayScene3d, type CameraMode3d, type PovStatus } from '../scene3d/replayScene3d'
import type { SceneView3d } from '../scene3d/topDownLogic'
import { buildTracks3d } from '../scene3d/tracks3d'
import { WeaponModels } from '../scene3d/weaponModels3d'
import { useReplay3dAids } from '../settings/useReplay3dAids'
import { useReplay3dFov } from '../settings/useReplay3dFov'
import { useReplay3dLook } from '../settings/useReplay3dLook'
import type { ReplayWindowBounds } from '../model/replayWindow'
import { ReplayHud3d } from './ReplayHud3d'
import { listenerOfCamera } from '../scene3d/soundListener3d'
import type { SoundListener } from '../sound/soundSpatial'
import { ReplayCadence3d } from './ReplayCadence3d'
import { ReplayLoading3d } from './ReplayLoading3d'
import { useMapCallouts } from './useMapCallouts'
import { useMinimap3d } from './useMinimap3d'
import { useSurfaceProbe } from './useSurfaceProbe'
import { useViewGripTuner } from './useViewGripTuner'
import { useVariantLayer } from './useVariantLayer'

const NEUTRAL = new THREE.Color(0.8, 0.8, 0.8)
const MB = 1024 * 1024
/** How far a pointer may move (CSS px) over the minimap before it is a drag, not a click. */
const MINIMAP_DRAG_PX = 4

export interface Replay3DViewProps {
  meshPath: string
  /** The variant's object layer, placed on the map once loaded; null with no layer. */
  variantPath: string | null
  /** True while the server still checks or builds the variant layer: the load waits for it. */
  variantPending?: boolean
  /** The served folder of weapon models (`weaponModels3d`), loaded on demand; null with no models. */
  weaponsPath: string | null
  /** The match players' armor (manifest and piece library), placed once it arrives; null with no armor. */
  armor: ReplayArmorSource | null
  doc: ReplayDocumentReady
  frameRef: RefObject<number>
  viewpoint: string | null
  colorOfXuid: (xuid: string) => string | null
  locale: ReplayLocale
  width: number
  height: number
  /** A reduced corner view: smaller loading and status text. */
  compact?: boolean
  /** False when 3D is turned off: the view stays mounted (map loaded) but renders no more frames. */
  active?: boolean
  /** What the page has already computed to draw the action (shots, deaths, colors, drawer). */
  action: PageAction3dInputs
  /** The page's gameplay window: it realigns the HUD clock with the match, like the timeline. */
  playWindow: ReplayWindowBounds | null
  /**
   * The match's time limit (in ms, from the context's regulation time): the HUD clock counts
   * down from it. `null` = variant with no known limit: it shows elapsed time instead.
   */
  timeLimitMs: number | null
  /** The sound listener: the rendered frame's camera, `null` when the view isn't rendering. */
  soundListenerRef?: RefObject<SoundListener | null>
  /** The drawing view: the perspective 3D view (default) or the orthographic top-down. */
  view?: SceneView3d
  /** Called on a click inside the corner minimap (while the 3D view draws it): the page opens the 2D view. */
  onMinimapClick?: () => void
  /** The camera mode, chosen by the page's control bar (`cameraChoiceLogic`). In free view
   *  `viewpoint` is the player followed last: the free camera starts behind him. */
  cameraMode: CameraMode3d
  /** Called with each load state (download, decoding, assets, warm-up, ready, error), so a
   *  page can show the scene's real progress and know when it is ready. */
  onLoadState?: (load: LoadState) => void
}

export function Replay3DView({
  meshPath, variantPath, variantPending = false, weaponsPath, armor, doc, frameRef, viewpoint, colorOfXuid, locale, width, height, compact = false, active = true, action, playWindow, timeLimitMs, soundListenerRef, onLoadState, view = '3d', onMinimapClick, cameraMode: mode,
}: Replay3DViewProps) {
  const t = SCENE3D_TEXT[locale]
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<ReplayScene3d | null>(null)
  const gateRef = useRef<LoadGate | null>(null)
  const weaponsRef = useRef<WeaponModels | null>(null)
  const armoryRef = useRef<SpartanArmory | null>(null)
  // The scene whose map is placed: what the variant layer waits for before loading.
  const [mapScene, setMapScene] = useState<ReplayScene3d | null>(null)
  // One progress per map and document: the loaders report into it, the view shows its snapshot.
  const progress = useMemo(() => new LoadProgress3d(), [meshPath, doc])
  const [load, setLoad] = useState<LoadState>(() => progress.snapshot())
  const onLoadStateRef = useRef(onLoadState)
  onLoadStateRef.current = onLoadState
  const onMinimapClickRef = useRef(onMinimapClick)
  onMinimapClickRef.current = onMinimapClick
  useEffect(() => {
    onLoadStateRef.current?.(load)
  }, [load])
  // One render per visible change (a tenth of a percent, the phase, the count), not one per chunk.
  useEffect(() => {
    let shown = ''
    const push = () => {
      const next = progress.snapshot()
      const key = next.kind === 'loading'
        ? `${next.phase}|${Math.floor(next.fraction * 1000)}|${next.phase === 'download' ? Math.floor(next.done / MB) : next.done}|${next.total}`
        : next.kind
      if (key === shown) return
      shown = key
      document.documentElement.dataset.it3dSceneLoad = sceneLoadSignal(next)
      if (next.kind === 'ready') console.info('3D replay: load', progress.report())
      setLoad(next)
    }
    push()
    return progress.subscribe(push)
  }, [progress])
  // The stall watchdog: a load with no progress at all for LOAD_STALL_MS fails with the phase it
  // sat in, shown on screen and written to server.log, instead of spinning forever.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const state = progress.snapshot()
      if (state.kind !== 'loading') {
        window.clearInterval(timer)
        return
      }
      const stalled = progress.checkStall()
      if (stalled) {
        window.clearInterval(timer)
        const message = `match load made no progress for ${LOAD_STALL_MS / 1000} s in phase "${stalled}"`
        console.error(`3D replay: ${message}`, progress.report())
        reportClientError('load-stalled', message, JSON.stringify(progress.report()))
      }
    }, 5000)
    return () => window.clearInterval(timer)
  }, [progress])
  const [loadId, setLoadId] = useState(0)
  const [povStatus, setPovStatus] = useState<PovStatus>('none')
  // The first published player: the default follow target when the page has no point of view.
  const [fallbackPov, setFallbackPov] = useState<string | null>(null)
  // Colors change (theme) without reloading the map: construction reads the latest one.
  const colorRef = useRef(colorOfXuid)
  useEffect(() => {
    colorRef.current = colorOfXuid
  }, [colorOfXuid])
  // The action layers re-read their inputs on every frame: theme and drawer change without
  // rebuilding the scene. Analysis aids are specific to 3D: the view adds them in here.
  const { aids } = useReplay3dAids()
  const inputs = useMemo<Action3dInputs>(() => ({ ...action, aids }), [action, aids])
  const actionRef = useRef(inputs)
  useEffect(() => {
    actionRef.current = inputs
  }, [inputs])

  // THE SCENE, one per mesh and per document: download, decode, then attach.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const scene = new ReplayScene3d(host)
    gateRef.current = new LoadGate()
    setLoadId((id) => id + 1)
    const abort = new AbortController()
    let alive = true
    const onProgress = (loaded: number, total: number) => {
      if (alive) progress.mapBytes(loaded, total)
    }
    const onStep = (step: 'materials' | 'index', done = 0, total = 0) => {
      if (alive) progress.step(step === 'materials' ? 'decode' : 'index', done, total)
    }
    const mapKey = mapModelKey(meshPath)
    void (async () => {
      try {
        let model = cachedMapModel(meshPath)
        // Packs the freshly built ray index to store server-side, once the map is shown; stays
        // null on a cache hit (the cached model's own index was already good) and when a used
        // sidecar matched (`loadMapModel`'s `bvhUpload` is then null too).
        let packBvhUpload: (() => ArrayBuffer) | null = null
        if (model) {
          // Warm load: the map is already decoded and indexed, from an earlier match on it this
          // session. Nothing to download, decode, or fetch a ray-index sidecar for: the progress
          // jumps straight to done, and nothing new needs to be uploaded.
          mark('cache-hit:map')
          progress.mapBytes(1, 1)
          progress.mapDownloaded()
          progress.step('decode', 1, 1)
          progress.step('index', 1, 1)
          progress.finish('decode')
          progress.finish('index')
        } else {
          // The sidecar is small next to the GLB: fetched alongside it, never after, so a cache
          // hit never adds a round trip to the critical path.
          const [buffer, bvhCache] = await Promise.all([
            fetchMesh(meshPath, onProgress, abort.signal),
            fetchBVHCache(meshPath, abort.signal),
          ])
          if (alive) progress.mapDownloaded()
          model = await timed('map:load', () => loadMapModel(buffer, onStep, scene.textureLoader, bvhCache))
          if (!alive) {
            model.dispose()
            return
          }
          progress.finish('decode')
          progress.finish('index')
          storeMapModel(meshPath, model)
          packBvhUpload = model.bvhUpload
        }
        sessionAssetCache.acquire(mapKey)
        const posedModel = model
        const tracks = buildTracks3d(doc)
        timedSync('map:attach', () => scene.attach(posedModel, tracks, (xuid) => cssColor(colorRef.current(xuid), NEUTRAL)))
        scene.enableAction(doc, () => actionRef.current)
        sceneRef.current = scene
        setMapScene(scene)
        setFallbackPov(tracks.players[0]?.xuid ?? null)
        // Off the critical path, after an idle moment (so the browser gets to paint first): a map
        // built before this shipped has no sidecar yet (`bvhCache` null); this is the lazy upload
        // that gives it one, read back by every later load of the same build. Never runs on a
        // cache hit or when a used sidecar already matched (`packBvhUpload` null either way).
        // Packing itself (`serializeBVHCache`, real work for a map the size of Streets) happens
        // here too, not before: see `mapModel.ts`'s `bvhUpload` doc comment.
        if (packBvhUpload) {
          const pack = packBvhUpload
          runWhenIdle(() => {
            if (abort.signal.aborted) return
            void uploadBVHCache(meshPath, pack(), abort.signal)
          })
        }
      } catch (err) {
        if (!alive) return
        console.error('3D replay: map load', err)
        reportClientError('map-load', err, meshPath)
        progress.fail()
      }
    })()
    return () => {
      alive = false
      abort.abort()
      sceneRef.current = null
      setMapScene(null)
      scene.dispose()
      sessionAssetCache.release(mapKey)
    }
  }, [meshPath, doc, progress])
  const variantSettled = useVariantLayer(mapScene, variantPath, variantPending, progress)
  const spartansQuery = useReplaySpartans(armor)
  const spartans = spartansQuery.data
  const piecesPath = armor?.piecesPath ?? null
  // The armor still in flight: the model-wait loop reads it, without re-running its effect.
  const waitingArmor = useRef(false)
  const armorLoading = !!armor && spartansQuery.fetchStatus === 'fetching' && !spartans
  useEffect(() => {
    waitingArmor.current = armorLoading
  }, [armorLoading])
  // The desired point of view and camera, read by the trial frame before opening.
  const warmRef = useRef<{ pov: string | null; mode: CameraMode3d }>({ pov: null, mode })
  useEffect(() => {
    if (!mapScene || !weaponsPath) return
    const key = weaponModelsKey(weaponsPath)
    let weapons = cachedWeaponModels(weaponsPath)
    if (weapons) {
      mark('cache-hit:weapon-library')
      weapons.useGate(gateRef.current ?? undefined)
    } else {
      weapons = new WeaponModels(
        weaponsPath, gateRef.current ?? undefined, undefined, undefined, undefined, mapScene.textureLoader,
        // Re-sizes this SAME cache entry (no dispose, `SessionCache3d.set`'s same-value path) every
        // time a new weapon/Spartan/grenade GLB finishes loading: without this, `loadedBytes()` at
        // store time (just the index, nothing decoded yet) would stay ~0 forever and the library
        // would never count against the cap or be evicted (`storeWeaponModels`'s own doc comment).
        () => storeWeaponModels(weaponsPath, weapons!),
      )
      storeWeaponModels(weaponsPath, weapons)
    }
    sessionAssetCache.acquire(key)
    weaponsRef.current = weapons
    mapScene.setWeaponModels(weapons)
    return () => {
      weaponsRef.current = null
      mapScene.setWeaponModels(null)
      sessionAssetCache.release(key)
    }
  }, [mapScene, weaponsPath])
  useEffect(() => {
    if (!mapScene || !piecesPath || !spartans) return
    const key = armorLibraryKey(piecesPath)
    let library = cachedArmorLibrary(piecesPath)
    if (library) mark('cache-hit:armor-library')
    else {
      library = new ArmorLibrary(piecesPath, undefined, () => storeArmorLibrary(piecesPath, library!))
      storeArmorLibrary(piecesPath, library)
    }
    sessionAssetCache.acquire(key)
    // The weapon-coating library (swatches, coating tables, weapon-piece GLBs): the same session
    // cache as armor-lib/weapon-lib, so a later match whose players share a weapon's coating or
    // swatch with an earlier one neither refetches nor redecodes it. Previously built fresh inside
    // every `SpartanArmory` instance (`libraryArme`, one per match, thrown away with it) — the
    // actual cause of `/api/weapons` swatch/coating requests repeating on every warm step.
    let weaponKey: string | null = null
    let libraryArme: ArmorLibrary | undefined
    if (weaponsPath) {
      weaponKey = weaponCoatLibraryKey(weaponsPath)
      libraryArme = cachedWeaponCoatLibrary(weaponsPath)
      if (libraryArme) mark('cache-hit:weapon-coat-library')
      else {
        libraryArme = new ArmorLibrary(weaponsPath, undefined, () => storeWeaponCoatLibrary(weaponsPath, libraryArme!))
        storeWeaponCoatLibrary(weaponsPath, libraryArme)
      }
      sessionAssetCache.acquire(weaponKey)
    }
    // The library (geometries, textures, coatings) is session-cached and NOT owned by this armory:
    // `ownsLibrary: false` keeps `dispose()` from releasing it, since this cache's own release
    // below (and eventual eviction) is what frees it. Same for `libraryArme` (implicit:
    // `ownsLibraryArme` is false whenever a `libraryArme` argument is given at all).
    const armory = new SpartanArmory(library, spartans.players, gateRef.current ?? undefined, weaponsPath, undefined, false, libraryArme)
    armoryRef.current = armory
    mapScene.setSpartanArmory(armory)
    preloadAssets3d(doc, null, armory)
    return () => {
      armoryRef.current = null
      mapScene.setSpartanArmory(null)
      sessionAssetCache.release(key)
      if (weaponKey) sessionAssetCache.release(weaponKey)
    }
  }, [mapScene, piecesPath, spartans, doc, weaponsPath])
  // The models (weapons, armor, arms): counted by the gate, over when it stays idle.
  const [assetsFor, setAssetsFor] = useState<ReplayScene3d | null>(null)
  useEffect(() => {
    if (!mapScene) return
    const gate = gateRef.current!
    const abort = new AbortController()
    const deadline = performance.now() + 20_000
    // The step is over only when the gate stays idle (`finish` below): more models may follow.
    const count = () => progress.step('assets', gate.finished, gate.started)
    const unsubscribe = gate.subscribe(count)
    count()
    void (async () => {
      preloadAssets3d(doc, weaponsRef.current, null)
      while (waitingArmor.current && performance.now() < deadline && !abort.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      if (abort.signal.aborted) return
      preloadAssets3d(doc, null, armoryRef.current)
      await timed('gate-idle-1', () => gate.idle(Math.max(0, deadline - performance.now()), abort.signal))
      if (abort.signal.aborted) return
      // The first frame's pose, under the loading screen: it requests what the view shows first
      // (the held first-person rig, gated) and starts the background shader compile, without
      // drawing frames nobody sees.
      timedSync('test-render', () => {
        mapScene.setPov(warmRef.current.pov)
        mapScene.setMode(warmRef.current.mode)
        mapScene.primeFirstFrame(frameRef.current ?? 0)
      })
      const result = await timed('gate-idle-2', () => gate.idle(Math.max(0, deadline - performance.now()), abort.signal))
      if (abort.signal.aborted) return
      if (result.timedOut || waitingArmor.current) console.warn('3D replay: load timeout exceeded', gate.pending + Number(waitingArmor.current))
      progress.finish('assets')
      setAssetsFor(mapScene)
      // The loading screen is gone: start the deferred first-person preload now, off the critical path.
      mapScene.startRigPreload()
    })()
    return () => { unsubscribe(); abort.abort() }
  }, [mapScene, doc, frameRef, progress])
  // With the models loaded and the variant posed (or absent): the shaders compile, then one frame
  // is drawn and presented. Only then is the scene ready.
  const assetsReady = !!mapScene && assetsFor === mapScene
  useEffect(() => {
    if (!mapScene || !assetsReady || !variantSettled) return
    const abort = new AbortController()
    const bounded = (work: Promise<unknown>, ms: number) => new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timeout)
        abort.signal.removeEventListener('abort', finish)
        resolve()
      }
      const timeout = setTimeout(finish, ms)
      abort.signal.addEventListener('abort', finish, { once: true })
      void work.then(finish, finish)
    })
    void (async () => {
      mapScene.setPov(warmRef.current.pov)
      mapScene.setMode(warmRef.current.mode)
      await bounded(timed('warmup', () => mapScene.warmUp()), 20_000)
      if (abort.signal.aborted) return
      progress.finish('warmup')
      timedSync('final-render', () => mapScene.render(frameRef.current ?? 0))
      // Two animation frames: the drawn frame has gone to the screen (bounded: a hidden tab has none).
      await bounded(timed('first-frame-wait', () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))), 500)
      if (abort.signal.aborted) return
      // The first frame is on screen: front the hidden corpse copies the first deaths would
      // otherwise pay lazily, off the load's critical path.
      mapScene.prepCorpses()
      // Warm the followed player's first-person rigs (every weapon he carries) off the load's
      // critical path; a followed-player change is picked up by placeAvatars (armsPlayerReady).
      mapScene.warmUpPlayer()
      progress.finish('first-frame')
    })()
    return () => abort.abort()
  }, [mapScene, assetsReady, variantSettled, frameRef, progress])
  const pov = viewpoint ?? fallbackPov
  useEffect(() => {
    warmRef.current = { pov, mode }
  }, [pov, mode])
  const ready = load.kind === 'ready'
  // The playback meter: the loop records each drawn frame (no allocation), the corner reads it.
  const meterRef = useRef(newPlaybackMeter())
  const readProfile = useCallback(() => sceneRef.current?.profile ?? null, [])
  useEffect(() => {
    if (ready) sceneRef.current?.setPov(pov)
  }, [ready, pov])
  useEffect(() => {
    if (ready) sceneRef.current?.setMode(mode)
  }, [ready, mode])
  useEffect(() => {
    if (ready) sceneRef.current?.setView(view)
  }, [ready, view])
  // A click on the corner minimap (a pointerup without a drag inside its square, while the 3D view
  // draws it) opens the 2D view. Captured on the host, before the canvas's camera gestures see it,
  // so the click never starts a drag; hovering the square shows a pointer cursor.
  useEffect(() => {
    if (!ready || view !== '3d') return
    const host = hostRef.current
    const scene = sceneRef.current
    if (!host || !scene) return
    let down: { id: number; x: number; y: number } | null = null
    const canvasPoint = (e: PointerEvent): [number, number] => {
      const box = scene.canvas.getBoundingClientRect()
      return [e.clientX - box.left, e.clientY - box.top]
    }
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const [x, y] = canvasPoint(e)
      if (!scene.minimapHit(x, y)) return
      down = { id: e.pointerId, x, y }
      e.stopPropagation()
    }
    const onMove = (e: PointerEvent) => {
      const [x, y] = canvasPoint(e)
      host.style.cursor = scene.minimapHit(x, y) ? 'pointer' : ''
      if (down && down.id === e.pointerId && Math.hypot(x - down.x, y - down.y) > MINIMAP_DRAG_PX) down = null
    }
    const onUp = (e: PointerEvent) => {
      if (!down || down.id !== e.pointerId) return
      down = null
      e.stopPropagation()
      onMinimapClickRef.current?.()
    }
    const onCancel = (e: PointerEvent) => {
      if (down && down.id === e.pointerId) down = null
    }
    host.addEventListener('pointerdown', onDown, true)
    host.addEventListener('pointermove', onMove, true)
    host.addEventListener('pointerup', onUp, true)
    host.addEventListener('pointercancel', onCancel, true)
    return () => {
      host.style.cursor = ''
      host.removeEventListener('pointerdown', onDown, true)
      host.removeEventListener('pointermove', onMove, true)
      host.removeEventListener('pointerup', onUp, true)
      host.removeEventListener('pointercancel', onCancel, true)
    }
  }, [ready, view])
  // The top-down view follows the chosen viewpoint only: in free camera its cut follows the living players.
  useEffect(() => {
    if (ready) sceneRef.current?.setTopFollowed(mode === 'free' ? null : viewpoint ?? null)
  }, [ready, viewpoint, mode])
  // Lighting follows the drawer (shadows, reflections, ambient occlusion).
  const { look } = useReplay3dLook()
  useEffect(() => {
    if (ready) sceneRef.current?.setLook(look)
  }, [ready, look])
  // The game's field-of-view setting follows the drawer: the camera's base vertical field.
  const { fov } = useReplay3dFov()
  useEffect(() => {
    if (ready) sceneRef.current?.setFovPreference(fov)
  }, [ready, fov])
  useEffect(() => {
    sceneRef.current?.resize(width, height)
  }, [ready, width, height])
  // The map's named areas: the HUD's place label, and the export HUD's (lent with the scene).
  const callouts = useMapCallouts(doc.matchId)
  // The loaded scene can be used for video export; screen state serves as its dialog's default.
  useEffect(() => {
    const scene = sceneRef.current
    if (!ready || !scene) return
    return registerReplay3DExport({ source: scene, live: active, camera: mode, pov, callouts })
  }, [ready, active, mode, pov, callouts])

  // THE FRAME LOOP: the scene is set to the player's current frame, at screen refresh rate.
  useEffect(() => {
    if (!ready || !active) return
    let raf = 0
    let shown: PovStatus = 'none'
    const step = (instantMs: number) => {
      const filmFrame = frameRef.current ?? 0
      recordFrame(meterRef.current, instantMs, filmFrame)
      const start = performance.now()
      const status = sceneRef.current?.render(filmFrame) ?? 'none'
      if (soundListenerRef && sceneRef.current) soundListenerRef.current = listenerOfCamera(sceneRef.current.camera)
      recordScript(meterRef.current, performance.now() - start)
      if (status !== shown) {
        shown = status
        setPovStatus(status)
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      if (soundListenerRef) soundListenerRef.current = null
    }
  }, [ready, active, frameRef, meterRef, soundListenerRef])

  useMinimap3d(sceneRef, ready && !compact)
  const surface = useSurfaceProbe(sceneRef)
  const viewGrip = useViewGripTuner(sceneRef, ready && mode === 'fp')
  return (
    <div className="absolute inset-0 overflow-hidden bg-background" style={{ width, height, containerType: 'size' }}>
      <div ref={hostRef} className="absolute inset-0" onClick={surface.onClick} />
      {/* How much of the HUD each view draws: `hudLevelOf` (first person all, third person no aim, free view score and feed, 2D score). */}
      {ready && active && pov && <ReplayHud3d doc={doc} xuid={pov} frameRef={frameRef} locale={locale} kills={action.kills} nameOfXuid={action.nameOfXuid} playWindow={playWindow} timeLimitMs={timeLimitMs} sceneRef={sceneRef} hud={hudLevelOf(view, mode)} callouts={callouts} />}
      {surface.probe && (
        <button
          type="button"
          onClick={surface.clear}
          className="absolute bottom-3 left-3 max-w-[90%] rounded-md border border-border bg-card/90 px-2 py-1 text-left font-mono text-xs text-foreground"
        >
          {surface.probe.line} {surface.probe.copied ? `(${t.probeCopied})` : ''}
        </button>
      )}
      {viewGrip && (
        <div className="absolute bottom-3 right-3 select-all whitespace-pre rounded-md border border-border bg-card/90 px-2 py-1 font-mono text-xs text-foreground">
          {viewGrip.line} {viewGrip.copied ? `(${t.probeCopied})` : ''}
        </div>
      )}
      {!ready && <ReplayLoading3d key={loadId} load={load} t={t} compact={compact} />}
      {ready && mode !== 'free' && povStatus !== 'alive' && povStatus !== 'dead' && (
        <div className={`pointer-events-none absolute inset-x-0 top-[45%] text-center font-semibold text-muted-foreground ${compact ? 'text-xs' : 'text-sm'}`}>
          {povStatus === 'unspawned' ? t.povUnspawned : t.noPov}
        </div>
      )}
      {ready && active && <ReplayCadence3d meterRef={meterRef} profile={readProfile} filmFps={framesPerSecond(doc)} locale={locale} />}
    </div>
  )
}
