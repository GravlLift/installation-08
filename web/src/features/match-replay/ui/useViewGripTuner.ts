// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useViewGripTuner — keyboard tuning of the first-person weapon grip (viewGrip3d), on the dev
 * machine only and in first person: each step moves the held model's grip on the followed
 * player, and renders the table line to copy back into the code, copied to the clipboard
 * (useCopyToClipboard) and logged. The animated rig (rig: true) has its own table
 * (`RIG_GRIPS`): the line then renders the block of ALL its already-tuned weapons, sorted by key.
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
    const names = new Map<string, string>()
    function onKeyDown(e: KeyboardEvent) {
      if (!e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return
      const held = sceneRef.current?.inView
      if (!held) return
      if (held.rig) {
        const step = rigGripStep(e.code, e.shiftKey)
        if (!step) return
        e.preventDefault()
        names.set(held.key, held.name)
        tuneRigGrip(held.key, step)
        const block = formatRigGrips(names)
        console.info('3D replay: first-person rig', block)
        setLine(block)
        void copy(block)
      } else {
        const step = viewGripStep(e.code, e.shiftKey)
        if (!step) return
        e.preventDefault()
        const next = formatViewGrip(held.key, held.name, tuneViewGrip(held.key, step))
        console.info('3D replay: first-person weapon', next)
        setLine(next)
        void copy(next)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sceneRef, enabled, copy])
  return enabled && line !== null ? { line, copied } : null
}
