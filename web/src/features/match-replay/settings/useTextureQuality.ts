// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useTextureQuality — the viewer's texture-quality preference: Standard (the default) or High.
 *
 * It is a VIEWER choice, persisted per browser like the other replay preferences
 * (`replayPreferences.ts`), and it is NOT a display layer: it changes which map-mesh and
 * variant files the server serves, so it threads through the mesh/variant requests
 * (`standalone.ts`, `useMeshBuild`, `useVariantLayer`) rather than the display settings
 * (`useReplaySettings`). The drawer renders it; the match view reads it to build its URLs.
 *
 * Reads and writes are wrapped by `replayPreferences`'s try/catch, so a refused or unavailable
 * storage degrades to the in-session value and the default (Standard) without an error.
 */
import { useCallback, useEffect, useState } from 'react'

import {
  persistPreference,
  readStoredChoice,
  subscribePreference,
} from './replayPreferences'

/** The two texture qualities the server builds, in the order the drawer offers them. */
export type TextureQuality = 'standard' | 'high'
export const TEXTURE_QUALITIES: readonly TextureQuality[] = ['standard', 'high']

/** The storage key; absent or out of the set means Standard (the pre-quality default). */
const TEXTURE_QUALITY_KEY = 'replay-texture-quality'
const TEXTURE_QUALITY_DEFAULT: TextureQuality = 'standard'

export interface UseTextureQualityResult {
  quality: TextureQuality
  setQuality: (quality: TextureQuality) => void
}

export function useTextureQuality(): UseTextureQualityResult {
  const [quality, setQualityState] = useState<TextureQuality>(() =>
    readStoredChoice(TEXTURE_QUALITY_KEY, TEXTURE_QUALITY_DEFAULT, TEXTURE_QUALITIES),
  )
  // The subscription lets two readers of the same key (the drawer and the match view) move
  // together in one session, the same way the display settings and sound do.
  useEffect(() => subscribePreference(TEXTURE_QUALITY_KEY, (raw) => setQualityState(raw as TextureQuality)), [])
  const setQuality = useCallback((next: TextureQuality) => {
    setQualityState(next)
    persistPreference(TEXTURE_QUALITY_KEY, next)
  }, [])
  return { quality, setQuality }
}
