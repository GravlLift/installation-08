/**
 * replay3dExportStore.ts — LA SCÈNE 3D CHARGÉE, prêtée à l'export vidéo.
 *
 * La vue 3D (`Replay3DView`, chargée à la demande avec three.js) s'inscrit ici quand sa carte est
 * prête ; l'export et sa boîte de dialogue la lisent. Ce module ne porte que des types : le paquet
 * de la page n'embarque pas three.js pour autant.
 *
 * L'export PREND la scène affichée plutôt que d'en construire une seconde : la carte pèse des
 * centaines de Mio en mémoire graphique, et ses textures de rendu (ombres, environnement)
 * appartiennent au contexte WebGL qui les a créées. Pendant l'export, la scène rend à la taille du
 * fichier avec la caméra et le joueur suivi choisis, et la vue d'écran se tait ; à la fin, tout
 * revient (`endExport`). Une seule vue 3D par page.
 */
import { useSyncExternalStore } from 'react'

import type { CameraMode3d } from '../scene3d/replayScene3d'

/** Le réglage d'un export 3D : la taille du fichier, la caméra et le joueur suivi. */
export interface Export3dSetup {
  width: number
  height: number
  camera: CameraMode3d
  pov: string | null
  /** La première image du clip : la caméra libre prise pour l'export se pose là. */
  frame: number
  /**
   * Milliseconds of match per document frame (`doc.frameIntervalMs`). During the export the
   * scene's time-based motion (third-person spring arm, clouds) runs on MATCH time derived from
   * the posed frames, never on the wall clock, which in an offline export measures render cost.
   */
  frameMs: number
}

/** Une étiquette de joueur projetée dans l'image exportée, en pixels du fichier. */
export interface ExportTag3d {
  x: number
  y: number
  name: string
  /** Couleur du joueur, déjà résolue en chaîne CSS (une toile ne lit pas les variables du thème). */
  color: string
}

/** Ce que la scène prête à l'export. */
export interface Replay3DExportSource {
  readonly players: readonly { xuid: string; name: string }[]
  /** Prend la scène : rendu à la taille du fichier, caméra et joueur suivi posés, vue d'écran muette. */
  beginExport(setup: Export3dSetup): void
  /** Pose l'image `frame` et la rend. La toile rendue ne se lit que dans la même tâche. */
  exportFrame(frame: number): HTMLCanvasElement
  /** Les étiquettes visibles de la dernière image rendue. */
  exportTags(): readonly ExportTag3d[]
  /**
   * Null when nothing the scene draws is still loading; otherwise a promise that resolves once
   * the pending loads (weapon models, armor, first-person rigs a frame just asked for) settled,
   * with `true` if it gave up waiting. The export then renders the frame AGAIN, so that no frame
   * is encoded with a model missing because it was still in flight.
   */
  exportPendingLoads(): Promise<boolean> | null
  /** Rend la scène à la vue d'écran (taille, caméra, joueur suivi). */
  endExport(): void
}

/** L'inscription de la vue : la scène, et l'état de l'écran qui sert de défaut au dialogue. */
export interface Replay3DExportEntry {
  source: Replay3DExportSource
  /** La 3D est à l'écran : l'export propose la 3D par défaut. */
  live: boolean
  camera: CameraMode3d
  pov: string | null
}

let entry: Replay3DExportEntry | null = null
const listeners = new Set<() => void>()

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function snapshot(): Replay3DExportEntry | null {
  return entry
}

/** Inscrit la vue 3D ; rend la désinscription (sans effet si une autre inscription l'a remplacée). */
export function registerReplay3DExport(next: Replay3DExportEntry): () => void {
  entry = next
  for (const fn of listeners) fn()
  return () => {
    if (entry !== next) return
    entry = null
    for (const fn of listeners) fn()
  }
}

/** La vue 3D inscrite, `null` sans carte 3D chargée. */
export function replay3DExportEntry(): Replay3DExportEntry | null {
  return entry
}

/** Même lecture, et un re-rendu à chaque inscription. */
export function useReplay3DExport(): Replay3DExportEntry | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
