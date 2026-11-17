// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * staticAssets.ts — composing title-scoped static asset URLs on the frontend side.
 *
 * Format emitted: `/static/{folder}/{titleSlug}/{id}{ext}` (title-scoped), consistent
 * with the FS tree and the URLs emitted by the Go backend.
 *
 * React components must use this module instead of hardcoding
 * `/static/...` in a `src=`.
 *
 * Mirrors the Go backend: `internal/assets/static/` (pure layer 2) +
 * `internal/games/halo_infinite/adapter_asset_urls.go` (layer 3).
 */

const MOUNT_POINT = '/static'

const FOLDER: Record<StaticKind, string> = {
  map: 'maps',
  medal: 'medals',
  'csr-rank': 'ranks',
  weapon: 'weapons-assets',
  commendation: 'commendations',
  vehicle: 'vehicles-assets',
  // 2D replay sounds (Opus in an Ogg container, replay-parity batch 5). Composed ONLY on the
  // frontend side (the Go backend emits no sound URL in its payloads — no mirror
  // in internal/assets/static/layout.go as long as that stays true).
  sound: 'sounds',
}

export type StaticKind =
  | 'map'
  | 'medal'
  | 'csr-rank'
  | 'weapon'
  | 'commendation'
  | 'vehicle'
  | 'sound'

export const DEFAULT_TITLE_SLUG = 'halo_infinite'

/**
 * staticAssetURL composes the URL of a title-scoped static asset.
 *
 * @param kind asset type (subfolder under /static/)
 * @param id   pre-encoded identifier (path-safe, no extension)
 * @param ext  file extension (with dot, e.g. ".png")
 * @param titleSlug title slug (default "halo_infinite")
 *
 * Format: /static/{folder}/{titleSlug}/{id}{ext}.
 */
export function staticAssetURL(
  kind: StaticKind,
  id: string,
  ext: string,
  titleSlug: string = DEFAULT_TITLE_SLUG,
): string {
  if (!id) return ''
  return `${MOUNT_POINT}/${FOLDER[kind]}/${titleSlug}/${id}${ext}`
}

/**
 * csrRankImageURL returns the URL of the CSR badge for a tier + sub-tier.
 * Special Onyx case: pass subTier=0 or tier="Onyx" (no sub-tier).
 */
export function csrRankImageURL(tier: string, subTier: number, titleSlug?: string): string {
  if (!tier) return ''
  if (tier === 'Onyx' || subTier <= 0) {
    return staticAssetURL('csr-rank', '120px-HINF-CSR_Onyx', '.png', titleSlug)
  }
  return staticAssetURL('csr-rank', `120px-HINF-CSR_${tier}${subTier}`, '.png', titleSlug)
}

/**
 * unrankedBadgeURL returns the URL of the unranked_0.png badge (0 placements played).
 */
export function unrankedBadgeURL(titleSlug?: string): string {
  return staticAssetURL('csr-rank', 'unranked_0', '.png', titleSlug)
}

/**
 * unrankedBadgeURLForProgress returns the URL of the unranked_N.png badge, proportional
 * to a placement progression (done/total). FRONTEND-SIDE mirror of the backend formula
 * `unrankedBadgeURLForThreshold` (apps/go-api/internal/platform/duckdb/
 * home_repo_skill_peak.go): N = done*10/total, clamped to [0,9] — the 10 available
 * images (unranked_0..9) are reused regardless of the real threshold
 * (5 for CSR since Season 3, 10 for legacy LUSR/CSR).
 *
 * `total` <= 0 is a safeguard (inconsistent data): falls back to unranked_0.
 */
export function unrankedBadgeURLForProgress(done: number, total: number, titleSlug?: string): string {
  if (total <= 0) return unrankedBadgeURL(titleSlug)
  let n = Math.floor((done * 10) / total)
  if (n < 0) n = 0
  if (n > 9) n = 9
  return staticAssetURL('csr-rank', `unranked_${n}`, '.png', titleSlug)
}
