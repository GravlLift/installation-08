// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * title-routing — standalone stand-in for LevelUp's multi-title routing.
 *
 * This viewer is Halo Infinite only and has no router: `useTitleSlug` is a constant,
 * kept only because `layers/useReplayWeaponPads.ts` (lifted for its pure helpers, never
 * for its hook) imports it at module scope.
 */
export function useTitleSlug(): string {
  return 'halo_infinite'
}
