import { useEffect, useState, type RefObject } from 'react'
import { tokenCssVar } from '@/lib/accessibility/semantic-tokens'

import type { EtatCadence } from '../model/cadenceImages_logic'
import { lireCadence } from '../model/cadenceImages_logic'
import { formaterProfil, type ProfilRendu } from '../scene3d/profilRendu3d'
import type { ReplayLocale } from '../i18n/i18n'
import { SCENE3D_TEXT } from '../i18n/scene3dText'
import { persistPreference, readStoredFlag } from '../settings/replayPreferences'

/** La préférence « lignes de mesure affichées » (ce navigateur) ; masquées par défaut. */
const CADENCE_KEY = 'replay-3d-cadence'
/** La touche qui affiche ou masque les lignes de mesure. */
const CADENCE_TOUCHE = '`'

/** saisieEnCours : la frappe vise un champ de saisie, la touche lui appartient. */
function saisieEnCours(cible: EventTarget | null): boolean {
  return cible instanceof HTMLElement && (cible.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(cible.tagName))
}

/**
 * ReplayCadence3d — la cadence des images de l'écran, lue sur la boucle de rendu. Masquée par
 * défaut : la touche `CADENCE_TOUCHE` l'affiche ou la masque, et le choix est retenu.
 *
 * Le ref d'état est rempli par la boucle (une mesure par image, sans allocation) ; ce composant
 * ne fait que le relire quatre fois par seconde : pas de `setState` par image, pas de
 * remontée dans la vue. `null` tant que l'anneau n'a pas assez d'images : on ne montre rien.
 */
export function ReplayCadence3d({ etatRef, profil, locale }: { etatRef: RefObject<EtatCadence | null>; profil: () => ProfilRendu | null; locale: ReplayLocale }) {
  const t = SCENE3D_TEXT[locale]
  const [ligne, setLigne] = useState<string | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [montre, setMontre] = useState(() => readStoredFlag(CADENCE_KEY, false))
  useEffect(() => {
    const basculer = (e: KeyboardEvent) => {
      if (e.key !== CADENCE_TOUCHE || e.ctrlKey || e.altKey || e.metaKey || saisieEnCours(e.target)) return
      setMontre((v) => {
        persistPreference(CADENCE_KEY, String(!v))
        return !v
      })
    }
    window.addEventListener('keydown', basculer)
    return () => window.removeEventListener('keydown', basculer)
  }, [])
  useEffect(() => {
    if (!montre) return
    const lire = () => {
      setLigne(formaterCadence(etatRef.current, t))
      const p = profil()
      setDetail(p ? formaterProfil(p) : null)
    }
    lire()
    const minuteur = setInterval(lire, 250)
    return () => clearInterval(minuteur)
  }, [etatRef, profil, t, montre])
  if (!montre || !ligne) return null
  return (
    <div
      className="pointer-events-none absolute right-3 top-12 select-all text-right font-mono text-xs"
      style={{ color: tokenCssVar('replay-hud-on-dark'), fontVariantNumeric: 'tabular-nums', textShadow: '0 1px 2px var(--replay-hud-shadow)' }}
    >
      <div>{ligne}</div>
      {detail && <div>{detail}</div>}
    </div>
  )
}

function formaterCadence(etat: EtatCadence | null, t: (typeof SCENE3D_TEXT)[ReplayLocale]): string | null {
  if (!etat) return null
  const lecture = lireCadence(etat)
  if (!lecture) return null
  return `${lecture.ips} ${t.cadenceIps} · ${lecture.moyenneMs.toFixed(1)} ms · ${t.cadencePire} ${lecture.pireMs.toFixed(1)} ms · js ${lecture.travailMs.toFixed(1)} ms`
}
