/**
 * useReplayExport — LA BOUCLE QUI RECALCULE LE FILM, et la couture React autour d'elle.
 *
 * # LA DIFFÉRENCE AVEC L'ENREGISTREMENT, EN UNE PHRASE
 *
 * `useReplayCapture` FILME l'écran : il subit le temps réel. Ce hook RECALCULE le film — il
 * pose une image, la peint, l'encode, et passe à la suivante aussi vite que la machine suit.
 * Un match de dix minutes sort en une minute au lieu de dix, et la durée du fichier ne dépend
 * jamais du temps de calcul (les horodatages sont posés, cf. `replayVideoEncoder.ts`).
 *
 * Ce qui rend cela possible est une propriété du canvas, pas une astuce : `draw()` est une
 * FONCTION PURE de `frameRef.current`. Poser l'image puis appeler `draw()` peint exactement
 * cette image, autant de fois qu'on veut, dans n'importe quel ordre.
 *
 * # TROIS PIÈGES, TOUS MESURÉS PLUTÔT QUE SUPPOSÉS
 *
 * 1. NE JAMAIS RENDRE LA MAIN PAR UN MINUTEUR. `setTimeout` et `requestAnimationFrame` sont
 *    bridés en onglet caché — 673 ms de latence moyenne pour le premier, jamais déclenché pour
 *    le second — et un export dure des minutes pendant lesquelles l'utilisateur va ailleurs.
 *    C'est `yieldToEvents()` (cf. `eventLoopYield.ts`), et rien d'autre.
 * 2. LES COULEURS DOIVENT ÊTRE RÉSOLUES AVANT D'ATTEINDRE LA TOILE. Un `fillStyle` qui reçoit
 *    `var(--primary)` est SILENCIEUSEMENT IGNORÉ : le contexte garde la couleur précédente,
 *    sans erreur, et le panneau sort dans une teinte au hasard. Vérifié dans le navigateur le
 *    2026-08-28. D'où `resolveToken` / `readInk` ici, et un peintre qui ne lit rien.
 * 3. LA LECTURE DOIT S'ARRÊTER. La boucle d'animation écrit `frameRef` elle aussi ; les deux
 *    en même temps se disputeraient le curseur et l'export peindrait n'importe quoi.
 *
 * # L'ÉCRAN N'EST PAS ÉPARGNÉ, ET C'EST VOULU
 *
 * La boucle peint dans la TOILE VISIBLE. L'utilisateur voit donc le match défiler très vite
 * pendant l'export — ce n'est pas un défaut mais la seule preuve visible que quelque chose se
 * passe, et cela évite une seconde toile de la taille de la première. À la fin, quoi qu'il
 * arrive, l'image d'avant l'export est reposée et repeinte.
 *
 * # LE CLIP A TOUJOURS LA MÊME APPARENCE (2026-09-16, décisions D8/D9)
 *
 * Fond noir pur, et TOUTES les encres — scène, calques cuits, vignettes, panneaux — lues dans le
 * thème SOMBRE (`layers/themeInk.ts`), sans toucher au thème de la page. La toile VISIBLE montre
 * donc le rendu sombre pendant l'export (y compris en thème clair) : c'est accepté, et tout
 * revient aux encres de la page à la fin, sur tous les chemins.
 *
 * # LE FICHIER SORT AU FORMAT CHOISI, PAS À LA TAILLE DE L'ÉCRAN (2026-09-16)
 *
 * Pendant l'export, la toile se MET EN PAGE dans le cadre 16:9 du format (`exportFormats.ts`,
 * `exportLayoutStore.ts`) et se rend à sa densité : 1920x1080 ou 1280x720, quels que soient la
 * fenêtre et le `devicePixelRatio`. À l'écran, la boîte de la toile ne change pas de taille :
 * l'image 16:9 y est inscrite sans déformation (`object-fit: contain`, cf. `ReplayView.screen`),
 * et la page retrouve sa mise en page d'écran à la fin, sur tous les chemins.
 *
 * # EN 3D
 *
 * La vue 3D chargée de la page se prête à l'export (`replay3dExportStore`) : la scène rend chaque
 * image à la taille du fichier, avec la caméra et le joueur suivi choisis, et `export3dFrame` la
 * compose avec les étiquettes des joueurs, la mini-carte 2D en option et les mêmes panneaux de
 * fin. Le plan d'images, les horodatages et le son sont ceux de la 2D, at 60 frames per second of
 * match instead of 30 (`EXPORT_FPS_3D`; 30 only when the browser refuses 60, and then the dialog
 * says so). Each 3D frame is rendered to completion before it is encoded: visible ragdolls baked
 * (`ActionScene3d.settle`), and any model the frame asked for loaded, then the frame rendered
 * again (`exportPendingLoads`).
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import { meXUIDOf } from '@/features/match-view/xuidMeta'
import { resolveToken } from '@/lib/accessibility/resolveToken'
import { teamLogoPath } from '@/lib/halo/teamNames'
import type { MatchScoreboardRow } from '@/lib/api/types'
import type { FilmAllegiance } from '@/lib/replay/filmAllegiance'
import type { ReplayScoreDocument } from '@/lib/replay/scoreTimeline'



import { readInk } from '../layers/canvasInk'
import { yieldToEvents } from './eventLoopYield'
import {
  buildOverlayPanelSource,
  type ExportOutcome,
  type OverlayPanelSource,
} from './exportOverlayPanels'
import { paintOverlayPanel, type OverlayFonts, type OverlayInk } from './overlayPaint'
import { mixReplayAudio, soundUrlOf, type MixedTracks, type SoundFamily } from '../sound/replayAudioMix'
import type { RenderHooks } from '../sound/mixRender'
import { listenerAtOfPlayer } from '../sound/soundListenerOf'
import { formatClock, frameToMs } from '../../../lib/replay/replayLogic'
import { buildCaptureFilename, holdDownload, type PendingDownload } from './replayCapture'
import { tintedIconCanvas } from '../layers/replayDraw'
import {
  END_HOLD_MS,
  buildExportPlan,
  defaultExportBounds,
  exportProgressPct,
  type ExportBounds,
  type ExportPlan,
} from './replayExportPlan'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { EXPORT_FPS, EXPORT_FPS_3D, canExportVideo, openVideoExport, type VideoExportSink } from './replayVideoEncoder'
import { displayClockMs, type ReplayWindowBounds } from '../model/replayWindow'
import {
  exportFormatOf,
  exportLayoutFor,
  type ExportFormat,
  type ExportFormatId,
  type ExportFraming,
} from './exportFormats'
import { canvasPixelRatio, requestExportLayout, waitForExportLayout } from './exportLayoutStore'
import { REPLAY_TEXT, type ReplayLocale } from '../i18n/i18n'
import type { ReplaySoundEvent } from '../sound/replaySoundVariants'
import type { EnginePlan } from '../sound/vehicleEngineSound'
import { readVictory } from '../model/victoryLogic'
import { make3dPainter, type Export3dOptions } from './export3dFrame'
import { replay3DExportEntry, type Replay3DExportSource } from './replay3dExportStore'
import { createExportHud } from './exportHud'
import type { ReplayKill } from '../model/killFeedLogic'

/** Cadence de publication de la progression, en images encodées. */
const PROGRESS_EVERY = 15

export interface ReplayExportOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>
  /** L'image courante, PARTAGÉE avec le dessin : la boucle l'écrit, `draw()` la lit. */
  frameRef: RefObject<number>
  /** Le tracé d'une image, tel que le canvas le publie. */
  redraw: () => void
  /** Met la lecture en pause. Appelé AVANT la boucle (cf. piège 3 de l'en-tête). */
  pause: () => void
  doc: ReplayDocumentReady & ReplayScoreDocument
  playWindow: ReplayWindowBounds | null
  scoreboard: readonly MatchScoreboardRow[]
  kills?: readonly ReplayKill[]
  timeLimitMs?: number | null
  /** L'allégeance lue dans le film, vue du point de vue (`model.allegiance`) : le panneau de fin. */
  allegiance: FilmAllegiance
  /**
   * Le verdict du match, DÉJÀ complété du mot que l'écran montre (`viewedLabel`, résolu par
   * `useReplayCapture` depuis les mappings du titre). `null` = pas d'écran de fin, comme le DOM.
   */
  outcome: ExportOutcome | null
  /**
   * LE POINT DE VUE de la page (2026-09-06) : l'export rend CE QUE L'ÉCRAN MONTRE (décision 12
   * du plan « frise, point de vue ») — panneau de victoire compris. La personne qui exporte a
   * choisi ce qu'elle regarde. `null` : le joueur de la page.
   *
   * OBLIGATOIRE DEPUIS LE 2026-09-07 (revue F4, dernier maillon de la chaîne) : `useReplayCapture`
   * le relaie déjà, mais optionnel ici, l'oubli de ce relais-là restait silencieux — le clip
   * serait sorti au camp du joueur de la page pendant que l'écran suivait le joueur choisi.
   * Requis, l'oubli est une erreur de compilation.
   */
  viewpoint: string | null
  titleSlug: string
  locale: ReplayLocale
  /**
   * LA PISTE SONORE DU REJEU, telle que la page la joue (`useReplaySound.exportTrack`). Absente
   * = clip muet. Elle n'est PAS reconstruite par l'export : c'est ce qui garantit qu'un clip
   * n'invente aucun son et n'en manque aucun.
   */
  soundTrack?: () => {
    timeline: readonly ReplaySoundEvent[]
    endMatchStems: readonly string[]
    variationPercent: number
    distancePercent: number
    /** Quels stems sont de la voix, lesquels de la musique (cf. `useReplaySound.exportTrack`). */
    families: { voice: readonly string[]; music: readonly string[] }
    /** Le plan MOTEUR des véhicules — états continus, mixés par `vehicleEngineMix.ts`. */
    engines: readonly EnginePlan[]
  }
  /** Le volume réglé dans la page. Le mixage le suit, même haut-parleurs coupés (décision D6). */
  soundVolume?: number
  /**
   * LE PALIER DE ZOOM À L'ÉCRAN (1 = carte entière). Il ne sert qu'au DIALOGUE, qui ne propose le
   * choix du cadrage que sur une carte zoomée (décision D6 du plan « formats vidéo »). Absent : 1.
   */
  zoomLevel?: number
}

/** Ce que l'appelant choisit au moment de lancer. Le son est INCLUS par défaut (décision D6). */
export interface ExportRunOptions {
  sound?: boolean
  /** Le format du fichier ; absent -> le défaut du catalogue (1080p, décision D2). */
  format?: ExportFormatId
  /** Le cadrage de la carte ; absent -> « carte entière » (décision D6). */
  framing?: ExportFraming
  /**
   * Exporter la VUE 3D (scène chargée de la page, cf. `replay3dExportStore`) au lieu de la carte
   * 2D ; absent -> la 2D. Le son, la plage et les panneaux de fin ne changent pas.
   */
  view3d?: Export3dOptions | null
}

/** L'état que le dialogue affiche. `total` vaut 0 tant qu'aucun export n'a démarré. */
/**
 * LES CINQ ETATS D'UN EXPORT, et pourquoi ils ne se resument pas a « en cours / pas en cours ».
 *
 * `prepare` est celui qui manquait et qui coutait le plus cher a l'utilisateur : entre le clic
 * et la premiere image encodee, il faut attendre les polices, charger le logo, DECODER tous les
 * fichiers sons, RENDRE le mixage hors ligne et ENCODER la piste AAC. Sur un match charge en
 * sons, cela fait plusieurs secondes pendant lesquelles la barre affichait « Image 0 / 18000 »
 * sans bouger — c'est-a-dire exactement l'instant ou l'on se demande si ca a plante.
 *
 * `done` manquait aussi : le dialogue redevenait le formulaire et le fichier tombait dans les
 * telechargements sans qu'un mot ne le dise.
 */
export type ExportPhase = 'idle' | 'prepare' | 'encode' | 'done' | 'failed'

/** The sound step of the preparation, with its share done (`ReplayExportState.prepareStep`). */
export interface PrepareStep {
  stage: 'mix' | 'audio'
  pct: number
}

export interface ReplayExportState {
  phase: ExportPhase
  done: number
  total: number
  pct: number
  /**
   * Temps restant ESTIME, en millisecondes, ou `undefined` tant qu'aucune image n'est encodee.
   * Fiable ici parce que le cout par image est tres regulier : meme toile, meme encodeur, et
   * un dessin dont la charge ne depend pas de l'instant du match.
   */
  etaMs?: number
  /** Le nom du fichier prêt à descendre, en phase `done`. */
  filename?: string
  /** Le téléchargement prêt : le clip, son URL et le `save` qui part d'un clic. Absent hors `done`. */
  save?: PendingDownload
  /**
   * `true` = le son etait demande mais le navigateur a REFUSE la piste : le clip est muet, et
   * il faut le dire. Un clip silencieux qu'on croyait sonore se decouvre au montage.
   */
  mutedFallback?: boolean
  /** Le message technique de l'echec, pour la console et pour l'utilisateur averti. */
  message?: string
  /** The rate the clip is encoded at, once the encoder is open (`encode` and `done`). */
  fps?: number
  /**
   * `true` = the 3D clip was meant for 60 fps and the browser refused that rate at this size: it
   * is encoded at 30, and the dialog SAYS so.
   */
  fpsFallback?: boolean
  /**
   * In `prepare`, once the sound work starts: which step runs (the offline MIX, then the AAC
   * ENCODING of its tracks) and its share done, 0..100. Kept apart from `pct`, which counts
   * encoded frames only.
   */
  prepareStep?: PrepareStep
}

export interface ReplayExport {
  /** `false` = pas de WebCodecs : c'est l'enregistrement temps réel qui reprend la main. */
  supported: boolean
  state: ReplayExportState
  /** La plage proposée par défaut : la fenêtre de gameplay entière. */
  defaultBounds: () => ExportBounds
  run: (bounds: ExportBounds, options?: ExportRunOptions) => Promise<void>
  /**
   * Dépose le clip de la phase `done` dans le dossier de téléchargements. Le CUIRE doit
   * l'appeler d'un clic : un clic sur une ancre déposé par le code, des minutes après le
   * dernier geste de l'utilisateur, n'a plus le geste derrière, et Chrome bloque le
   * second fichier non demandé d'un site. `no-op` hors `done` (rien à sauver, rien à
   * révoquer).
   */
  saveDone: () => void
  /**
   * Rend le clip sans le déposer : révocation de l'URL d'objet et retour à l'état inerte.
   * Appelé quand l'utilisateur ferme le dialogue sans avoir sauvé — un blob que plus
   * personne ne peut sauver doit être rendu au collecteur, pas retenu en mémoire.
   */
  discardDone: () => void
  /** Le palier de zoom de l'écran, relayé pour le dialogue (cf. `ReplayExportOptions.zoomLevel`). */
  zoomLevel: number
  cancel: () => void
  /**
   * L'HORLOGE DE MATCH d'une image, prête à afficher. Portée par l'export et non par le
   * dialogue : le recalage sur la fenêtre de gameplay demande le document ET la fenêtre, que
   * le dialogue n'a aucune raison de recevoir — et qui coûteraient deux props au canvas, déjà
   * à son plafond de taille.
   */
  clockOf: (frame: number) => string
  /** La durée du CLIP pour ces bornes, formatée. Même raison, même endroit. */
  lengthClock: (bounds: ExportBounds) => string
}

const IDLE: ReplayExportState = { phase: 'idle', done: 0, total: 0, pct: 0 }

/** Nombre d'images encodees avant de risquer une estimation : sous ce seuil, elle danserait. */
const ETA_MIN_FRAMES = 30

/** Les encres du thème, résolues UNE fois par export (cf. piège 2 de l'en-tête). */
function readOverlayInk(): OverlayInk {
  return {
    background: readInk('--background'),
    foreground: readInk('--foreground'),
    muted: readInk('--muted-foreground'),
    border: readInk('--border'),
    card: readInk('--card'),
  }
}

/** Les familles de police de la page. Le repli n'est atteint que si le thème perd ses vars. */
function readOverlayFonts(): OverlayFonts {
  const root = getComputedStyle(document.documentElement)
  const sans = root.getPropertyValue('--sans').trim()
  const mono = root.getPropertyValue('--mono').trim()
  return { sans: sans || 'system-ui, sans-serif', mono: mono || 'ui-monospace, monospace' }
}

/** Charge le filigrane et le TEINTE. `null` partout ailleurs : le panneau reste entier. */
async function loadTeamLogo(
  titleSlug: string,
  teamID: number | null | undefined,
  color: string,
): Promise<HTMLCanvasElement | null> {
  const src = teamLogoPath(titleSlug, teamID)
  if (!src) return null
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const el = new Image()
    el.onload = () => resolve(el)
    // Un `team_id` sans asset publié répond 404 : silence, pas de filigrane, pas d'erreur.
    el.onerror = () => resolve(null)
    el.src = src
  })
  return img ? tintedIconCanvas(img, color) : null
}

/** Prépare tout ce qui ne change pas d'une image à l'autre. Hors React : aucun état ici. */
async function buildSource(o: ReplayExportOptions, ink: OverlayInk): Promise<OverlayPanelSource> {
  // LA COULEUR EST CELLE QUE L'UTILISATEUR A RÉGLÉE (décision D1 du DOM) : l'écran de fin est
  // TOUJOURS celui de son camp, donc toujours `team-ally`, surchargeable par l'accessibilité.
  const teamColor = resolveToken('team-ally')
  const victory = readVictory(o.allegiance, o.outcome?.code, meXUIDOf(o.scoreboard), o.viewpoint)
  const logo = victory?.mine
    ? await loadTeamLogo(o.titleSlug, victory.mine.teamID, teamColor)
    : null
  const tint = { background: `color-mix(in oklab, ${teamColor} 22%, transparent)`, border: `color-mix(in oklab, ${teamColor} 55%, transparent)` }
  return buildOverlayPanelSource({
    doc: o.doc,
    scoreboard: o.scoreboard,
    allegiance: o.allegiance,
    playWindow: o.playWindow,
    outcome: o.outcome,
    viewpoint: o.viewpoint,
    locale: o.locale,
    ink,
    teamStyle: { background: tint.background, border: tint.border },
    logo,
  })
}

/**
 * Peint UNE image de l'export : le terrain, la surimpression s'il y en a une, puis le FOND.
 *
 * LE FOND SE POSE EN DERNIER, DESSOUS (`destination-over`). Le cadre 16:9 déborde la carte dès
 * que ses proportions diffèrent, et la toile y est TRANSPARENTE : H.264 n'a pas de canal alpha,
 * et ce que devient un pixel transparent dans une `VideoFrame` dépend du navigateur. Le fond est
 * donc PEINT, et il est NOIR PUR quel que soit le thème (`--replay-export-backdrop`, décision
 * D8) : un fichier ne change pas d'apparence selon la préférence d'interface de qui l'exporte.
 */
function paintExportFrame(
  canvas: HTMLCanvasElement,
  o: ReplayExportOptions,
  source: OverlayPanelSource,
  paint: OverlayPaintContext,
  frame: number,
): void {
  o.frameRef.current = frame
  o.redraw()
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  // LA MISE À L'ÉCHELLE SE REPOSE ICI, elle ne se suppose pas : `draw()` la pose au début de
  // son tracé, mais rien ne garantit dans quel état ses calques la laissent. MÊME DENSITÉ QUE LE
  // TRACÉ — celle du format : la surimpression se met en page dans le même cadre logique.
  const dpr = canvasPixelRatio()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  paintPanel(ctx, { width: canvas.width / dpr, height: canvas.height / dpr }, source, paint, frame)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = paint.backdrop
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.globalCompositeOperation = 'source-over'
}

/** Le panneau de l'image, s'il y en a un, dans le cadre logique (contexte déjà à la densité). */
function paintPanel(
  ctx: CanvasRenderingContext2D,
  view: { width: number; height: number },
  source: OverlayPanelSource,
  paint: OverlayPaintContext,
  frame: number,
): void {
  const panel = source.panelAt(frame)
  if (panel) paintOverlayPanel(ctx, view, panel, paint.fonts, paint.ink)
}

/** Peint l'image `frame` et rend la toile à encoder, once that frame is completely drawn. */
type FramePainter = (frame: number) => HTMLCanvasElement | Promise<HTMLCanvasElement>

/**
 * How many times one 3D frame may wait for loads and render again. A frame normally waits once
 * at most (a model it asked for); the bound only stops a loader that keeps starting new loads.
 */
const MAX_LOAD_WAITS = 4

/**
 * renderComplete renders the 3D frame `frame` and, while the scene still has loads in flight
 * that this frame asked for, waits for them and renders it AGAIN: a model landing one frame late
 * would otherwise pop in mid-clip. A timed-out wait is reported and the frame is kept.
 */
export async function renderComplete(
  paint: (frame: number) => HTMLCanvasElement,
  scene: Pick<Replay3DExportSource, 'exportPendingLoads'>,
  frame: number,
): Promise<HTMLCanvasElement> {
  let canvas = paint(frame)
  for (let i = 0; i < MAX_LOAD_WAITS; i++) {
    const pending = scene.exportPendingLoads()
    if (!pending) return canvas
    if (await pending) console.warn(`[replay-export] 3D loads still pending at frame ${frame}, encoding it as is`)
    canvas = paint(frame)
  }
  return canvas
}

/** La scène 3D prise pour l'export, et ce qu'on lui demande. */
interface Scene3dRun {
  scene: Replay3DExportSource
  format: ExportFormat
  view3d: Export3dOptions
}

/**
 * take3dScene prend la scène 3D de la page pour l'export (cf. `replay3dExportStore`). Lève si la
 * 3D demandée n'est plus chargée : l'export le dit, il ne sort pas une 2D à la place.
 */
function take3dScene(view3d: Export3dOptions, format: ExportFormat, frame: number, frameMs: number): Replay3DExportSource {
  const entry = replay3DExportEntry()
  if (!entry) throw new Error('3D view is not loaded')
  entry.source.beginExport({
    width: format.width,
    height: format.height,
    camera: view3d.camera,
    pov: view3d.pov,
    frame,
    frameMs,
  })
  return entry.source
}

/**
 * framePainter : la toile 2D de la page (carte, panneau, fond), ou la scène 3D composée par
 * `export3dFrame`, avec la carte 2D de la même image en mini-carte si elle est demandée.
 */
async function framePainter(
  canvas: HTMLCanvasElement,
  o: ReplayExportOptions,
  overlay: { source: OverlayPanelSource; paint: OverlayPaintContext },
  scene3d: Scene3dRun | null,
): Promise<FramePainter> {
  const { source, paint } = overlay
  if (!scene3d) {
    return (frame) => {
      paintExportFrame(canvas, o, source, paint, frame)
      return canvas
    }
  }
  // The followed player's HUD at the screen's level (`hudLevel`): first person draws the aim
  // (reticle, ADS overlays); both draw the place label from the areas the view already loaded.
  const scene = scene3d.scene
  const hud = scene3d.view3d.pov
    ? await createExportHud(o.doc, scene3d.view3d.pov, o.kills ?? [], o.playWindow, o.timeLimitMs ?? null, o.locale, {
        aim: scene3d.view3d.camera === 'fp',
        callouts: replay3DExportEntry()?.callouts ?? null,
        redReticle: scene.redReticle ? (frame, allegiance, held) => scene.redReticle?.(frame, allegiance, held) ?? false : undefined,
        frameSize: { width: scene3d.format.width, height: scene3d.format.height },
      })
    : null
  const painter = make3dPainter({
    source: scene3d.scene,
    format: scene3d.format,
    pixelRatio: canvasPixelRatio(),
    ink: { background: paint.ink.background, foreground: paint.ink.foreground },
    font: paint.fonts.sans,
    map2d: scene3d.view3d.minimap
      ? () => {
          o.redraw()
          return canvas
        }
      : null,
    overlay: (ctx, view, frame) => { hud?.(ctx, view, frame); paintPanel(ctx, view, source, paint, frame) },
  })
  return (frame) => {
    // L'image courante avance aussi en 3D : la barre de lecture et la carte 2D la suivent.
    o.frameRef.current = frame
    return renderComplete(painter, scene3d.scene, frame)
  }
}

export function useReplayExport(o: ReplayExportOptions): ReplayExport {
  const [state, setState] = useState<ReplayExportState>(IDLE)
  const cancelRef = useRef(false)
  const runningRef = useRef(false)
  // LE CLIP DE LA PHASE `done`, prêt à descendre mais PAS ENCORE DÉPOSÉ : le clic qui part
  // le téléchargement doit venir de l'utilisateur (cf. `saveDone`), et c'est `releaseDone`
  // qui le rend si le dialogue se ferme sans lui.
  const pendingRef = useRef<PendingDownload | null>(null)
  // LE DÉMONTAGE ANNULE, ET NE TÉLÉCHARGE RIEN. Même invariant que l'enregistrement temps réel
  // juste à côté (`useReplayCapture`, `liveRef`) : quitter la page d'un match pendant un export
  // ne doit pas déposer, trois minutes plus tard, le fichier d'un match qu'on a quitté.
  const liveRef = useRef(true)
  useEffect(() => {
    liveRef.current = true
    return () => {
      liveRef.current = false
      cancelRef.current = true
      // Un clip en attente d'être sauvé, sur une page qui se démonte : rendu, pas retenu.
      pendingRef.current?.release()
      pendingRef.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    cancelRef.current = true
  }, [])

  /** Rend le clip en attente : révocation de l'URL et retour à l'état inerte. */
  const releaseDone = useCallback(() => {
    pendingRef.current?.release()
    pendingRef.current = null
    setState(IDLE)
  }, [])

  const saveDone = useCallback(() => {
    pendingRef.current?.save()
  }, [])

  const discardDone = useCallback(() => {
    releaseDone()
  }, [releaseDone])

  const defaultBounds = useCallback(
    () => defaultExportBounds(o.doc, o.playWindow),
    [o.doc, o.playWindow],
  )

  const run = useCallback(
    async (bounds: ExportBounds, options?: ExportRunOptions) => {
      const canvas = o.canvasRef.current
      // `runningRef` est posé SYNCHRONEMENT, avant le moindre `await` : c'est ce qui rend le
      // double-clic sur « Exporter » inoffensif.
      if (!canvas || runningRef.current || !canExportVideo()) return
      runningRef.current = true
      cancelRef.current = false
      // Un clip de l'export PRÉCÉDENT peut être encore retenu (dialogue fermé sans Sauver ni
      // Refermer, puis un nouvel export) : le rendre maintenant, sinon l'ancien blob fuirait en
      // mémoire jusqu'à la fermeture de l'onglet.
      pendingRef.current?.release()
      pendingRef.current = null
      o.pause()
      // L'IMAGE D'AVANT L'EXPORT est mise de côté MAINTENANT : la boucle va écrire `frameRef`
      // des milliers de fois, et l'utilisateur doit retrouver son rejeu où il l'avait laissé.
      const resume = o.frameRef.current
      const format = exportFormatOf(options?.format)
      const view3d = options?.view3d ?? null
      // THE RATE: 60 for the 3D view, 30 for the 2D map (cf. `EXPORT_FPS_3D`). The encoder may
      // refuse 60 at this size; it then falls back to 30 and the dialog says so.
      const wantedFps = view3d ? EXPORT_FPS_3D : EXPORT_FPS
      // Un premier plan SANS maintien : il donne la duree de la plage, dont le mixage a besoin.
      let plan = buildExportPlan(bounds, o.doc, wantedFps)
      // PHASE 1 : la preparation. La barre n'affiche pas « image 0 » — elle dit ce qu'on fait.
      setState({ phase: 'prepare', done: 0, total: plan.frames.length, pct: 0 })
      let sink: VideoExportSink | null = null
      // La scène 3D prise pour l'export, rendue à l'écran dans le `finally`.
      let scene3d: Replay3DExportSource | null = null
      try {
        // LA TOILE EST TENUE DÈS LE DÉBUT DE LA PRÉPARATION (décision D7) : la demande éteint les
        // gestes de cadrage et le survol tout de suite, pas seulement une fois les sons décodés —
        // un zoom glissé pendant la préparation changerait sinon le cadrage du clip.
        requestExportLayout(exportLayoutFor(format, options?.framing))
        // Les polices AVANT la première image : sans cette attente, le début du clip écrirait
        // les surimpressions dans une police de repli, et le reste dans la bonne.
        await document.fonts.ready
        // LES ENCRES SE LISENT APRÈS LA DEMANDE : elles sont alors celles du THÈME SOMBRE (décision
        // D9, cf. `themeInk.ts`), comme celles de la scène que React re-résout au même moment.
        const ink = readOverlayInk()
        const fonts = readOverlayFonts()
        const backdrop = readInk('--replay-export-backdrop')
        const source = await buildSource(o, ink)
        // LE SON SE MIXE AVANT D'OUVRIR LE CONTENEUR : le MP4 annonce ses pistes une fois pour
        // toutes, donc il faut savoir AVANT s'il y en aura une. Le mixage hors ligne est rapide
        // (il ne joue rien, il calcule), et il rend `null` s'il n'y a rien a mixer.
        // LA TOILE PASSE AU FORMAT DU FICHIER (2026-09-16) : mise en page dans le cadre 16:9 du
        // format et rendu a sa densite (`exportLayoutFor`), l'ecran et son `devicePixelRatio`
        // n'entrent plus nulle part. La mise en page (demandee en tete du `try`) passe par un rendu
        // React : on ATTEND que la toile soit reellement au format avant d'ouvrir l'encodeur —
        // d'ou l'ordre : demande, attente, ouverture.
        await waitForExportLayout(canvas, format, o.redraw)
        const mix = options?.sound === false ? null : await mixExportAudio(o, bounds, plan, view3d, {
          cancelled: () => cancelRef.current,
          progress: prepareProgress(setState, plan.frames.length, 'mix'),
        })
        if (cancelRef.current) return void setState(IDLE) // Cancel during the preparation (the mix reads it at each step and stops): stop before encoding; `finally` restores.
        // Le maintien (cf. `holdMsFor`) ne dépend que de durées : il se calcule sur le premier plan.
        const holdMs = holdMsFor(o, bounds, plan, mix)
        sink = await openVideoExport({
          width: format.width,
          height: format.height,
          fps: wantedFps,
          fallbackFps: view3d ? EXPORT_FPS : undefined,
          audioTracks: mix ? trackNames(mix, o.locale) : undefined,
        })
        if (!sink) {
          // Configuration refusée par le navigateur : ce n'est pas une panne, c'est une
          // capacité absente — mais l'utilisateur doit le voir, pas regarder une barre
          // disparaître sans un mot.
          fail(setState, 'Video configuration rejected by the browser')
          return
        }
        // LE PLAN SE REFAIT À LA CADENCE QUE L'ENCODEUR A ACCEPTÉE, avec le maintien : la
        // derniere image doit tenir assez longtemps pour qu'on lise le verdict, et au moins
        // aussi longtemps que le son continue. The file timestamps are `index / fps`, so the plan
        // and the encoder MUST share one rate, or the clip would play at the wrong speed.
        const fps = sink.fps
        const fpsFallback = sink.fpsFallback
        plan = buildExportPlan(bounds, o.doc, fps, holdMs)
        // LE SON DEMANDE MAIS IMPOSSIBLE NE SE TAIT PAS : le navigateur peut avoir l'API et
        // REFUSER la configuration AAC. Le clip sort muet — mieux qu'un export perdu — et la
        // phase finale le dit.
        const muet = mix !== null && !sink.audioEnabled
        if (muet) console.warn('[replay-export] Audio track rejected by the browser, clip is silent')
        if (mix && sink.audioEnabled) {
          await sink.addAudioTracks(exportTracks(mix, o.locale), prepareProgress(setState, plan.frames.length, 'audio'))
        }
        // La scène 3D n'est prise qu'ici, au dernier moment : la vue d'écran reste vivante pendant
        // la préparation.
        if (view3d) scene3d = take3dScene(view3d, format, bounds.startFrame, frameToMs(1, o.doc))
        const painter = await framePainter(
          canvas,
          o,
          { source, paint: { ink, fonts, backdrop } },
          scene3d && view3d ? { scene: scene3d, format, view3d } : null,
        )
        // PHASE 2 : l'encodage. C'est seulement ici que le compte d'images veut dire quelque
        // chose, et que le temps restant peut s'estimer.
        const total = plan.frames.length
        const debut = performance.now()
        setState({ phase: 'encode', done: 0, total, pct: 0, fps, fpsFallback })
        const ok = await encodeAll(painter, plan.frames, {
          cancelled: () => cancelRef.current,
          progress: (done) =>
            setState({
              phase: 'encode',
              done,
              total,
              pct: exportProgressPct(done, total),
              etaMs: etaFor(done, total, performance.now() - debut),
              fps,
              fpsFallback,
            }),
          sink,
        })
        const clip = ok ? await sink.finish() : null
        // `sink` n'est lâché QUE si `finish()` l'a refermé. Sur annulation il reste ici, et
        // c'est le `finally` qui l'abandonne — sans quoi l'encodeur et son muxeur restaient
        // ouverts après un clic sur « Annuler ».
        if (ok) sink = null
        // LE DÉMONTAGE NE TÉLÉCHARGE PAS : le clip est assemblé (l'encodeur doit être vidé
        // proprement quoi qu'il arrive) mais il ne part pas vers un onglet qui a changé de page.
        const filename = exportFilename(o, bounds)
        // LE CLIP EST ASSEMBLÉ, MAIS RIEN NE PART : des minutes après le clic d'export, un
        // clic sur une ancre déposé par le code n'a plus le geste derrière, et Chrome bloque
        // le second fichier non demandé d'un site. Le clip attend le bouton « Sauvegarder »
        // de la phase `done` — et c'est la fermeture du dialogue, PAS ce `finally`, qui le
        // rend s'il n'est pas sauvé. Le `finally` ne rend que ce qui est encore EN ATTENTE
        // d'un export en cours (erreur, annulation) : en finir ici, sur le chemin réussi,
        // tuerait le téléchargement enclenché par un clic qui vient de se produire.
        if (clip) pendingRef.current = liveRef.current ? holdDownload(clip, filename) : null
        if (!clip) pendingRef.current?.release()
        if (!clip) pendingRef.current = null
        // PHASE 3 : le fichier est PRÊT, et on le DIT avec son nom. Une annulation, elle,
        // ramene au formulaire — il n'y a rien a annoncer d'un geste qu'on vient de faire.
        setState(clip ? { phase: 'done', done: total, total, pct: 100, filename, save: pendingRef.current ?? undefined, mutedFallback: muet, fps, fpsFallback } : IDLE)
      } catch (err) {
        // JAMAIS D'ÉCHEC MUET (règle 3 du dépôt : logger AVANT toute dégradation). Sans ce
        // bloc, une panne d'encodeur faisait disparaître la barre de progression sans un mot,
        // sans fichier et sans trace — et laissait l'encodeur ouvert jusqu'à la fermeture de
        // l'onglet.
        console.error('[replay-export] Export interrupted', err)
        fail(setState, err instanceof Error ? err.message : String(err))
      } finally {
        // LA MISE EN PAGE D'ECRAN REVIENT, sur TOUS les chemins : laissee en place, la page
        // resterait dessinee au cadre du format jusqu'au prochain remontage. Le trace ci-dessous
        // repose l'image d'avant ; le rendu React qui suit la repeint a la taille de l'ecran.
        requestExportLayout(null)
        scene3d?.endExport()
        // L'ENCODEUR SE REFERME SUR TOUS LES CHEMINS : `sink` n'est remis à `null` qu'une fois
        // le fichier assemblé. S'il est encore là, c'est qu'on sort par une erreur ou une
        // annulation, et il retient un muxeur entier en mémoire.
        sink?.abort()
        runningRef.current = false
        o.frameRef.current = resume
        o.redraw()
      }
    },
    [o],
  )

  const clockOf = useCallback(
    (frame: number) => formatClock(displayClockMs(frameToMs(frame, o.doc), o.playWindow)),
    [o.doc, o.playWindow],
  )
  const lengthClock = useCallback(
    (b: ExportBounds) => formatClock(frameToMs(b.endFrame, o.doc) - frameToMs(b.startFrame, o.doc)),
    [o.doc],
  )

  const zoomLevel = o.zoomLevel ?? 1
  return { supported: canExportVideo(), state, defaultBounds, run, saveDone, discardDone, cancel, clockOf, lengthClock, zoomLevel }
}

/**
 * fail pose l'état d'échec. L'export s'arrête, mais le dialogue RESTE ouvert et le dit — c'est
 * la seule différence qui compte entre « ça n'a pas marché » et « il ne s'est rien passé ».
 */
function fail(setState: (s: ReplayExportState) => void, message: string): void {
  setState({ phase: 'failed', done: 0, total: 0, pct: 0, message })
}

/**
 * prepareProgress publishes a sound step's progress in the `prepare` phase, once per whole
 * percent: the mix reports every two seconds of track, far more often than the bar can show.
 */
function prepareProgress(
  setState: (s: ReplayExportState) => void,
  total: number,
  stage: PrepareStep['stage'],
): (fraction: number) => void {
  let shown = -1
  return (fraction) => {
    const pct = Math.min(100, Math.floor(fraction * 100))
    if (pct === shown) return
    shown = pct
    setState({ phase: 'prepare', done: 0, total, pct: 0, prepareStep: { stage, pct } })
  }
}

/**
 * etaFor estime le temps restant depuis la cadence DEJA constatee.
 *
 * `undefined` sous `ETA_MIN_FRAMES` : une estimation batie sur trois images danserait d'un
 * facteur dix a chaque rafraichissement, et une estimation qui saute est pire que pas
 * d'estimation.
 */
function etaFor(done: number, total: number, elapsedMs: number): number | undefined {
  if (done < ETA_MIN_FRAMES || elapsedMs <= 0) return undefined
  return Math.max(0, Math.round((elapsedMs / done) * (total - done)))
}

/**
 * Les deux moities de la peinture, REGROUPEES : elles voyagent toujours ensemble, et les
 * separer poussait quatre signatures a six parametres (seuil du depot : cinq).
 */
interface OverlayPaintContext {
  ink: OverlayInk
  fonts: OverlayFonts
  /** Le fond de la vidéo, sous toute l'image (cf. `paintExportFrame`). */
  backdrop: string
}

/** Ce dont la boucle a besoin en plus des images : où pousser, et quand s'arrêter. */
interface EncodeHooks {
  cancelled: () => boolean
  progress: (done: number) => void
  sink: { addFrame: (c: HTMLCanvasElement, i: number) => Promise<void> }
}

/**
 * encodeAll parcourt le plan. HORS du hook (règle des 80 lignes du dépôt) et hors React : elle
 * ne touche à aucun état, elle publie par rappel.
 *
 * Rend `false` si l'utilisateur a annulé — c'est ce qui décide, chez l'appelant, entre remettre
 * un fichier et n'en remettre aucun.
 */
async function encodeAll(
  paint: FramePainter,
  frames: readonly number[],
  hooks: EncodeHooks,
): Promise<boolean> {
  for (let i = 0; i < frames.length; i++) {
    if (hooks.cancelled()) return false
    // The frame is complete before it is handed over (`renderComplete` in 3D): `addFrame` reads
    // the canvas as it is, and the index alone gives its timestamp.
    await hooks.sink.addFrame(await paint(frames[i]), i)
    if (i % PROGRESS_EVERY !== 0) continue
    hooks.progress(i)
    // LA MAIN REVIENT À LA PAGE ICI, et par le canal non bridé : sans cela la barre de
    // progression ne se peindrait jamais, et « Annuler » ne serait jamais lu.
    await yieldToEvents()
  }
  hooks.progress(frames.length)
  return true
}

/**
 * exportFilename nomme le clip sur SES DEUX BORNES (décision D9 du plan).
 *
 * `filenameFor` de la capture ne connaît qu'un instant — celui de `frameRef`, qui vaut la borne
 * de FIN au moment où le fichier part. Deux exports de plages différentes qui partagent leur
 * fin porteraient alors le même nom et s'écraseraient dans le dossier de téléchargements.
 */
function exportFilename(o: ReplayExportOptions, bounds: ExportBounds): string {
  return buildCaptureFilename(
    o.doc.matchId,
    frameToMs(bounds.startFrame, o.doc),
    'mp4',
    new Date(),
    frameToMs(bounds.endFrame, o.doc),
  )
}

/**
 * mixExportAudio rend la piste sonore de la plage, ou `null` s'il n'y a rien à mixer.
 *
 * LES BORNES PASSENT EN MILLISECONDES DE FILM, pas en images : la piste sonore est horodatée
 * sur l'horloge du rejeu (celle du fil et des fiches), jamais sur l'axe des images.
 */
async function mixExportAudio(
  o: ReplayExportOptions,
  bounds: ExportBounds,
  plan: ExportPlan,
  view3d: Export3dOptions | null,
  hooks: RenderHooks,
): Promise<MixedTracks | null> {
  // LA PISTE SE LIT ICI, au lancement : elle porte des reglages d'instance qui vivent dans des
  // refs, et les lire au rendu rendrait des valeurs arbitraires.
  const track = o.soundTrack?.()
  // Une piste sans événement mais avec un MOTEUR de véhicule dans la plage se mixe quand même.
  if (!track || (track.timeline.length === 0 && track.engines.length === 0)) return null
  // L'AUDITEUR DU MIX : le clip 3D suit un joueur, c'est lui qui écoute (position et cap à
  // chaque instant, cf. `soundListenerOf`) — le son du clip doit entendre ce que ses images
  // montrent. Un export 2D n'a pas d'auditeur, comme la page en 2D : le mix reste tel qu'avant.
  const pov = view3d ? (view3d.pov ?? o.viewpoint) : null
  const startMs = frameToMs(bounds.startFrame, o.doc)
  return mixReplayAudio(
    track.timeline,
    { startMs, endMs: startMs + plan.durationMs },
    {
      variationPercent: track.variationPercent,
      distancePercent: track.distancePercent,
      // LA CONCLUSION N'EST FOURNIE QUE SI LA PLAGE ATTEINT VRAIMENT LA FIN DU MATCH. Sans
      // cette garde, un extrait des minutes 2 a 4 se terminait sur la voix d'annonceur et la
      // fanfare de victoire : le son affirmait un fait faux sur l'extrait.
      endMatchStems: reachesMatchEnd(o, bounds) ? track.endMatchStems : [],
      families: track.families,
      engines: track.engines,
      listenerAt: pov ? listenerAtOfPlayer(o.doc, pov) : undefined,
      volume: o.soundVolume ?? 1,
      urlOf: soundUrlOf,
      trimToBounds: !reachesMatchEnd(o, bounds),
      hooks,
    },
  )
}

/**
 * holdMsFor — combien de temps la DERNIERE image doit rester a l'ecran, apres la plage.
 *
 * DEUX RAISONS, et on prend la plus longue. (1) L'ecran de fin de match ne se peint qu'A la
 * borne : sans maintien, le clip se terminait sur un eclair de 1/30 s de verdict. (2) Le son
 * deborde souvent la borne — une fanfare de fin dure jusqu'a 11 s — et une piste sonore qui
 * joue apres la derniere image laisse le lecteur sur un ecran mort.
 *
 * Aucune des deux ne s'applique a un extrait muet de milieu de match : il s'arrete net, ce qui
 * est le comportement attendu d'un extrait.
 */
function holdMsFor(
  o: ReplayExportOptions,
  bounds: ExportBounds,
  plan: ExportPlan,
  mix: MixedTracks | null,
): number {
  const verdict = reachesMatchEnd(o, bounds) ? END_HOLD_MS : 0
  const son = mix ? mix.full.duration * 1000 - plan.durationMs : 0
  return Math.max(verdict, son, 0)
}

/**
 * reachesMatchEnd — la plage va-t-elle jusqu'au bout du MATCH ?
 *
 * Sans fenetre de gameplay etablie, on ne sait pas ou le match finit : on repond NON. Poser une
 * fanfare de victoire sur une plage dont on ignore si elle est la fin serait affirmer ce qu'on
 * ne sait pas.
 */
function reachesMatchEnd(o: ReplayExportOptions, bounds: ExportBounds): boolean {
  if (!o.playWindow) return false
  return bounds.endFrame >= o.playWindow.endFrame
}

/**
 * LE NOM DES PISTES, ET LEUR ORDRE. Le MIXAGE COMPLET EN PREMIER — c'est la seule que joue un
 * lecteur ordinaire, et un navigateur n'expose meme pas les autres. Les familles suivent, pour
 * qui ouvre le clip dans un montage.
 */
function exportTracks(mix: MixedTracks, locale: ReplayLocale): { name: string; buffer: AudioBuffer }[] {
  const t = REPLAY_TEXT[locale]
  const nom: Record<SoundFamily, string> = {
    sfx: t.exportTrackSfx,
    voice: t.exportTrackVoice,
    music: t.exportTrackMusic,
  }
  return [
    { name: t.exportTrackMix, buffer: mix.full },
    ...mix.families.map((f) => ({ name: nom[f.family], buffer: f.buffer })),
  ]
}

/** Les seuls NOMS, pour declarer les pistes avant d'avoir quoi que ce soit a y ecrire. */
function trackNames(mix: MixedTracks, locale: ReplayLocale): string[] {
  return exportTracks(mix, locale).map((p) => p.name)
}
