/**
 * useReplay3dFov — LE RÉGLAGE DE CHAMP DU JEU de la vue 3D (70 à 120, degrés horizontaux à
 * 16:9), persisté comme les réglages d'éclairage (`useReplay3dLook`) et partagé par clé : le
 * tiroir le change, la vue 3D le lit de son côté et le tourne en champ vertical de base
 * (`model/fovLogic`).
 */
import { useCallback, useEffect, useState } from 'react'

import { GAME_FOV_DEFAULT, GAME_FOV_MAX, GAME_FOV_MIN } from '../model/fovLogic'
import { persistPreference, readStoredNumber, subscribePreference } from './replayPreferences'

const FOV_KEY = 'replay-3d-fov'

/** Les bornes du réglage, bornes comprises : un nombre entier entre elles est un champ du jeu. */
function estChampDeJeu(valeur: number): boolean {
  return valeur >= GAME_FOV_MIN && valeur <= GAME_FOV_MAX
}

export interface Replay3dFov {
  /** Le réglage de champ du jeu, en degrés horizontaux à 16:9. */
  fov: number
  setFov: (fov: number) => void
}

export function useReplay3dFov(): Replay3dFov {
  const [fov, setFovState] = useState(() => readStoredNumber(FOV_KEY, GAME_FOV_DEFAULT, estChampDeJeu))
  // L'abonnement rend la clé partageable : le curseur du tiroir et la vue 3D bougent ensemble.
  useEffect(() => subscribePreference(FOV_KEY, (raw) => {
    const valeur = Number(raw)
    if (Number.isFinite(valeur) && estChampDeJeu(valeur)) setFovState(valeur)
  }), [])
  const setFov = useCallback((next: number) => {
    const valeur = Math.round(next)
    if (!estChampDeJeu(valeur)) return
    setFovState(valeur)
    persistPreference(FOV_KEY, String(valeur))
  }, [])
  return { fov, setFov }
}
