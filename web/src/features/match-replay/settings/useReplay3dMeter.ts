// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useReplay3dMeter — whether the 3D view shows its playback meter (`ReplayCadence3d`): the film's
 * displayed frames per second, the real-time ratio and the render cost.
 *
 * Persisted like the lighting settings (`usePersistedFlag`) and shared by key: the drawer's toggle
 * and the view's ` key flip the same flag. Off by default.
 */
import { usePersistedFlag } from './useReplaySettings'

/** The key predates the drawer toggle (the ` key wrote it alone): kept so the choice carries over. */
export const METER_KEY = 'replay-3d-cadence'

export function useReplay3dMeter(): [boolean, () => void] {
  return usePersistedFlag(METER_KEY, false)
}
