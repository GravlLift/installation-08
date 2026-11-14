/**
 * Replay3DView — LA VUE 3D DU REJEU, posée sur la toile 2D, au même cadre.
 *
 * Elle ne possède pas le temps : la lecture de la page avance `frameRef` (barre de lecture, frise,
 * raccourcis, son) et la vue la lit à chaque image d'écran. Le joueur suivi est le POINT DE VUE de
 * la page ; sans point de vue, le premier joueur du roster.
 *
 * Le maillage (centaines de Mio, cache local du poste) se télécharge en flux à l'ouverture de la
 * vue, jamais avant : la 2D seule ne le paie pas. Chargée à la demande (`React.lazy`), la vue
 * garde aussi three.js hors du paquet de la page. Une fois ouverte, elle reste montée quand on
 * revient à la 2D (`active` faux : plus aucun rendu), pour se rallumer sans recharger la carte.
 *
 * Le calque des objets de la variante du match (`variantPath`) se charge APRÈS la carte posée et
 * s'y ajoute sans la retarder (`useVariantLayer`) ; il arrive aussi plus tard, une fois construit.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'

import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import { useReplaySpartans, type ReplayArmorSource } from '@/lib/replay/spartanArmor'

import { registerReplay3DExport } from '../export/replay3dExportStore'
import { nouvelleCadence, noterImage, noterTravail } from '../model/cadenceImages_logic'
import { fractionChargement3d, type LoadState } from '../model/chargement3d_logic'
import { hudLevelOf } from '../model/hudLevel'
import type { ReplayLocale } from '../i18n/i18n'
import { SCENE3D_TEXT } from '../i18n/scene3dText'
import type { Action3dInputs, PageAction3dInputs } from '../scene3d/action3dInputs'
import { ArmorLibrary } from '../scene3d/armorLibrary3d'
import { SpartanArmory } from '../scene3d/armory3d'
import { cssColor } from '../scene3d/cssColor'
import { loadMapModel } from '../scene3d/mapModel'
import { LoadGate } from '../scene3d/loadGate3d'
import { preloadAssets3d } from '../scene3d/preloadAssets3d'
import { fetchMesh } from '../scene3d/meshFetch'
import { ReplayScene3d, type CameraMode3d, type PovStatus } from '../scene3d/replayScene3d'
import type { SceneView3d } from '../scene3d/topDownLogic'
import { buildTracks3d } from '../scene3d/tracks3d'
import { WeaponModels } from '../scene3d/weaponModels3d'
import { useReplay3dAids } from '../settings/useReplay3dAids'
import { useReplay3dFov } from '../settings/useReplay3dFov'
import { useReplay3dLook } from '../settings/useReplay3dLook'
import type { ReplayWindowBounds } from '../model/replayWindow'
import { ReplayAth3d } from './ReplayAth3d'
import { listenerOfCamera } from '../scene3d/soundListener3d'
import type { SoundListener } from '../sound/soundSpatial'
import { ReplayCadence3d } from './ReplayCadence3d'
import { ReplayChargement3d } from './ReplayChargement3d'
import { useMinimap3d } from './useMinimap3d'
import { useSurfaceProbe } from './useSurfaceProbe'
import { useViewGripTuner } from './useViewGripTuner'
import { useVariantLayer } from './useVariantLayer'

const NEUTRAL = new THREE.Color(0.8, 0.8, 0.8)
const MB = 1024 * 1024

export interface Replay3DViewProps {
  meshPath: string
  /** Le calque des objets de la variante, posé sur la carte une fois chargée ; null sans calque. */
  variantPath: string | null
  /** Le dossier servi des modèles d'arme (`weaponModels3d`), chargés à la demande ; null sans modèles. */
  weaponsPath: string | null
  /** L'armure des joueurs du match (manifeste et bibliothèque des pièces), posée à son arrivée ; null sans armure. */
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
  /** Faux quand la 3D est éteinte : la vue reste montée (carte chargée) mais ne rend plus d'image. */
  active?: boolean
  /** Ce que la page a déjà cuit pour dessiner l'action (tirs, morts, encres, tiroir). */
  action: PageAction3dInputs
  /** La fenêtre de gameplay de la page : elle recale l'horloge du HUD sur le match, comme la frise. */
  playWindow: ReplayWindowBounds | null
  /**
   * La limite de temps du match (en ms, depuis le temps réglementaire du contexte) : l'horloge
   * du HUD en compte à rebours. `null` = variante sans limite connue : elle affiche le temps
   * écoulé.
   */
  timeLimitMs: number | null
  /** L'auditeur du son : la caméra de l'image rendue, `null` quand la vue ne rend pas. */
  soundListenerRef?: RefObject<SoundListener | null>
  /** The drawing view: the perspective 3D view (default) or the orthographic top-down. */
  view?: SceneView3d
  /** The camera mode, chosen by the page's control bar (`cameraChoiceLogic`). In free view
   *  `viewpoint` is the player followed last: the free camera starts behind him. */
  cameraMode: CameraMode3d
  /** Called with each load state (download, decoding, assets, warm-up, ready, error), so a
   *  page can show the scene's real progress and know when it is ready. */
  onLoadState?: (load: LoadState) => void
}

export function Replay3DView({
  meshPath, variantPath, weaponsPath, armor, doc, frameRef, viewpoint, colorOfXuid, locale, width, height, compact = false, active = true, action, playWindow, timeLimitMs, soundListenerRef, onLoadState, view = '3d', cameraMode: mode,
}: Replay3DViewProps) {
  const t = SCENE3D_TEXT[locale]
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<ReplayScene3d | null>(null)
  const gateRef = useRef<LoadGate | null>(null)
  const weaponsRef = useRef<WeaponModels | null>(null)
  const armoryRef = useRef<SpartanArmory | null>(null)
  // La scène dont la carte est posée : ce que le calque de la variante attend pour se charger.
  const [mapScene, setMapScene] = useState<ReplayScene3d | null>(null)
  const [load, setLoad] = useState<LoadState>({ kind: 'download', loaded: 0, total: 0 })
  const onLoadStateRef = useRef(onLoadState)
  onLoadStateRef.current = onLoadState
  useEffect(() => {
    onLoadStateRef.current?.(load)
  }, [load])
  const [loadId, setLoadId] = useState(0)
  const [povStatus, setPovStatus] = useState<PovStatus>('none')
  // Le premier joueur publié : le suivi par défaut quand la page n'a pas de point de vue.
  const [fallbackPov, setFallbackPov] = useState<string | null>(null)
  // Les encres changent (thème) sans recharger la carte : la construction lit la dernière.
  const colorRef = useRef(colorOfXuid)
  useEffect(() => {
    colorRef.current = colorOfXuid
  }, [colorOfXuid])
  // Les calques d'action relisent les entrées à chaque image : le thème et le tiroir changent sans
  // reconstruire la scène. Les repères d'analyse sont propres à la 3D : la vue les y ajoute.
  const { aids } = useReplay3dAids()
  const inputs = useMemo<Action3dInputs>(() => ({ ...action, aids }), [action, aids])
  const actionRef = useRef(inputs)
  useEffect(() => {
    actionRef.current = inputs
  }, [inputs])

  // LA SCÈNE, une par maillage et par document : téléchargement, décodage, puis attache.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const scene = new ReplayScene3d(host)
    gateRef.current = new LoadGate()
    setLoadId((id) => id + 1)
    setLoad({ kind: 'download', loaded: 0, total: 0 })
    const abort = new AbortController()
    let alive = true
    // Un rendu par point de progression, pas un par morceau reçu (des milliers).
    let shownPercent = -1
    const onProgress = (loaded: number, total: number) => {
      const percent = total > 0 ? Math.floor((100 * loaded) / total) : Math.floor(loaded / MB)
      if (!alive || percent === shownPercent) return
      shownPercent = percent
      setLoad({ kind: 'download', loaded, total })
    }
    // Le décodage rapporte sa progression (images décodées, index bâtis) : la barre ne bouge que
    // d'un point de pourcentage global à la fois, pas à chaque unité.
    let shownStepPercent = -1
    const onStep = (step: 'materials' | 'index', done = 0, total = 0) => {
      if (!alive) return
      const percent = Math.floor(fractionChargement3d({ kind: step, done, total }) * 100)
      if (percent === shownStepPercent) return
      shownStepPercent = percent
      setLoad({ kind: step, done, total })
    }
    void (async () => {
      try {
        const buffer = await fetchMesh(meshPath, onProgress, abort.signal)
        const model = await loadMapModel(buffer, onStep)
        if (!alive) {
          model.dispose()
          return
        }
        const tracks = buildTracks3d(doc)
        scene.attach(model, tracks, (xuid) => cssColor(colorRef.current(xuid), NEUTRAL))
        scene.enableAction(doc, () => actionRef.current)
        sceneRef.current = scene
        setMapScene(scene)
        setFallbackPov(tracks.players[0]?.xuid ?? null)
        setLoad({ kind: 'assets' })
      } catch (err) {
        if (!alive) return
        console.error('rejeu 3D : chargement de la carte', err)
        setLoad({ kind: 'error' })
      }
    })()
    return () => {
      alive = false
      abort.abort()
      sceneRef.current = null
      setMapScene(null)
      scene.dispose()
    }
  }, [meshPath, doc])
  useVariantLayer(mapScene, variantPath)
  const spartansQuery = useReplaySpartans(armor)
  const spartans = spartansQuery.data
  const piecesPath = armor?.piecesPath ?? null
  // L'armure encore en route : l'attente des modèles la lit, sans relancer son effet.
  const waitingArmor = useRef(false)
  const armorLoading = !!armor && spartansQuery.fetchStatus === 'fetching' && !spartans
  useEffect(() => {
    waitingArmor.current = armorLoading
  }, [armorLoading])
  // Le point de vue et la caméra voulus, lus par l'image d'essai d'avant l'ouverture.
  const warmRef = useRef<{ pov: string | null; mode: CameraMode3d }>({ pov: null, mode })
  useEffect(() => {
    if (!mapScene || !weaponsPath) return
    const weapons = new WeaponModels(weaponsPath, gateRef.current ?? undefined)
    weaponsRef.current = weapons
    mapScene.setWeaponModels(weapons)
    return () => { weaponsRef.current = null; mapScene.setWeaponModels(null) }
  }, [mapScene, weaponsPath])
  useEffect(() => {
    if (!mapScene || !piecesPath || !spartans) return
    const armory = new SpartanArmory(new ArmorLibrary(piecesPath), spartans.players, gateRef.current ?? undefined, weaponsPath)
    armoryRef.current = armory
    mapScene.setSpartanArmory(armory)
    preloadAssets3d(doc, null, armory)
    return () => { armoryRef.current = null; mapScene.setSpartanArmory(null) }
  }, [mapScene, piecesPath, spartans, doc, weaponsPath])
  useEffect(() => {
    if (!mapScene) return
    const gate = gateRef.current!
    const abort = new AbortController()
    const deadline = performance.now() + 20_000
    void (async () => {
      preloadAssets3d(doc, weaponsRef.current, null)
      while (waitingArmor.current && performance.now() < deadline && !abort.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      if (abort.signal.aborted) return
      preloadAssets3d(doc, null, armoryRef.current)
      await gate.idle(Math.max(0, deadline - performance.now()), abort.signal)
      if (abort.signal.aborted) return
      // Une image d'essai, sous l'écran de chargement : elle demande ce que la vue montre d'abord
      // (les bras du joueur suivi, leur peinture) et compile les matières, puis on attend encore.
      mapScene.setPov(warmRef.current.pov)
      mapScene.setMode(warmRef.current.mode)
      mapScene.render(frameRef.current ?? 0)
      mapScene.render(frameRef.current ?? 0)
      const result = await gate.idle(Math.max(0, deadline - performance.now()), abort.signal)
      if (abort.signal.aborted) return
      setLoad({ kind: 'warmup' })
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timeout)
          abort.signal.removeEventListener('abort', finish)
          resolve()
        }
        const timeout = setTimeout(finish, Math.max(0, deadline - performance.now()))
        abort.signal.addEventListener('abort', finish, { once: true })
        void mapScene.warmUp().then(finish)
      })
      if (abort.signal.aborted) return
      if (result.timedOut || waitingArmor.current) console.warn('rejeu 3D : délai de chargement dépassé', gate.pending + Number(waitingArmor.current))
      setLoad({ kind: 'ready' })
    })()
    return () => abort.abort()
  }, [mapScene, doc, frameRef])

  const pov = viewpoint ?? fallbackPov
  useEffect(() => {
    warmRef.current = { pov, mode }
  }, [pov, mode])
  const ready = load.kind === 'ready'
  // La cadence des images de l'écran : la boucle la mesure (sans allocation), le coin la lit.
  const cadenceRef = useRef(nouvelleCadence())
  const lireProfil = useCallback(() => sceneRef.current?.profil ?? null, [])
  useEffect(() => {
    if (ready) sceneRef.current?.setPov(pov)
  }, [ready, pov])
  useEffect(() => {
    if (ready) sceneRef.current?.setMode(mode)
  }, [ready, mode])
  useEffect(() => {
    if (ready) sceneRef.current?.setView(view)
  }, [ready, view])
  // The top-down view follows the chosen viewpoint only: in free camera its cut follows the living players.
  useEffect(() => {
    if (ready) sceneRef.current?.setTopFollowed(mode === 'free' ? null : viewpoint ?? null)
  }, [ready, viewpoint, mode])
  // L'éclairage suit le tiroir (ombres, reflets, occlusion ambiante).
  const { look } = useReplay3dLook()
  useEffect(() => {
    if (ready) sceneRef.current?.setLook(look)
  }, [ready, look])
  // Le réglage de champ du jeu suit le tiroir : le champ vertical de base de la caméra.
  const { fov } = useReplay3dFov()
  useEffect(() => {
    if (ready) sceneRef.current?.setFovPreference(fov)
  }, [ready, fov])
  useEffect(() => {
    sceneRef.current?.resize(width, height)
  }, [ready, width, height])
  // La scène chargée se prête à l'export vidéo ; l'état de l'écran sert de défaut à son dialogue.
  useEffect(() => {
    const scene = sceneRef.current
    if (!ready || !scene) return
    return registerReplay3DExport({ source: scene, live: active, camera: mode, pov })
  }, [ready, active, mode, pov])

  // LA BOUCLE D'IMAGES : la scène se pose à l'image courante du lecteur, à la cadence de l'écran.
  useEffect(() => {
    if (!ready || !active) return
    let raf = 0
    let shown: PovStatus = 'none'
    const step = (instantMs: number) => {
      noterImage(cadenceRef.current, instantMs)
      const debut = performance.now()
      const status = sceneRef.current?.render(frameRef.current ?? 0) ?? 'none'
      if (soundListenerRef && sceneRef.current) soundListenerRef.current = listenerOfCamera(sceneRef.current.camera)
      noterTravail(cadenceRef.current, performance.now() - debut)
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
  }, [ready, active, frameRef, cadenceRef, soundListenerRef])

  useMinimap3d(sceneRef, ready && !compact)
  const surface = useSurfaceProbe(sceneRef)
  const viewGrip = useViewGripTuner(sceneRef, ready && mode === 'fp')
  return (
    <div className="absolute inset-0 overflow-hidden bg-background" style={{ width, height, containerType: 'size' }}>
      <div ref={hostRef} className="absolute inset-0" onClick={surface.onClick} />
      {/* How much of the HUD each view draws: `hudLevelOf` (first person all, third person no aim, free view score and feed, 2D score). */}
      {ready && active && pov && <ReplayAth3d doc={doc} xuid={pov} frameRef={frameRef} locale={locale} kills={action.kills} nameOfXuid={action.nameOfXuid} playWindow={playWindow} timeLimitMs={timeLimitMs} sceneRef={sceneRef} hud={hudLevelOf(view, mode)} />}
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
      {!ready && <ReplayChargement3d key={loadId} load={load} t={t} compact={compact} gateRef={gateRef} />}
      {ready && mode !== 'free' && povStatus !== 'alive' && povStatus !== 'dead' && (
        <div className={`pointer-events-none absolute inset-x-0 top-[45%] text-center font-semibold text-muted-foreground ${compact ? 'text-xs' : 'text-sm'}`}>
          {povStatus === 'unspawned' ? t.povUnspawned : t.noPov}
        </div>
      )}
      {ready && active && <ReplayCadence3d etatRef={cadenceRef} profil={lireProfil} locale={locale} />}
    </div>
  )
}
