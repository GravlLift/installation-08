// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useViewGripTuner — le réglage au clavier de l'arme en 1re personne (viewGrip3d), sur le poste de
 * développement seulement et en 1re personne : chaque pas déplace la tenue du modèle que le joueur
 * suivi a en main, et rend la ligne de la table à reporter dans le code, copiée dans le
 * presse-papiers (useCopyToClipboard) et journalisée. Le rig animé (rig : true) a sa propre table
 * (`RIG_GRIPS`) : la ligne rend alors le bloc de TOUTES ses armes déjà réglées, triées par clé.
 */
import { useEffect, useState, type RefObject } from 'react'

import { useCopyToClipboard } from '@/lib/clipboard/useCopyToClipboard'

import { isTypingTarget } from '../hooks/useReplayShortcuts'
import type { ReplayScene3d } from '../scene3d/replayScene3d'
import { formatRigGrips, formatViewGrip, rigGripStep, tuneRigGrip, tuneViewGrip, viewGripStep } from '../scene3d/viewGrip3d'

export interface ViewGripLine {
  line: string
  copied: boolean
}

export function useViewGripTuner(sceneRef: RefObject<ReplayScene3d | null>, enabled: boolean): ViewGripLine | null {
  const [line, setLine] = useState<string | null>(null)
  const { copy, copied } = useCopyToClipboard()
  useEffect(() => {
    if (!import.meta.env.DEV || !enabled) return
    const noms = new Map<string, string>()
    function onKeyDown(e: KeyboardEvent) {
      if (!e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return
      const held = sceneRef.current?.inView
      if (!held) return
      if (held.rig) {
        const step = rigGripStep(e.code, e.shiftKey)
        if (!step) return
        e.preventDefault()
        noms.set(held.key, held.name)
        tuneRigGrip(held.key, step)
        const bloc = formatRigGrips(noms)
        console.info('rejeu 3D : rig 1re personne', bloc)
        setLine(bloc)
        void copy(bloc)
      } else {
        const step = viewGripStep(e.code, e.shiftKey)
        if (!step) return
        e.preventDefault()
        const next = formatViewGrip(held.key, held.name, tuneViewGrip(held.key, step))
        console.info('rejeu 3D : arme en 1re personne', next)
        setLine(next)
        void copy(next)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sceneRef, enabled, copy])
  return enabled && line !== null ? { line, copied } : null
}
