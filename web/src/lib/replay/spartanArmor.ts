/**
 * spartanArmor.ts — standalone stand-in for LevelUp's `lib/replay/spartanArmor`.
 *
 * The data shapes (mirroring `domain.ReplaySpartans` server-side) are unchanged from
 * LevelUp. What changes is `useReplaySpartans`: LevelUp's version is a TanStack Query
 * hook gated by a deployment capability and the app's title store. This viewer has
 * neither — it is a plain `fetch`-backed hook against the path the caller gives it
 * (`ReplayArmorSource`), and when that route does not exist (this standalone build ships
 * no backend yet) it simply keeps `data` undefined, which is exactly how the 3D view
 * already degrades when armor is unavailable (plain-colored Spartans, no per-player skin).
 */
import { useEffect, useRef, useState } from 'react'

import { api } from '@/lib/api/client'

/** The permutation kept for a region; `source` names the step that set it last. */
export interface SpartanArmorRegion {
  region: number
  permutation: number
  region_key: string
  permutation_key: string
  source: string
}

/** An accessory (`ocad` tag) attached at a marker; `resolved` false when its file was not read. */
export interface SpartanArmorAttachment {
  slot: string
  path: string
  item_id?: string
  resolved: boolean
  tag_id?: number
  tag_key?: string
  mesh_index?: number
  marker_name?: number
  marker_variant?: number
}

export interface SpartanArmorManifest {
  core_id: string
  theme_path: string
  theme_id?: string
  theme_tag_id: number
  /** The theme's model variant (signed StringID; its hex form names the core's base). */
  variant_id: number
  is_kit: boolean
  config_hash: string
  regions: SpartanArmorRegion[]
  attachments: SpartanArmorAttachment[]
  /** The coating; `style_key` (hex) names its file in the library, absent if not read. */
  coating?: { path: string; style_id?: number; style_key?: string }
  /** The visor (pattern and color, signed StringIDs), absent if its file was not read. */
  visor?: { path: string; visor_id?: number; color_variant?: number }
  body: { body_type: string; left_arm: string; right_arm: string; left_leg: string; right_leg: string }
  unresolved?: string[]
}

export interface ReplaySpartan {
  xuid?: string
  bid?: string
  status: 'armor' | 'default'
  reason?: string
  fetched_at?: string
  manifest?: SpartanArmorManifest
}

/** Each match player's armor (`domain.ReplaySpartans`). */
export interface ReplaySpartans {
  match_id: string
  players: ReplaySpartan[]
}

/** What the 3D view needs to dress a match's players. */
export interface ReplayArmorSource {
  playerSlug: string
  matchId: string
  /** The served folder of the armor piece library (`<folder>/<file>`). */
  piecesPath: string
}

/** Served folder of the Spartan armor piece library (shared by the title's matches). */
export function replaySpartanPiecesPath(playerSlug: string, matchId: string): string {
  return `/players/${playerSlug}/matches/${matchId}/replay/spartan-pieces`
}

interface SpartanArmorQuery {
  data: ReplaySpartans | undefined
  fetchStatus: 'idle' | 'fetching'
}

const IDLE: SpartanArmorQuery = { data: undefined, fetchStatus: 'idle' }

/**
 * useReplaySpartans loads the match players' armor, when a source is given. 404 (route
 * missing, or match without armor data) leaves `data` undefined rather than throwing: the
 * view already falls back to default-colored Spartans in that case.
 */
export function useReplaySpartans(source: ReplayArmorSource | null): SpartanArmorQuery {
  const [state, setState] = useState<SpartanArmorQuery>(IDLE)
  const key = source ? `${source.playerSlug}/${source.matchId}` : null
  const keyRef = useRef(key)
  keyRef.current = key
  useEffect(() => {
    if (!source) {
      setState(IDLE)
      return
    }
    let alive = true
    setState({ data: undefined, fetchStatus: 'fetching' })
    void (async () => {
      try {
        const data = await api.get<ReplaySpartans>(
          `/players/${source.playerSlug}/matches/${source.matchId}/replay/spartans`,
        )
        if (alive) setState({ data, fetchStatus: 'idle' })
      } catch {
        // Missing route or missing armor data: stay undefined, the view falls back.
        if (alive) setState({ data: undefined, fetchStatus: 'idle' })
      }
    })()
    return () => {
      alive = false
    }
  }, [key, source])
  return state
}
