// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/* eslint-disable max-lines -- 2026-09-06 (batch v2 D.11, user decision 4): a data table (one entry per key, no branching): splitting it would spread the same table across several files that would have to be kept in sync, without removing a single decision from the reader. */
/**
 * Types for the LevelUp API.
 *
 * Migration in progress (types.ts -> generated.ts project): types that have an
 * equivalent OpenAPI schema are re-exported from `./generated` (source of
 * truth = apps/go-api/api/openapi.yaml, regenerated via `npm run generate-types`).
 * Frontend-only types (view models, with no OpenAPI schema) stay defined here.
 */
import type { components } from './generated'

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

// Batch 1 (migration project) — re-exports from the OpenAPI contract.
export type PlayerSummary = components['schemas']['PlayerSummary']

export type CapabilityMap = components['schemas']['CapabilityMap']
/** Version and data folder of the desktop application (bootstrap `app_info`). */
export type AppInfo = components['schemas']['AppInfo']

// Spartan ID appearance diagnosis (admin, panel 2) — re-exports from the
// OpenAPI contract (single source), no manual mirror (Batch G, rule G4).
export type AppearanceDiagnosisResponse = components['schemas']['AppearanceDiagnosisResponse']
export type AppearanceComponentDiagnosis = components['schemas']['AppearanceComponentDiagnosis']

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export type FeatureFlags = components['schemas']['FeatureFlags']

export type SettingsExcerpt = components['schemas']['SettingsExcerpt']

export type HaloIdentitySummary = components['schemas']['HaloIdentitySummary']

export type TitleSummary = components['schemas']['TitleSummary']

// Migrated (bucket B reconciliation 2026-06-18): openapi.yaml BootstrapResponse
// completed to match the Go domain's real response (12 fields added:
// current_title_slug, available_titles, auth_mode, registration_mode,
// instance_locked, reauth_required, has_password, is_admin, current_username,
// first_launch, oauth_code_flow_enabled, demo_mode). Source of truth = the contract.
export type BootstrapResponse = components['schemas']['BootstrapResponse']

export type PlayersListResponse = components['schemas']['PlayersListResponse']

// In-game presence (GET /presence) — the shell's player selector.
// `players` is typed `PlayerPresence[] | null` by the generated contract (every
// Go slice translates this way): consumers fill it in at the boundary.
export type PresenceSnapshot = components['schemas']['PresenceSnapshot']
export type PlayerPresence = components['schemas']['PlayerPresence']

export interface SessionContextRequest {
  player_slug?: string | null
  title_slug?: string | null  // Sprint 44: title switch
  locale?: string | null
  hints_visible?: boolean | null
}

export interface SessionContextResponse {
  current_player: PlayerSummary | null
  current_title_slug: string  // Sprint 44
  locale: string
  hints_visible: boolean
  capabilities: CapabilityMap
  /** Sprint 44: titles available for the title switcher. */
  available_titles?: TitleSummary[]
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down'
  version: string
  uptime_seconds: number
  checks: Record<string, string>
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface PeriodInput {
  start_date?: string | null
  end_date?: string | null
}

export interface SessionsInput {
  picked_session_label?: string | null
  picked_solo_session_label?: string | null
  picked_squad_session_label?: string | null
  picked_sessions?: string[]
  gap_minutes?: number
}

export interface CascadeInput {
  experience_types?: string[]
  playlists?: string[]
  modes?: string[]
  maps?: string[]
}

export interface FilterContextInput {
  filter_mode: 'period' | 'sessions'
  period?: PeriodInput
  sessions?: SessionsInput
  cascade?: CascadeInput
  match_context?: 'solo' | 'squad' | 'all'
}

export type LabelValue = components['schemas']['LabelValue']

export type AvailableOptions = components['schemas']['AvailableOptions']

export type SessionOption = components['schemas']['SessionOption']

export type SessionOptions = components['schemas']['SessionOptions']

export type FilterCounts = components['schemas']['FilterCounts']

export type PeriodPresetCount = components['schemas']['PeriodPresetCount']

/** Cascade-aware count per catalog season (kind="season" from the TOML).
 *  Used for the "+N seasons without matches ▾" folding in SaisonPill. */
export type SeasonCount = components['schemas']['SeasonCount']

export type FilterContextResolved = components['schemas']['FilterContextResolved']

/** Response of POST /filters/match-ids: an ordered list (start_time DESC) of the
 *  current selection's match_id values. Feeds the "See matches" button. */
export interface FilterMatchIdsResponse {
  match_ids: string[]
}

// ---------------------------------------------------------------------------
// Setup / Auth (Slice 1)
// ---------------------------------------------------------------------------

export interface SetupPlayerInfo {
  has_any_profile: boolean
  default_player_slug: string | null
}

export type SetupNextStep = 'choose_mode' | 'auth' | 'player' | 'initial_sync' | 'smoke_test' | 'done'

export interface DeviceFlowStartResponse {
  attempt_id: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string | null
  /** Validity duration in seconds since issuance. */
  expires_in: number
  /** @deprecated Alias of expires_in for backend compatibility. */
  expires_in_seconds?: number
  poll_interval_seconds: number
}

export type DeviceFlowStatus = 'pending' | 'authorized' | 'provisioned' | 'failed' | 'expired'

// The backend unified the rich error schema "ApiErrorSchema" with the auto-emitted
// ApiError (Huma H4/H5): the OpenAPI schema is now called "ApiError". The
// local alias ApiErrorSchema is kept (a stable surface for consumers) by
// repointing it to the renamed schema — same fields (code/message/retryable/…).
export type ApiErrorSchema = components['schemas']['ApiError']

export type DeviceFlowStatusResponse = components['schemas']['DeviceFlowStatusResponse']

export interface CreatePlayerProfileRequest {
  gamertag: string
  xuid?: string | null
  profile_mode?: 'xbox' | 'azure_manual'
  // Multi-title: targets the title (takes priority over the header) + initial match count.
  title_slug?: string
  initial_max_matches?: number
}

export type CreatePlayerProfileResponse = components['schemas']['CreatePlayerProfileResponse']

export interface SmokeTestStartRequest {
  player_slug: string
  max_matches?: number
  run_backfill?: boolean
}

// ---------------------------------------------------------------------------
// Async jobs (Slice 1)
// ---------------------------------------------------------------------------

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted' | 'cancelled'

export interface AsyncJobStatus {
  job_id: string
  job_type: string
  status: JobStatus
  progress_pct: number | null
  current_step: string | null
  started_at: string | null
  finished_at: string | null
  result: Record<string, unknown> | null
  error: ApiErrorSchema | null
  // Enriched initial-sync fields (Sprint 3)
  phase_key: string | null
  phase_label: string | null
  matches_done: number | null
  matches_total: number | null
  subtasks_done: number | null
  subtasks_total: number | null
  eta_seconds: number | null
  warnings: string[]
  /** Player slug ("_all" for server-wide jobs, e.g. a forced sync cycle). */
  player_slug?: string
}

// ---------------------------------------------------------------------------
// Initial sync (Sprint 3)
// ---------------------------------------------------------------------------

export interface InitialSyncStartRequest {
  player_slug: string
  max_matches?: number
  // Multi-title: targets the right DB (a gamertag can exist under several titles).
  title_slug?: string
}

// ---------------------------------------------------------------------------
// Backfill (retroactive recompute)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Engagement (Phase 4 engagement plan)
// ---------------------------------------------------------------------------

/**
 * IMPORTANT — snake_case keys: the Go backend serializes via the json tags
 * of the domain.EngagementPoint / EngagementScoreResult struct (snake_case).
 * The old PascalCase keys (TimeMS, EngagementCurve…) were the cause
 * of the empty engagement chart in Match View — a pre-existing bug fixed here.
 */
export interface EngagementPointAPI {
  time_ms: number
  pace_joueur: number
  pace_team: number
  pace_attendu: number
  pace_lobby: number
  post_death_flag: boolean
  is_passive_death: boolean
}

export interface EngagementScoreResultAPI {
  engagement_score: number | null
  residual_brut: number
  engagement_curve: EngagementPointAPI[] | null
  match_intensity: number
  confidence: 'full' | 'partial' | 'insufficient_history'
  n_history_matches: number
  mean_pace_joueur?: number
  mean_pace_team?: number
  mean_pace_lobby?: number
  player_activity?: number
  /** Basis of the expected value (lobby-anchored v2 model). `cold_start` -> the
   *  "Expected player" series is hidden (no usable history). */
  expected_basis: 'bin' | 'global' | 'cold_start'
  /** Intensity bin label when `expected_basis === 'bin'`
   *  (calm | standard | chaotic). Empty otherwise. */
  intensity_bin: string
  /** F7 gate 2: calibration status of the title's coefficients.
   *  `provisional` -> a "provisional calibration" note (discreet badge); absent
   *  or `validated` -> full confidence (nothing shown). */
  calibration?: 'validated' | 'provisional'
  /** F7 gate 1: sufficiency of the signal vector (`full` | `partial`).
   *  Absent if not computed. */
  signal_basis?: 'full' | 'partial'
}

/** EngagementTimeseriesRequest — body of POST /engagement/timeseries.
 *  Aligned with TimeseriesQueryRequest: `filters` honors period / cascade /
 *  sessions / match_context. `limit` bounds the number of points returned
 *  (default 50, max 500 on the Go side). When the filtered scope exceeds `limit`, the
 *  backend switches to aggregated granularity (session -> week -> month). */
export interface EngagementTimeseriesRequest {
  filters: FilterContextInput
  limit?: number
}

/** Granularity of an engagement timeseries point. */
export type EngagementGranularity = 'match' | 'session' | 'week' | 'month'

/** EngagementMatchSummaryAPI — 1 point either for 1 match ("match" granularity),
 *  or for the aggregate of N matches (session/week/month). For aggregates,
 *  `match_id` is empty and `match_count > 1`. */
export interface EngagementMatchSummaryAPI {
  match_id: string
  label: string
  map_name?: string | null
  started_at: string
  pace_joueur: number
  pace_team: number
  pace_attendu: number
  pace_lobby: number
  engagement_score: number | null
  /** Number of matches represented by this point (1 for "match" granularity,
   *  >1 for aggregates). */
  match_count: number
  /** Match duration ("match" granularity) or the SUM of the bucket's durations
   *  (session/week/month), in seconds. Weights the cumulative engagement gap. */
  duration_seconds: number
}

/** EngagementTimeseriesResponse — response of POST /engagement/timeseries.
 *  - `granularity`: chosen automatically based on the filtered density.
 *  - `total_matches`: total filtered count BEFORE the workCap cap.
 *  - `truncated_to_recent`: if non-null, signals that the compute was bounded
 *    to the N most recent matches (performance; beyond that the binning still
 *    aggregates everything, but over a subset). */
export type EngagementTimeseriesResponse = components['schemas']['EngagementTimeseriesResponse']

export interface SquadPlayerEngagementAPI {
  xuid: string
  gamertag: string
  pace_observed: number[]
}

export interface SquadEngagementSessionAPI {
  labels: string[]
  map_names: string[]
  lobby_per_player: number[]
  team_expected: number[]
  team_observed: number[]
  /** Duration in seconds of each match, aligned with `labels`. Weights the
   *  cumulative per-player engagement gap (residual x duration). */
  durations_seconds: number[]
  players: SquadPlayerEngagementAPI[]
}

/** An intensity bin (pace_lobby tercile) with its response coefficient. */
export interface EngagementIntensityBinAPI {
  bin: string
  lower_bound: number
  upper_bound: number
  coef_lobby: number
  n_matches: number
}

/** Engagement profile per mode category (lobby-anchored v2 model). Exposed
 *  by GET /engagement_profile. coef_team_share is no longer exposed (D5). */
export interface EngagementProfileAPI {
  xuid: string
  gamertag?: string
  mode_category: string
  coef_lobby_share: number
  n_matches: number
  last_updated: string
  bins: EngagementIntensityBinAPI[] | null
}

export interface BackfillStartRequest {
  player_slug: string
  /** Slug of the title to recompute; absent = default title. The player must be tracked under it. */
  title?: string
  medals?: boolean
  events?: boolean
  skill?: boolean
  personal_scores?: boolean
  aliases?: boolean
  lusr?: boolean
  /** Per-match CSR re-fetch via GetMatchSkill (RankRecap). Idempotent
   *  by default; force_rescan=true -> re-fetches every ranked match. */
  csr?: boolean
  engagement_scores?: boolean
  engagement_coefficients?: boolean
  all_data?: boolean
  max_matches?: number
  dry_run?: boolean
  force_rescan?: boolean
}

// ---------------------------------------------------------------------------
// Settings (Slice 1)
// ---------------------------------------------------------------------------

export interface SettingsResponse {
  lang: string
  discord_lang: string
  user_timezone: string
  normalize_mode_labels: boolean
  show_records: boolean
  refresh_clears_caches: boolean
  media_captures_base_dir: string
  // Effective resolved value (env > setting > prod default). PATCH persists the setting.
  media_delete_source_after_transcode: boolean
  media_tolerance_minutes: number
  media_watcher_enabled: boolean
  media_watcher_debounce_seconds: number
  discord_notifications_enabled: boolean
  discord_webhook_url_present: boolean
  discord_notify_sync: boolean
  discord_notify_backfill: boolean
  discord_notify_new_version: boolean
  discord_notify_friends: boolean
  spnkr_auto_sync_enabled: boolean
  spnkr_auto_sync_interval_hours: number
  spnkr_auto_sync_interval_minutes: number
  watcher_presence_enabled: boolean
  watcher_subscribed_players: string[]
  // --- Session rules ---
  session_gap_minutes: number
  session_split_on_ranked_change: boolean
  session_team_change_mode: 'ignore' | 'group' | 'friends'
  // --- 2D replay: artifact retention window (0 = unlimited) ---
  replay_retention_months: number
  // --- 2D replay: where a replay is built. '' = instance default
  // (a worker in production, this server in development). ---
  replay_build_location: '' | 'local' | 'worker' | 'off'
  // --- Narrative badge rules ---
  outcome_exclude_bot_matches_from_badges: boolean
  outcome_exclude_bot_matches_from_records: boolean
  outcome_badge_sensitivity: 'relaxed' | 'standard' | 'strict'
  // --- Combat yield (OffensiveConversion) ---
  rendement_exclude_assists: boolean
  // --- Objectives/Prestige display ---
  show_progression: boolean
  // --- Proactive coach (coach -> Prestige bridge, see ADR 0020) ---
  coach_proactive_mode: boolean
  // --- Auth provider (admin only) ---
  auth_provider: string
  // --- Instance lock (admin only, ADR 0035 D5) ---
  // Closed instance: an unknown Xbox account can no longer create an account nor a
  // profile. The server exposes it (domain.SettingsResponse:87) and accepts its
  // PATCH under the admin role from the centralized lock — it was missing here, so
  // no page could offer it (prod had to be locked by hand).
  instance_locked: boolean
  // --- 2D replay weapon sounds (instance settings, admin page) ---
  // The .wav files extracted from the game are pure: these two percentages replay, app-side, what
  // the engine does on every shot. Variation 100 = the game's own ranges as-is;
  // distance 0 = pure sound, no processing in the signal path.
  replay_sound_variation_percent: number
  replay_sound_distance_percent: number
  // --- Film archive (ADR 0045 D-12) ---
  // Keep the film chunks after the replay bake (default true). False: removed
  // after baking, and the replay retention window must then stay unlimited (0).
  archive_films: boolean
  // Archive folder (absolute path); '' = default location. Taken into account on
  // restart. Occupancy is read via GET /settings/film-archive.
  film_archive_dir: string
  // --- Desktop application host integration (batch L21) ---
  // Detect the running game (default true), Windows notifications, a close-to-tray
  // button, start with Windows, scheduled refresh task (default false).
  game_process_watch: boolean
  native_notifications: boolean
  close_to_tray: boolean
  start_with_windows: boolean
  scheduled_refresh: boolean
  // --- Desktop application data (batch L22) ---
  // Periodic Parquet backup: folder (absolute path, '' = disabled), frequency
  // ('1h' to '168h'), number of games kept (1 to 60); each database's memory cap in MB
  // (0 = server default value, otherwise 1024 to 32768).
  backup_dir: string
  backup_interval: string
  backup_keep: number
  memory_limit_mb: number
}

export type UpdateSettingsRequest = Partial<
  Omit<SettingsResponse, 'discord_webhook_url_present'> & {
    discord_webhook_url?: string
  }
>

export interface MediaResetRequest {
  confirm_destructive: boolean
  reindex_after_reset?: boolean
}

// ---------------------------------------------------------------------------
// Career (Slice 2)
// ---------------------------------------------------------------------------

export interface CareerSummary {
  rank_number: number
  rank_label: string
  rank_name_raw: string
  rank_tier: string
  current_xp: number
  xp_for_next_rank: number
  xp_total: number
  progress_pct: number
  is_max_rank: boolean
  recorded_at: string | null
  rank_image_url?: string | null
  next_rank_name?: string
  next_rank_image_url?: string | null
}

export type HeroProgress = components['schemas']['HeroProgress']

export type CareerProjections = components['schemas']['CareerProjections']

export interface CareerHistoryPoint {
  recorded_at: string
  rank: number
  current_xp: number
  xp_total: number
}

export type FriendXPHistory = components['schemas']['FriendXPHistory']

export interface CareerLusrCheckpoint {
  recorded_at: string | null
  rating_type: string
  rating_value: number
  tier_label: string | null
  playlist_group: string | null
  playlist_name: string
  badge_image_url?: string | null
}

export interface CareerLusrSection {
  current_rating: number | null
  current_tier_label: string | null
  current_playlist_group: string | null
  trend_label: string | null
  checkpoints: CareerLusrCheckpoint[]
}

// V8b (2026-07-07) — the real DTOs served by the Career endpoints. The Go contract
// does NOT return `encounters_preview` on /pages/career: encounters are
// served by their own dedicated endpoint (/encounters), consumed directly by the page. The
// canonical CareerEncounter schema existed as surplus in the contract but was NOT
// the response's shape — hence silent `undefined` values.
export type EncounterDTO = components['schemas']['EncounterDTO']

// CareerPageResponse stays a hand-written interface: the view-model subtypes
// (CareerSummary, CareerLusrSection, CareerHistoryPoint) are hand-written and do NOT
// carry the same schema names as the generated contract (CareerRankSummary,
// LUSRSummary, XPHistoryPoint) — a raw re-export would break the LUSR/
// summary/xp consumers. The V8b fix is limited to removing the TWO ghost fields
// (top_matches_preview / encounters_preview) absent from the Go CareerPageResponse.
export interface CareerPageResponse {
  summary: CareerSummary | null
  hero_progress: HeroProgress | null
  projections: CareerProjections | null
  xp_history: CareerHistoryPoint[]
  lusr: CareerLusrSection | null
  friends_xp_history?: FriendXPHistory[]
}

export type CareerEncountersResponse = components['schemas']['CareerEncountersResponse']

// "Highlight matches" section (Career page): 15 best + 15 worst in
// ExplorerMatchRow format (same 21 columns as the Explorer page) + cascade counts
// for the Experience / Seasons filters.
export interface CareerHighlightMatchesResponse {
  best_matches: ExplorerMatchRow[]
  worst_matches: ExplorerMatchRow[]
  available_experience: HighlightExperienceCount[]
  available_seasons: HighlightSeasonCount[]
  available_modes: HighlightModeCount[]
  available_playlists: HighlightPlaylistCount[]
}

export type HighlightExperienceCount = components['schemas']['HighlightExperienceCount']

export type HighlightSeasonCount = components['schemas']['HighlightSeasonCount']

export type HighlightModeCount = components['schemas']['HighlightModeCount']

export type HighlightPlaylistCount = components['schemas']['HighlightPlaylistCount']

// Optional filters passed as query params to GET /pages/career/highlight-matches.
export interface CareerHighlightFilters {
  experience?: 'all' | 'ranked' | 'unranked'
  season_ids?: string[]      // multi-select
  mode_uis?: string[]        // multi-select (= pair_name / mode_ui)
  playlist_names?: string[]  // multi-select
}

// "Most crossed-paths players (excluding friends)" section: 10 rows in
// MatchEncounterRow format (reuses the Match View > Encounter History table).
export type CareerTopEncountersResponse = components['schemas']['CareerTopEncountersResponse']

// "Top nemesis" / "Top punching bag" section: top 10 each, frags/deaths
// ratio computed server-side.
export type CareerRival = components['schemas']['CareerRival']

export type CareerRivalsResponse = components['schemas']['CareerRivalsResponse']

export type CareerCSRRank = components['schemas']['CareerCSRRank']

export type CareerPlaylistCSR = components['schemas']['CareerPlaylistCSR']

/** CSR season selectable in the "Rankings" menu (Career page).
 *  A season appears if the player has ranked data in it + the current season. */
export type CSRSeasonOption = components['schemas']['CSRSeasonOption']

export type CareerCSRResponse = components['schemas']['CareerCSRResponse']

// Medals page (Career sub-page) — the title's full catalog + a per-player
// obtained count (count=0 = never obtained). Re-exports from the OpenAPI contract
// (single source): a flat sorted list + groups by category. See Batch A2.
export type MedalsPageResponse = components['schemas']['MedalsPageResponse']
export type MedalSummaryItem = components['schemas']['MedalSummaryItem']
export type MedalCategoryGroup = components['schemas']['MedalCategoryGroup']

// ---------------------------------------------------------------------------
// Pagination — common (Slices 3+)
// ---------------------------------------------------------------------------

export type SortSpec = components['schemas']['SortSpec']

export interface PaginationRequest {
  page?: number
  page_size?: number
}

export type PaginationMeta = components['schemas']['PaginationMeta']

export type FreshnessInfo = components['schemas']['FreshnessInfo']

export interface PaginatedResponse<T> {
  items: T[]
  pagination: PaginationMeta
  freshness?: FreshnessInfo | null
}

// ---------------------------------------------------------------------------
// Match history (Slice 3)
// ---------------------------------------------------------------------------

export interface MatchHistoryRow {
  match_id: string
  start_time: string
  start_time_label: string
  outcome_code: number | null
  /** Canonical outcome key (MT-06): the web localizes via useOutcomeLabel/useOutcomeMapping. */
  outcome?: 'win' | 'loss' | 'tie' | 'dnf'
  score_label: string
  map_ui: string
  mode_ui: string
  playlist_label: string
  team_mmr: number | null
  enemy_mmr: number | null
  delta_mmr: number | null
  win_rate_hist: number | null
  win_rate_hist_total: number | null
  average_life_mmss: string
  match_url: string
  /** S56 — combat yield */
  kills?: number | null
  assists?: number | null
  deaths?: number | null
  damage_dealt?: number | null
  damage_taken?: number | null
  offensive_finishing?: number | null
  map_image_url?: string | null
}

export type MatchHistoryQuerySummary = components['schemas']['MatchHistoryQuerySummary']

export type ExportHint = components['schemas']['ExportHint']

export type MatchHistoryPageResponse = components['schemas']['MatchHistoryPageResponse']

export interface MatchHistoryQueryRequest {
  filters?: FilterContextInput
  pagination?: PaginationRequest
  columns?: string[] | null
  include_export_hint?: boolean
  /** §5 Squad/Sessions plan: solo multi-session filter. */
  picked_solo_session_labels?: string[]
}

export type FileTokenResponse = components['schemas']['FileTokenResponse']

// ---------------------------------------------------------------------------
// Explorer (Slice 4)
// ---------------------------------------------------------------------------

export type GamertagSuggestion = components['schemas']['GamertagSuggestion']

export type GamertagSearchResponse = components['schemas']['GamertagSearchResponse']

/**
 * VIEW-MODEL of the matches table — NOT a re-export of the contract.
 *
 * ExplorerMatchesTable is reused by three surfaces (Explorer, the Session view,
 * the Career's "Highlight matches") fed by DIFFERENT OpenAPI schemas.
 * This type is their common denominator on the frontend side; it is therefore
 * deliberately NOT derived from `components['schemas']['ExplorerMatchesRow']`
 * (verified on 2026-08-04, a faithful derivation is impossible):
 *
 * - `skill_rating_delta` does not belong to `ExplorerMatchesRow`: it comes from
 *   `SessionDetailMatchRow` and only feeds a "Δ rank" column INJECTED by
 *   the session view via `extraColumns`. Undefined on the Explorer side.
 * - `map_ui` / `mode_ui` / `playlist_label` are `string | null` in the contract and
 *   `string` here: the three backend producers guarantee a resolved label
 *   (a fallback applied server-side), the table has no "null" branch.
 * - optional fields admit `| null` in addition to `undefined`: the JSON
 *   served carries `null` where the generator only models absence.
 *
 * Any new column served by the API must ALSO be added to the corresponding
 * schema on the Go side — this type does not exempt one from the contract, it unifies it.
 */
export interface ExplorerMatchRow {
  match_id: string
  start_time: string
  start_time_label: string
  map_ui: string
  mode_ui: string
  playlist_label: string
  /** Canonical outcome key (MT-06): the web localizes via useOutcomeLabel/useOutcomeMapping. */
  outcome?: 'win' | 'loss' | 'tie' | 'dnf'
  outcome_code: number
  score_label: string
  is_with_friends: boolean
  experience_type_label: string
  kills?: number | null
  deaths?: number | null
  assists?: number | null
  perf_score?: number | null
  perf_tier?: number
  delta_perf?: number | null
  skill_tier_label?: string | null
  /** URL of the tier badge image, resolved by the TITLE's asset adapter
   *  server-side. Absent when the title exposes no badge, the match is in
   *  placement, or the tier is unknown -> the "Rank" column then falls back to
   *  `skill_tier_label` (localized text). Never built on the frontend side. */
  skill_rank_image_url?: string | null
  /** The player's PERSONAL score on the match. Not to be confused with `score_label`,
   *  which carries the TEAM score ("50 - 30"). */
  personal_score?: number | null
  /** "CSR" (official ranked) or "LUSR" (LevelUp internal). Nil if no skill rank (PvE, Custom). */
  rating_type?: string | null
  /** Rating gain/loss for the match. NOT rendered by ExplorerMatchesTable's own columns:
   *  a data carrier for a "Δ rank" column INJECTED by a consumer
   *  (the session view via extraColumns). Stays undefined on the Explorer page. */
  skill_rating_delta?: number | null
  /** Pre-match win probability for the team (LUSR v2, 0..1). A data carrier
   *  for a "Forecast" column INJECTED by the session view. Undefined on Explorer. */
  expected_win_prob?: number | null
  /** Placement progress (X). If set along with placement_total, the UI shows "X/Y" in the
   *  Rank cell instead of skill_tier_label, AND an "In placement" badge (V72-32,
   *  see ExplorerMatchesTable.placement.tsx) in the Perf/ΔPerf/Rating cells instead
   *  of "-" when perf_score/delta_perf/rating_type are null for the same reason. */
  placement_done?: number | null
  /** Placement threshold (Y). CSR: 5 or 10 depending on the season. LUSR: 10. */
  placement_total?: number | null
  /** Placement of the PERFORMANCE chain (X/Y) — a signal DEDICATED to the Perf/ΔPerf
   *  columns, distinct from placement_done/total (the Rating/Rank column). Set when the match's
   *  perf chain counts fewer than Y eligible matches -> perf_score structurally absent.
   *  A match can have an established LUSR rating AND be in perf placement (a young
   *  perf chain, the BTB case). See ExplorerMatchesTable.placement.tsx. */
  perf_placement_done?: number | null
  perf_placement_total?: number | null
  delta_mmr?: number | null
  team_mmr?: number | null
  enemy_mmr?: number | null
  kda?: number | null
  duration_seconds?: number | null
  /** Match that went into OVERTIME (play duration beyond the variant's regulation
   *  time + a measured margin). Absent/false if the title has no regulation
   *  table, the variant is unknown there, or the duration is not
   *  estimable — the indicator is then simply not rendered. */
  is_overtime?: boolean
  /** Actual overrun of regulation time in seconds (tooltip "Overtime: +X"). */
  overtime_seconds?: number
  match_url?: string
  /** A 2D replay artifact exists for this match -> the row carries a link to the
   *  replay page. Absent/false = nothing is rendered (never a link to a 404). */
  has_replay?: boolean
  /** 0=none, 1=domination, 2=humiliation, 3=comeback, 4=rout, 5=reverse comeback. */
  /**
   * Indicates that one of the player's teammates was a bot during the match.
   * Present only on the career page's best_matches (excluded server-side
   * for worst_matches to isolate the player's own responsibility).
   * The frontend shows a "bot" pill on the match card.
   */
  had_bot_teammate?: boolean
}

export type ExplorerEncounterRow = components['schemas']['ExplorerEncounterRow']

export interface ExplorerMatchesQuerySummary {
  total_matches: number
  selected_match_id: string | null
  // available_experience_types: LabelValue (backend-localized Label, Value FR = the
  // filter key, intact). GH6-1, mirrors GH5-2 Omnibar.
  available_experience_types?: LabelValue[]
  // playlists / maps / modes: LabelValue (label in the request's language, value = the
  // default language's name, filter key `playlists` / `maps` / `modes` is language-independent).
  available_playlists?: LabelValue[]
  available_maps?: LabelValue[]
  available_modes?: LabelValue[]
  /** Explorer-specific options with a cascade-aware count (OR semantics within
   *  a dimension, AND between dimensions). Options with count=0 should be grayed out.
   *  `value` is: an outcome code (1..4) or tier (1..5) as a string, or an EN key
   *  (Bronze..Onyx) for skill_tier, or "" / "ranked" / "unranked" for ranked,
   *  or "" / "solo" / "squad" for squad_scope. */
  available_outcomes?: LabelValue[]
  available_perf_tiers?: LabelValue[]
  available_skill_tiers?: LabelValue[]
  available_ranked_contexts?: LabelValue[]
  available_squad_scopes?: LabelValue[]
}

export type ExplorerPlayerTarget = components['schemas']['ExplorerPlayerTarget']

export type ExplorerPlayerSummary = components['schemas']['ExplorerPlayerSummary']

export interface ExplorerMatchesQueryRequest {
  filters?: FilterContextInput
  pagination?: PaginationRequest
  sort_field?: string
  sort_dir?: string
  include_export_hint?: boolean
  perf_tiers?: number[]
  skill_tiers?: string[]
  ranked_context?: 'ranked' | 'unranked' | ''
  outcome_filter?: number[]
  // Explorer-specific match filters
  match_start_date?: string | null
  match_end_date?: string | null
  experience_types?: string[]
  playlists?: string[]
  map_names?: string[]
  mode_names?: string[]
  squad_scope?: 'solo' | 'squad' | ''
  /** Presence of a 2D replay: '' (all) | 'with' | 'without'. Filtered on the Go side. */
  replay_scope?: 'with' | 'without' | ''
  match_id_search?: string
  /** Exact match_id whitelist (Player mode: matches in common). */
  match_ids?: string[]
  /** Opt-in for the briefing banner (Matches mode): Matches mode sends it as true. */
  include_briefing?: boolean
}

export interface ExplorerPlayerQueryRequest {
  target_gamertag: string
  /** Optional xuid: bypasses the local gamertag->xuid resolution (a Rankings player). */
  target_xuid?: string
  page?: number
}

export interface ExplorerCommonMatchRow {
  match_id: string
  start_time: string
  map_ui: string
  mode_ui: string
  were_teammates: boolean
  player_outcome: number
  /** Canonical outcome key (MT-06): the web localizes via useOutcomeLabel/useOutcomeMapping. */
  outcome?: 'win' | 'loss' | 'tie' | 'dnf'
  kills: number
  deaths: number
  kda: number
}

export interface MatchEncounterBadge {
  kind: string
  label_key: string
  color_token: string
  detail?: Record<string, unknown>
}

/** Aggregated stats for the (current player, target) pair. Partial mirror of
 *  MatchEncounterRow — the 7 columns of the MatchEncountersTable table
 *  (without is_ally since there is no current match in Explorer). */
export type ExplorerEncounterStats = components['schemas']['ExplorerEncounterStats']

/** A point on the "cumulative frag gap" curve of the opponent panel
 *  (directional cumulative frags - deaths + duel outcome). Mirrors the
 *  Relations hub's rematch cards (CumulativeFragGapChart). */
export type ExplorerFragGapPoint = components['schemas']['ExplorerFragGapPoint']

export type ExplorerPlayerQueryResponse = components['schemas']['ExplorerPlayerQueryResponse']

/** Composite "Target player profile" panel (4 sources fetched in parallel).
 *  All sub-sections are nullable: the frontend hides the null ones
 *  and shows a "Halo sign-in required" hint when auth_available=false. */
export type ExplorerTargetProfile = components['schemas']['ExplorerTargetProfile']

/** Per-section live status of the "Target player profile" panel (Batch A3, end of
 *  silent degradation) — why a section is empty/partial rather than
 *  silent. See ExplorerLiveStatusBadge (features/explorer). */
export type ExplorerLiveStatus = components['schemas']['ExplorerLiveStatus']

/** An individual section status ("ok" | "failed" | "no_auth" | "local_partial"). */
export type ExplorerLiveSectionStatus = ExplorerLiveStatus['identity']

/** ExplorerTargetRecentMatch — a recent PvP match of the target player, projected for
 *  the combat profile charts. Exact mirror of the Go DTO (snake_case JSON).
 *  `rank` is null if DNF/unranked (a gap in the placement curve — never plot 0). */
export type ExplorerTargetRecentMatch = components['schemas']['ExplorerTargetRecentMatch']

/** Number of matchmade matches played by the target player in a season.
 *  `matches` = the season's total (live mode = service record filtered by season;
 *  degraded mode without auth = local bucketing). The season's peak CSR rank is
 *  exposed (tier + badge image) when available — rendered above the bar. */
export type SeasonMatchCount = components['schemas']['SeasonMatchCount']

/** Aggregated stats for the target player over the sample of matches in common.
 *  Ratios are nullable: null means "unavailable" (a zero denominator). */
export type ExplorerTargetSampleStats = components['schemas']['ExplorerTargetSampleStats']

/** A weapon from the top weapons (Explorer target): label in the request's language + kills. */
export interface ExplorerWeaponKill {
  weapon_id: number
  label: string
  kills: number
}

export type ExplorerMatchesQueryResponse = components['schemas']['ExplorerMatchesQueryResponse']

// ─── Briefing banner (Matches mode) — aliases of the auto-derived schemas ────────
export type ExplorerBriefing = components['schemas']['ExplorerBriefing']
export type ExplorerBriefingScope = components['schemas']['ExplorerBriefingScope']
export type ExplorerBriefingPeakRank = components['schemas']['ExplorerBriefingPeakRank']
export type ExplorerBriefingBaseline = components['schemas']['ExplorerBriefingBaseline']
export type ExplorerBriefingDimension = components['schemas']['ExplorerBriefingDimension']
export type ExplorerBriefingDimensionEntry = components['schemas']['ExplorerBriefingDimensionEntry']
export type ExplorerBriefingRanked = components['schemas']['ExplorerBriefingRanked']
export type ExplorerBriefingRankedKind = components['schemas']['ExplorerBriefingRankedKind']
export type ExplorerBriefingContextSplit = components['schemas']['ExplorerBriefingContextSplit']
export type ExplorerBriefingContextGroup = components['schemas']['ExplorerBriefingContextGroup']
export type ExplorerBriefingStreaks = components['schemas']['ExplorerBriefingStreaks']
export type ExplorerBriefingDominance = components['schemas']['ExplorerBriefingDominance']
export type ExplorerBriefingWeapons = components['schemas']['ExplorerBriefingWeapons']

// ---------------------------------------------------------------------------
// Mission Control home (Slice 5)
// ---------------------------------------------------------------------------

export interface HeroKPIs {
  win_rate: number
  global_ratio: number | null
  avg_kda: number | null
  avg_accuracy: number | null
  total_matches: number
  wins: number
  draws: number
  dnfs: number
  losses: number
  total_playtime_secs: number
  favorite_weapon_name: string
  favorite_weapon_kills: number
  favorite_playlist_name: string
  favorite_playlist_count: number
  /** Average damage per frag / per death (Σ dmg / Σ kills|deaths). Nil if the denominator is zero. */
  dmg_per_kill?: number | null
  dmg_per_death?: number | null
}

export interface HeroTrend {
  ratio_delta: number | null
  accuracy_delta: number | null
  win_rate_delta: number | null
}

export interface HomeHeroCard {
  player_name: string
  kpis: HeroKPIs
  trend: HeroTrend | null
}

export type HighlightValueColor =
  | 'positive'
  | 'warning'
  | 'neutral'
  | 'negative'
  | 'perf-excellent'
  | 'perf-good'
  | 'perf-ok'
  | 'perf-low'
  | 'perf-bad'

export interface HighlightSlide {
  label_key?: string
  label?: string
  value: string
  detail?: string
  detail_key?: string
  detail_params?: Record<string, string | number>
  value_color?: HighlightValueColor
}

export interface HighlightItem {
  title_key?: string
  title?: string
  value: string
  detail?: string
  detail_key?: string
  detail_params?: Record<string, string | number>
  value_color?: HighlightValueColor
  slides?: HighlightSlide[]
}

export interface RecentMatchItem {
  match_id: string
  detail: string
  started_at: string | null
  // outcome_label removed on the Go side on 2026-09-07 (D4/D5, batch Q4): 0 readers here.
  // title (Go composite "<outcome word> · <map>") removed on 2026-09-07 (batch M5
  // L2): its only reader (MatchCard.buildMatchHeading) only used it as a LAST
  // resort, when both map_ui AND mode_ui were missing. outcome_tone IS the
  // canonical outcome key (win|loss|tie|dnf, see outcomes.toml) — to be resolved
  // via useOutcomeLabel if a reader needs it one day.
  outcome_tone: string
  score_label?: string | null
  narrative_badges?: string[]
  /** S56 — champs enrichis pour MatchCard */
  map_ui?: string | null
  mode_ui?: string | null
  playlist_ui?: string | null
  kills?: number | null
  assists?: number | null
  deaths?: number | null
  /** Placement of the PERFORMANCE chain (X/Y): set (with
   *  eligible -> no perf computable. The tile shows "In placement (X/Y)" instead
   *  of a blank. NEVER a manufactured 0 for a missing perf. See PlacementPendingNote. */
  perf_placement_done?: number | null
  perf_placement_total?: number | null
  offensive_finishing?: number | null
  damage_dealt?: number | null
  damage_taken?: number | null
  map_image_url?: string | null
  skill_rating_value?: number | null
  skill_rating_type?: string | null
  skill_tier_label?: string | null
  skill_rating_delta?: number | null
  skill_playlist_group?: string | null
  skill_rank_image_url?: string | null
  skill_progress_pct?: number | null
  skill_points_in_tier?: number | null
  kda?: number | null
  duration_secs?: number | null
  accuracy?: number | null
  avg_life_secs?: number | null
  team_mmr?: number | null
  enemy_mmr?: number | null
  delta_mmr?: number | null
  is_with_friends?: boolean | null
  rank_in_team?: number | null
  headshot_kills?: number | null
  perfect_kills?: number | null
  top_medals?: RecentMatchMedal[] | null
  top_citations?: MatchCitationSnippet[] | null
  /** Bug #6 — lets the frontend filter the OutcomeSequenceTape to the last session. */
  session_label?: string | null
  /** True if the playlist is ranked (official CSR). Source: match_registry.is_ranked. */
  is_ranked?: boolean | null
  /** A 2D replay artifact exists for this match: the tile carries the link to the replay
   *  page (resolved server-side as a per-request folder listing, see Explorer). */
  has_replay?: boolean
  /** The match is synced but its film's analysis is not finished (assisted frags,
   *  citations, or the 2D replay not produced yet): the tile says so instead of showing gaps.
   *  Server rule `analysis.IsAnalysisPending` (sync < 24 h). Absent = false. */
  analysis_pending?: boolean
  /** The causes of `analysis_pending` (`kill_source`, `citations`, `replay`, stable order):
   *  each of the tile's pending slots looks at its own. Absent = no cause. */
  analysis_pending_parts?: string[] | null
  /** `in_progress` if a film decode is running on THIS match, `queued` otherwise (`domain.AnalysisState*`).
   *  Only set when `analysis_pending` is true; "in progress" is only said for `in_progress`. */
  analysis_state?: string | null
  /** Share of the player's frags assisted by a teammate on THIS match, by damage-share
   *  bracket (the "received" direction from the Relations page, on a single match). Absent
   *  when the match's film does not carry the assist data: the tile displays nothing —
   *  never a manufactured "0". */
  assisted_frags?: MatchAssistedFrags | null
}

/** Mirror of `domain.MatchAssistedFrags` (Go). /pages/home does not yet have a derived
 *  OpenAPI schema (contract TODO, Sprint 32): this DTO is hand-written, like
 *  RecentMatchItem, on top of the generated AssistTiers (Relations route). */
export interface MatchAssistedFrags {
  /** Basis of the share: the match's official frags (the tile's own), bots included,
   *  never under the frags read from the film. */
  frags_official: number
  /** Assisted frags (assistant named by the film, bots included), by share bracket. */
  received: AssistTiers
}

export type MatchCitationSnippet = components['schemas']['MatchCitationSnippet']

export interface RecentMatchMedal {
  medal_id: number
  name: string
  count: number
  description?: string | null
  image_url: string
  difficulty?: string | null
  // Sprite fields (Halo 5 medals). Absent for Halo Infinite (PNG image_url).
  sprite_sheet?: string
  sprite_left?: number
  sprite_top?: number
  sprite_width?: number
  sprite_height?: number
}

export interface SessionSummaryItem {
  session_label: string
  match_count: number
  win_rate: number
  global_ratio: number | null
  started_at: string | null
  ended_at: string | null
  wins: number
  losses: number
  draws: number
  dnfs: number
  avg_player_performance: number | null
  avg_team_performance: number | null
  avg_kda: number | null
  dominant_playlist: string | null
  dominant_mode: string | null
  /** Squad sessions: gamertags of the most present teammates (configured
   *  friends, top 3). Used for the squad card's deep link -> /squad. Absent/[] for
   *  solo sessions or if the data is unavailable. */
  teammates?: string[]
}

export type HomeCareerRankSummary = components['schemas']['HomeCareerRankSummary']

export type HomeSkillPeakSummary = components['schemas']['HomeSkillPeakSummary']

export interface HomePlaylistRank {
  playlist_name: string
  is_ranked: boolean
  rating_type?: string | null   // "CSR" | "LUSR" — absent if no rank is computed
  rating_value?: number | null
  tier_label?: string | null
  badge_image_url?: string | null
  /** Placement matches remaining (threshold->0). Present only for ranked CSR in placement. */
  measurement_matches_remaining?: number | null
  /** The match's season's placement threshold (5 or 10). nil -> frontend falls back to 10. */
  placement_total?: number | null
  /** ORDINAL fill of the bar (0..100) via the sub-tier (n/6), independent
   *  of the CSR/LUSR scale. Computed by analysis.SkillTierBand (the same band as the
   *  skill peak). null outside the matured phase (placement / no rank) -> no bar. */
  tier_progress_pct?: number | null
  /** Localized label of the next SUB-TIER (the bar's right end, e.g.
   *  "Gold V", "Platinum I"). null for Onyx (the top). */
  next_tier_label?: string | null
}

export type HomeSpartanIdentity = components['schemas']['HomeSpartanIdentity']

/** An outcome in the "Last session results" sequence (`domain.HomeSessionOutcome`). */
export interface HomeSessionOutcome {
  match_id: string
  outcome_tone: string
  /** Tile label (mode, map, score), shown in a tooltip. */
  detail: string
}

/** A page of tiles: `GET /players/{slug}/pages/home/matches` (`domain.HomeMatchesPage`). */
export interface HomeMatchesPage {
  items: RecentMatchItem[]
  has_more: boolean
  /** Cursor for the next page; absent when there is no more. */
  next_before?: string
}

export interface HomePageResponse {
  hero: HomeHeroCard
  spartan_identity?: HomeSpartanIdentity | null
  highlights: HighlightItem[]
  /** HEAD of the tile list (30 at most): the rest is read via `GET /pages/home/matches`
   *  (cursor `recent_matches_next_before`). Never the whole history. */
  recent_matches: RecentMatchItem[]
  /** Real count of history tiles (never the head's length). */
  recent_matches_total: number
  recent_matches_has_more: boolean
  /** Opaque cursor for the next page; absent when `recent_matches_has_more` is false. */
  recent_matches_next_before?: string
  /** Outcomes of the last session, most recent first (computed over the whole history). */
  last_session_outcomes: HomeSessionOutcome[]
  solo_session: SessionSummaryItem | null
  squad_session: SessionSummaryItem | null
  solo_sessions?: SessionSummaryItem[]
  squad_sessions?: SessionSummaryItem[]
  has_ranked_history?: boolean
  has_unranked_history?: boolean
  /** Sprint 54-B9: a discreet signal if the data is partial (a private account). */
  privacy_warning?: MatchPrivacyWarning | null
  recent_playlist_ranks?: HomePlaylistRank[]
}

export type ChallengeItem = components['schemas']['ChallengeItem']

export type ChallengesResponse = components['schemas']['ChallengesResponse']

export type SeasonPassStatus = 'active' | 'in_progress' | 'completed' | 'not_started'

export type SeasonPassItemSummary = components['schemas']['SeasonPassItemSummary']

export type SeasonPassTierSummary = components['schemas']['SeasonPassTierSummary']

export interface SeasonPassContentSummary {
  total_tiers: number
  credits?: number | null
  spartan_points?: number | null
  xp_boosts?: number | null
  challenge_swaps?: number | null
  cosmetics_total?: number | null
  rarity_breakdown?: Record<string, number> | null
  type_breakdown?: Record<string, number> | null
}

export type SeasonPassTrackSummary = components['schemas']['SeasonPassTrackSummary']

export type SeasonPassPageResponse = components['schemas']['SeasonPassPageResponse']

// Community Hub > Relations — types DERIVED from the OpenAPI contract (single source:
// generated.ts), no hand-written interface (lint-contract-ratchet guard rail).
// Note: the arrays (relations, badges) are nullable in the contract (Go slices);
// the service guarantees non-nil, consumers apply `?? []` / `?.`.
// category = string in the contract ("ally" | "enemy" | "mixed" in practice).
export type RelationBadge = components['schemas']['RelationBadge']
export type RelationInsight = components['schemas']['RelationInsight']
export type RelationRef = components['schemas']['RelationRef']
// RelationCSR: the nemesis's current CSR snapshot (batch relations-G, best-effort).
export type RelationCSR = components['schemas']['RelationCSR']
// RelationAssists: assists exchanged with a player (matches measured on the same team),
// broken down by share bracket (AssistTiers). Absent = no match measured together.
export type RelationAssists = components['schemas']['RelationAssists']
export type AssistTiers = components['schemas']['AssistTiers']
export type RelationsOverview = components['schemas']['RelationsOverview']
export type RelationsPageResponse = components['schemas']['RelationsPageResponse']

// ── Phase 3a: Moments & Rivalries (sub-endpoint /relations/moments) ────────

// RelationHeatmapCell: a cell of the aggregated "When you cross paths" heatmap
// (a relation x an hour). hour: 0..23 (user's timezone).
export type RelationHeatmapCell = components['schemas']['RelationHeatmapCell']

// RelationDuelEntry: a duel (a shared match as enemies) in the rematch timeline.
// outcome: "win" | "loss" | "other".
export type RelationDuelEntry = components['schemas']['RelationDuelEntry']

// RelationRivalry: a rematch card (nemesis + other rivals).
export type RelationRivalry = components['schemas']['RelationRivalry']

// RelationsMomentsResponse: the Moments & Rivalries sub-endpoint's response.
export type RelationsMomentsResponse = components['schemas']['RelationsMomentsResponse']

// ---------------------------------------------------------------------------
// Squad / Teammates (Slice 6)
// ---------------------------------------------------------------------------

export type TeammateOption = components['schemas']['TeammateOption']
export type SquadPageResponse = components['schemas']['SquadPageResponse']

export interface RadarAxes {
  objectives: number
  combat: number
  support: number
  score: number
  impact: number
  survival: number
}

export interface TeammateKPIs {
  match_count: number
  wins: number
  kd_ratio: number | null
  win_rate: number
  accuracy: number | null
  kills_per_game: number | null
  assists_per_game: number | null
  headshot_kills_per_game?: number | null
  perfect_kills_per_game?: number | null
  radar_axes?: RadarAxes | null
}

export type TeammateRow = components['schemas']['TeammateRow']

export type TeammatesQueryRequest = components['schemas']['TeammatesQueryRequest']

export type SessionLabelEntry = components['schemas']['SessionLabelEntry']

export type SessionLabelsList = components['schemas']['SessionLabelsList']

/**
 * `GET /players/{slug}/pages/teammates/sessions` (performance batch L4b, 2026-09-23): the two
 * fields `composition_sessions` and `latest_composition_session` of `TeammatesPageResponse`, the
 * same values for the same composition and the same exact composition option, WITHOUT computing the
 * page — the Squad page anchors on it before sending its heavy request. Both fields are
 * always present (an empty list, an empty string); the contract declares the list nullable (a Go
 * slice): read it via `?? []`.
 */
export type CompositionSessionsResponse = components['schemas']['CompositionSessionsResponse']

export interface SquadTimeseriesPoint {
  period_label: string
  match_count: number
  wins: number
  win_rate: number
  avg_performance: number | null
  avg_mmr: number | null
}

export type MapBreakdownRow = components['schemas']['MapBreakdownRow']

export type SquadMatchSeriesPoint = components['schemas']['SquadMatchSeriesPoint']

/** A row of the "Tools of destruction" (Squad, D8): a tool — a weapon named by the
 *  registry (`kind` = `weapon`, `label` in the request's language) or a kind named
 *  by the web (melee, explosive object, fall, unattributed…) —, its frag class (pill), and
 *  each player's frags. */
export type SquadWeaponToolLine = components['schemas']['SquadWeaponToolLine']

/** "Tools of destruction" data — players ordered (main player then teammates), lines
 *  sorted by descending total, "Unattributed" last. No cap. */
export type SquadWeaponTools = components['schemas']['SquadWeaponTools']

/** A row of the "Accuracy by role" comparison (Squad): accuracy + shots per player,
 *  aggregated BY weapon ROLE (precision/automatic/sniper/…). Shim of the OpenAPI schema (a
 *  faithful contract: role + accuracy_by_player + shots_fired_by_player + total_shots_squad). */
export type SquadWeaponAccuracyBar = components['schemas']['SquadWeaponAccuracyBar']

/** Data for the multi-player "Accuracy by role" comparison (horizontal grouped bars).
 *  NATIVE Halo 5 accuracy; absent on Infinite (capability weapon_accuracy). */
export type SquadWeaponAccuracy = components['schemas']['SquadWeaponAccuracy']

/** Breakdown of Halo 5 native mechanics per teammate (stacked bars, Squad). */
export type SquadKillMechanics = components['schemas']['SquadKillMechanics']
export type SquadKillMechanicBar = components['schemas']['SquadKillMechanicBar']

/** A point of a performance series (1 per match x player) for teammates.16. */
export type SquadPerformanceSeriesPoint = components['schemas']['SquadPerformanceSeriesPoint']

/** An axis of the teammates.06 synergy radar (value normalized 0..100, raw debug). */
export type SquadSynergyRadarAxis = components['schemas']['SquadSynergyRadarAxis']

/** Radar profile (1 per player, over shared matches). */
export type SquadSynergyRadarSeries = components['schemas']['SquadSynergyRadarSeries']

/** Row of the teammates.15 intensity heatmap. Phases is a 1x10 matrix. */
export type SquadIntensityMatchRow = components['schemas']['SquadIntensityMatchRow']

export type SquadIntensityOption = components['schemas']['SquadIntensityOption']

export interface SquadIntensityProfile {
  options: SquadIntensityOption[]
  rows: Record<string, SquadIntensityMatchRow[]>
}

/** Per-player aggregate for the teammates.14 per-minute chart. */
export type SquadPerMinuteEntry = components['schemas']['SquadPerMinuteEntry']

/** Per-session aggregated point for the teammates.04 timeline chart. */
export type SquadSessionPoint = components['schemas']['SquadSessionPoint']

/** Cell (player, map, perf_avg) of the teammates.03 heatmap. */
export type SquadMapHeatmapCell = components['schemas']['SquadMapHeatmapCell']

export type SquadMapHeatmap = components['schemas']['SquadMapHeatmap']

export type SquadImpactBadgeCount = components['schemas']['SquadImpactBadgeCount']

export type SquadImpactPlayerSummary = components['schemas']['SquadImpactPlayerSummary']

export type SquadImpactMatchHeader = components['schemas']['SquadImpactMatchHeader']

export type SquadImpactCell = components['schemas']['SquadImpactCell']

/** Data for the teammates.07 impact scoreboard. */
export type SquadImpactMatrix = components['schemas']['SquadImpactMatrix']

/** Impact points per evening and per role (same scale as the matrix, computed on the Go side). */
export type SquadImpactHistory = components['schemas']['SquadImpactHistory']
export type SquadImpactEvening = components['schemas']['SquadImpactEvening']

/**
 * Row of the squad history table (teammates.11). One row per unique match
 * in the filtered scope, sorted server-side by start_time DESC.
 * Pagination handled client-side (TanStack Table, 20/page).
 */
export type SquadMatchHistoryRow = components['schemas']['SquadMatchHistoryRow']

// Sprite fields (Halo 5 medals) added by hand pending OpenAPI
// regeneration (the Go side already carries the sprite_* json tags). Optional: Halo Infinite
// serves a PNG via image_url and has no sprite. See AssetMeta (same shim).
export type MedalDigestItem = components['schemas']['MedalDigestItem'] & {
  sprite_sheet?: string
  sprite_left?: number
  sprite_top?: number
  sprite_width?: number
  sprite_height?: number
}

export type MedalDigestEntry = components['schemas']['MedalDigestEntry']

/** Row of the squad's "who assists whom" table (assistant -> assisted killer). */
export type SquadAssistPair = components['schemas']['SquadAssistPair']

/**
 * The squad's "assists" block: the internal pairs AND the measurement's coverage
 * (`matches_measured` / `matches_total`). DIRECT re-export of the contract, without
 * rewriting `pairs: […] | null`: the nullable array is the feed's real shape.
 */
export type SquadAssistPairs = components['schemas']['SquadAssistPairs']

/**
 * THE ENGAGEMENT RANGE of every player in a match (batch N2, 2026-09-21): a
 * median frag distance per (match, player), and the match's LOBBY median — which is
 * computed over the frags, never as the average of the per-player medians. `lobby_delta_m`
 * is the signed gap in meters: it is what neutralizes the map and the mode. `measured`
 * mandatorily accompanies each median (position coverage makes the sample sizes
 * uneven from one player to another).
 */
export type MatchRangeBlock = components['schemas']['MatchRangeBlock']
export type MatchRangeProfile = components['schemas']['MatchRangeProfile']
export type MatchRangePlayer = components['schemas']['MatchRangePlayer']

// ─── batch U (2026-09-22, D23-4 / D23-a): the range's REFERENCE PERIOD ─────────
// `SessionPageResponse.range_reference` carries the same profiles as `range_profiles`, for
// the ONE consulted player, over the page's FILTER matches (the same reference as the usual
// one) — plus the two role bands (`role_low_m` / `role_high_m`, the 1/3 and
// 2/3 tiers of matches with >= 5 measured frags) and `period_median_delta_m`. All three are ABSENT
// TOGETHER under 3 full matches: no manufactured bands. A SINGLE block for both
// drawer columns — the reference depends on the filter, not on the displayed session.
// `TimeseriesPageResponse.range_profiles`, in contrast, is an ordinary `MatchRangeBlock` over the
// page's window (the consulted player alone, the whole lobby for the median).
export type RangeReferenceBlock = components['schemas']['RangeReferenceBlock']

export interface TeammatesPageResponse {
  options: TeammateOption[]
  teammates: TeammateRow[]
  total_matches: number
  session_labels: SessionLabelsList
  /** Total number of the player's configured friends. Used for the UI label "among N friends". */
  friends_count: number
  timeseries?: SquadTimeseriesPoint[]
  map_breakdown?: MapBreakdownRow[]
  match_series?: Record<string, SquadMatchSeriesPoint[]>
  match_history?: SquadMatchHistoryRow[]
  session_timeline?: SquadSessionPoint[]
  map_heatmap?: SquadMapHeatmap
  impact_matrix?: SquadImpactMatrix
  /**
   * "Impact points per evening and per role": the displayed evening and the previous evenings
   * of the composition, same roles and same scale as the matrix. Absent without a teammate
   * selected or when no role falls on the squad.
   */
  squad_impact_history?: SquadImpactHistory
  per_minute_stats?: SquadPerMinuteEntry[]
  synergy_radar?: SquadSynergyRadarSeries[]
  intensity_profile?: SquadIntensityProfile
  performance_series?: Record<string, SquadPerformanceSeriesPoint[]>
  /** Frag breakdown BY CLASS (D8) by gamertag — stacked bars of the
   *  "Frag breakdown" sub-chart of teammates.16. */
  frag_classes?: Record<string, FragClassEntry[]>
  /** "Tools of destruction" (D8): every frag named, by tool and by player. */
  weapon_tools?: SquadWeaponTools
  /** Multi-player "Accuracy by weapon" comparison (horizontal grouped bars).
   *  Native Halo 5 accuracy; absent on Infinite (capability weapon_accuracy). */
  weapon_accuracy?: SquadWeaponAccuracy
  native_kill_mechanics?: SquadKillMechanics
  /** First frag/death PER MATCH, one series per squad player (Dynamics tab). */
  first_blood?: FirstBloodPlayerSeriesDTO[]
  /** Pairs (assistant -> assisted killer) INTERNAL to the squad + the measurement's
   *  coverage. Absent when no match in the selection has a measured assist. */
  assist_pairs?: SquadAssistPairs
  /**
   * Header feeds <SessionBriefing> (solo mode if no teammate is selected, squad mode otherwise).
   * Standalone port note: the real type lives in `features/squad/v2/types`, a feature this
   * 3D-only viewer does not lift (unused by the replay scene). Loosened to `unknown`.
   */
  header?: unknown
  /** Main player's gamertag — used to identify the "me" card in header.player_cards. */
  main_player?: string
  /** MedalDigest feeds <MedalDigest> at the bottom of SquadSynergiesPage. */
  medal_digest?: MedalDigestEntry[]
  /** Sessions where the EXACT composition (main player + all selected
   *  teammates) played together. Feeds the SessionMultiSelect + the
   *  re-anchoring. Without a teammate: the main player's squad sessions. */
  composition_sessions?: SessionLabelEntry[]
  /** Label of the exact composition's most recent session (1st entry of
   *  composition_sessions). Empty if the composition never played together. */
  latest_composition_session?: string
  /** Best-effort loads that failed: the displayed numbers are partial.
   *  Non-empty => the UI must flag it (end of non-reproducible figures). */
  data_issues?: DataIssue[]
  /**
   * RANGE profiles per match (batch N2): every measured player of each match, their
   * median and their gap to the lobby median. Feeds the "Range roles" card of
   * the Synergies tab. Absent = no film decoded on the selection.
   */
  range_profiles?: MatchRangeBlock
  /**
   * "Formes retenues" block — the MATERIAL of the objective cards: one objective sheet per
   * match with an objective, both sides. Published by `TeammatesService.WithSquadFormes` over the
   * page's D2 scope; read by the Contributions objective cards.
   * Absent = scope with no match; `available:false` with a machine reason for a title without
   * `film.usage_summary`.
   */
  formes_retenues?: SquadFormesBlock
  /**
   * "Balance of power, evening after evening" (batch L3 of the
   * PLAN_EMPRISE_ET_CARTES_DEPLACEES_2026-09-26 plan, D6/D7): the displayed evening (D2 scope) and
   * the ten previous evenings of the composition with at least three matches with an objective. Shares in
   * 0..1. Absent without a teammate selected or without objective stats.
   */
  squad_objective_history?: SquadObjectiveHistory
  /**
   * "Emprise" block (batch L4 of the PLAN_EMPRISE_ET_CARTES_DEPLACEES_2026-09-26 plan): the pickups of
   * each resource (power-up, special weapons, rack weapons) by our side and by
   * the opponent, over the D2 scope — tally, match by match, item by item, who on our side,
   * production and habit. Result, score and dominance join in from `match_history`.
   * Absent = scope with no match. Read by the Emprise tab (batch L5).
   */
  squad_emprise?: SquadEmpriseBlock
}

/** Degradation of a best-effort load. `code` is a stable key translated
 *  frontend-side; `detail` (e.g. a gamertag) is used for diagnostics. */
export type DataIssue = components['schemas']['DataIssue']

// ---------------------------------------------------------------------------
// Synthesis (Slice 7)
// ---------------------------------------------------------------------------

export type SynthesisKPIs = components['schemas']['SynthesisKPIs']

export type ComparisonMetricItem = components['schemas']['ComparisonMetricItem']

export interface SynthesisQueryRequest {
  period?: string
  start_date?: string | null
  end_date?: string | null
  filters?: FilterContextInput | null
}

export interface HeatmapCell {
  dow: number    // 0 = Monday … 6 = Sunday
  hour: number
  count: number
  wins?: number
  win_rate?: number
}

export interface TopWeekItem {
  week_label: string
  /** ISO date (YYYY-MM-DD) of the week's Monday 00:00 UTC. For chronological sorting. */
  week_start: string
  match_count: number
  wins: number
  win_rate: number
  kd_ratio: number | null
  avg_kills?: number
  avg_deaths?: number
}

export type SynthesisDetailedStats = components['schemas']['SynthesisDetailedStats']

// PLAN_COMBAT_PROFILE_WIRING — 3-axis combat profile types.
export type CombatStyleOffensive = 'disperse' | 'irregulier' | 'equilibre' | 'precis' | 'chirurgical'
export type CombatStyleDefensive = 'fragile' | 'expose' | 'solide' | 'resistant' | 'inebranlable'
export type CombatStyleActivity = 'passif' | 'discret' | 'mesure' | 'actif' | 'agressif'

// Base = the generated OpenAPI schema (single source). The 3 styles are refined into
// typed unions (PLAN_COMBAT_PROFILE_WIRING) and avg_pace_ratio is kept (absolute
// engagement, live-fetch) until the OpenAPI schema is regenerated with it.
//
// The 3 styles stay `?` (optional) WITHOUT `| null`: the Go DTO emits them as
// `*string,omitempty` (never serialized as null — omitempty drops nil), so the
// contract is `string | undefined`. Keeping `| null` here made this type non-
// assignable to the generated KPIStats (style_*: string), and consumers already
// test for absence via `!= null` (covers both null AND undefined).
export type CombatProfileBlock = Omit<
  components['schemas']['CombatProfileBlock'],
  'style_offensive' | 'style_defensive' | 'style_activity'
> & {
  avg_pace_ratio?: number | null
  style_offensive?: CombatStyleOffensive
  style_defensive?: CombatStyleDefensive
  style_activity?: CombatStyleActivity
}

export interface SynthesisPageResponse {
  period: string
  total_matches: number
  solo_kpis: SynthesisKPIs
  squad_kpis: SynthesisKPIs
  comparison_metrics: ComparisonMetricItem[]
  heatmap_data: HeatmapCell[]
  top_weeks: TopWeekItem[]
  // Sprint 55 D5/D7 — D6 (rivalries) removed on 2026-05-27 (the
  // "In-game relations" section removed from the Synthesis page; encounters
  // stay exposed by the records/relations page).
  highlights_preview?: SynthesisHighlightsPreview
  breakdowns?: SynthesisBreakdowns
  // Sprint 55 D9 — scope + overview
  scope?: SynthesisScope
  overview?: SynthesisOverview
  // P9 — detailed stats by category
  detailed_stats?: SynthesisDetailedStats
  // Top frags by weapon (resolved label, unresolved weapon IDs excluded)
  top_weapon_kills?: SynthesisWeaponKillEntry[]
  // Hierarchical frag breakdown v2 (sunburst class->role) — title-agnostic.
  frag_distribution?: FragDistribution

  // Accuracy by weapon (native Halo 5) — every weapon fired, accuracy 0..1.
  // Omitted for titles that do not populate weapon_accuracy (Infinite).
  weapon_accuracy?: SynthesisWeaponAccuracyEntry[]
  // PLAN_COMBAT_PROFILE_WIRING Phase 1
  combat_profile?: CombatProfileBlock | null
  // Objective KPIs (CTF/Zones/Oddball cumulative over the scope) — omitted for a title without
  // the match.objective.stats capability (Halo 5) or a scope with no match with an objective.
  objective_stats?: ObjectiveAggregate | null
  // Distance records by weapon (each weapon's farthest measured frag, identified
  // to open the replay at that instant) — omitted for a title without per-kill positions (Halo 5)
  // or a scope with no measured frag. See PLAN_RECORDS_DISTANCE_2026-09-20.md.
  weapon_records?: SynthesisWeaponRecords | null
  // Why `weapon_records` is missing when the title measures per-kill positions and the scope carries
  // frags: film analysis in progress, or no frag with a read position. Absent when the block is served or the
  // function does not exist for the title.
  weapon_records_gap?: 'pending' | 'missing'
}

// Distance records by weapon: the block, a row, the record's frag, an excluded weapon.
// Re-exports from the OpenAPI contract (`domain.SynthesisWeaponRecords`), never a manual mirror.
export type SynthesisWeaponRecords = components['schemas']['SynthesisWeaponRecords']
export type WeaponDistanceRecordRow = components['schemas']['WeaponDistanceRecordRow']
export type WeaponRecordFrag = components['schemas']['WeaponRecordFrag']
export type WeaponExcludedFromRecords = components['schemas']['WeaponExcludedFromRecords']

// Cumulative objective stats (CTF/Zones/Oddball) over a scope — shared by Synthesis/Squad.
export type ObjectiveAggregate = components['schemas']['ObjectiveAggregate']

export type SynthesisWeaponKillEntry = components['schemas']['SynthesisWeaponKillEntry']

// Accuracy by weapon — accuracy in the 0..1 unit (the component multiplies by 100).
export type SynthesisWeaponAccuracyEntry = components['schemas']['SynthesisWeaponAccuracyEntry']

// Range by weapon (frags AND deaths) — the whole block, its rows, a side, a weapon under
// the publication threshold, and the opening proxy. Re-exports from the OpenAPI contract: the shape
// is the service's own (`domain.SynthesisWeaponRange`), never a manual mirror.
export type SynthesisWeaponRange = components['schemas']['SynthesisWeaponRange']
export type WeaponRangeRow = components['schemas']['WeaponRangeRow']
export type WeaponRangeSide = components['schemas']['WeaponRangeSide']
export type WeaponBelowThreshold = components['schemas']['WeaponBelowThreshold']
// The opening proxy and its paired delta: `opening` is OMITTED when no opening is
// measured, `opening.delta` when no frag could be paired to it. The two
// absences say two different things and the UI distinguishes them (see the plan, D5).
export type SynthesisOpening = components['schemas']['SynthesisOpening']
export type SynthesisOpeningDelta = components['schemas']['SynthesisOpeningDelta']

// Hierarchical frag breakdown v2 (sunburst class->role) — title-agnostic,
// shared by Synthesis/Match view/Timeseries/Sessions. See domain/frag_distribution.go.
export type FragDistribution = components['schemas']['FragDistribution']
export type FragClassEntry = components['schemas']['FragClassEntry']
export type FragRoleEntry = components['schemas']['FragRoleEntry']

// Sprint 55 D9 — Scope
export type SynthesisScope = components['schemas']['SynthesisScope']

// Sprint 55 D9 — Overview
export type SynthesisOverview = components['schemas']['SynthesisOverview']

export type BestMatchRef = components['schemas']['BestMatchRef']

// Sprint 55 D5 — Highlights
export type SynthesisMatchHighlight = components['schemas']['SynthesisMatchHighlight']

export type SynthesisHighlightsPreview = components['schemas']['SynthesisHighlightsPreview']

// Sprint 55 D7 — Breakdowns
export type SynthesisMapEntry = components['schemas']['SynthesisMapEntry']

export type SynthesisModeEntry = components['schemas']['SynthesisModeEntry']

export type SynthesisBreakdowns = components['schemas']['SynthesisBreakdowns']

// ---------------------------------------------------------------------------
// Media (Slice 8)
// ---------------------------------------------------------------------------

export interface MediaItemRow {
  basename: string
  file_path: string
  kind: string
  thumbnail_path: string | null
  match_id: string | null
  capture_end_utc: string | null
  match_start_time: string | null
  section: string
  owner_gamertag: string | null
  map_name: string | null
  mode_name: string | null
  liked: boolean
  like_count: number
  /** Names of the first 3 likers (shown inline) */
  likers?: string[]
  /** Total number of people who liked it */
  total_likers?: number
}

export interface MediaAvailableFilters {
  playlists: LabelValue[]
  maps: LabelValue[]
  modes: LabelValue[]
}

export interface MediaQueryRequest {
  sort?: string
  kind_filter?: string | null
  section_filter?: string | null
  /** Explicit player_slug whitelist; takes priority over section_filter if non-empty. */
  author_slugs?: string[] | null
  /** playlist_id (UUID) or a raw label. */
  playlist_filter?: string | null
  map_filter?: string | null
  mode_filter?: string | null
  group_by?: string | null
  liked_only?: boolean | null
  unassigned_only?: boolean | null
  pagination?: PaginationRequest
}

export interface MediaPageResponse {
  items: PaginatedResponse<MediaItemRow>
  total_mine: number
  total_teammates: number
  total_unassigned: number
  available_filters: MediaAvailableFilters
}

// Phase D — re-shim: the OpenAPI contract now covers these media types (schemas
// auto-derived from the Go structs at the time of the Huma /media/* migration). Pure data
// (zero client-computed field) -> direct re-export of the contract.
export type MediaAuthor = components['schemas']['MediaAuthor']
export type MediaMatchLobbyEntry = components['schemas']['MediaMatchLobbyEntry']
export type MediaMatchCandidate = components['schemas']['MediaMatchCandidate']
export type MediaMatchCandidatesResponse = components['schemas']['MediaMatchCandidatesResponse']

export interface MediaAssociateRequest {
  file_path: string
  match_id: string
}

export type MediaAssociateResponse = components['schemas']['MediaAssociateResponse']
export type MediaAuthorsResponse = components['schemas']['MediaAuthorsResponse']
/** Permanent deletion of a media item (item 3.1) — derived from the contract. */
export type MediaDeleteResponse = components['schemas']['MediaDeleteResponse']

/**
 * PATCH /media/likes — derived from the contract (2026-08-03). The hand-written
 * versions diverged from the server on two points: `total_likers` was
 * optional there while the Go DTO always emits it (no `omitempty`), and the
 * request carried a `liker_slug` the frontend never sent — the liker is
 * resolved server-side from the session (handlers.resolveLikerIdentity).
 */
export type MediaLikeRequest = components['schemas']['MediaLikeRequest']
export type MediaLikeResponse = components['schemas']['MediaLikeResponse']

export interface MediaUploadResponse {
  saved: number
  new_indexed: number
  associated: number
  thumbnails: number
  errors?: string[]
}

// ---------------------------------------------------------------------------
// Match View (Slice 4B)
// ---------------------------------------------------------------------------

export type MatchViewHeader = components['schemas']['MatchViewHeader']

export type MatchViewRank = components['schemas']['MatchViewRank']

// Canonical MatchEvents (PLAN_CANONICAL_MATCH_EVENTS) — an on-demand event
// timeline (kill feed / timeline). Auto-derived schemas (canonical.MatchEvent*).
export type MatchEventTimeline = components['schemas']['MatchEventTimeline']

export type MatchEvent = components['schemas']['MatchEvent']

export type Vec3 = components['schemas']['Vec3']

// Sprite fields (Halo 5 medals) — manual shim like AssetMeta / MedalDigestItem.
export type MatchMedal = components['schemas']['MatchMedal'] & {
  sprite_sheet?: string
  sprite_left?: number
  sprite_top?: number
  sprite_width?: number
  sprite_height?: number
}

export type MatchCitation = components['schemas']['MatchCitation']

export type MatchSummaryKpis = components['schemas']['MatchSummaryKpis']

export type MatchPersonalResult = components['schemas']['MatchPersonalResult']

export type MatchExpectedStats = components['schemas']['MatchExpectedStats']

export type MatchSummaryTab = components['schemas']['MatchSummaryTab']

export type PlayerWeaponKillRow = components['schemas']['PlayerWeaponKillRow']

// Sprite fields (Halo 5 medals) — manual shim like MatchMedal / MedalDigestItem.
// Without them, the scoreboard drawer showed empty H5 medals (GH-5a) for lack of a PNG.
export type PlayerMedalRow = components['schemas']['PlayerMedalRow'] & {
  sprite_sheet?: string
  sprite_left?: number
  sprite_top?: number
  sprite_width?: number
  sprite_height?: number
}

export interface MatchHighlightEvent {
  event_time_ms: number | null
  event_type: string
  actor_xuid: string | null
  /**
   * Gamertag already resolved server-side via `v_gamertag_lookup`
   * (bots -> "343 Bot N", alias/participants/raw fallback cascade).
   * Prefer this field over `actor_xuid` for display. Optional: absent
   * from the JSON when the backend runs a pre-RC6 version, or null if
   * the xuid is completely orphaned (never in the DB).
   */
  actor_gamertag?: string | null
  target_xuid: string | null
  weapon_id: number | null
  /**
   * The actor's team (the KILLER on a `kill` event), resolved server-side from the
   * scoreboard. Absent if the actor is not in it. The replay uses it to attribute a frag
   * to a side (Dominance track, `KillEvent.teamID`); it colors nothing — the feed's ink
   * comes from the film's team.
   */
  actor_team_id?: number | null
  /**
   * THE KILL'S WEAPON. Populated only when the kill's damage source is known AND
   * unambiguously identified by the backend. Absent otherwise: the feed shows the kill
   * with no icon, and that is the accepted fallback — never another weapon's icon.
   *
   * `weapon_label` is a PROPER name (BR75, Needler), not a translated label: it does
   * not go through i18n.ts. Empty for sources with no proper name (melee, grenade), which
   * keep their icon.
   *
   * `weapon_image_tinted` says the image is a MASK to be tinted (see WeaponIcon) —
   * never infer it from the URL's shape.
   */
  weapon_key?: string | null
  weapon_label?: string | null
  weapon_image_url?: string | null
  weapon_image_tinted?: boolean | null
  /**
   * Was the fatal damage a headshot? Populated iff the damage source is known
   * AND unambiguous — INDEPENDENTLY of the `weapon_*` fields above (headshot does not
   * depend on any icon resolution). Absent = not measurable, NEVER false (G.1,
   * 2026-08-30). STRICT backend filter: `HeadshotMultiplier` is never part of it.
   */
  headshot?: boolean | null
  /**
   * The kill's ASSIST, read from the film — THREE states that are NEVER confused:
   * absent/'' = UNKNOWN (no kill-event matched); 'none' = MEASURED, no
   * assistant; 'named' = a named assistant (+ damage shares when they are read).
   * Never treat the absence as "no assistant": that is the lie this
   * enumeration exists to prevent.
   *
   * The shares are WHOLE %, NOT bounded to 100 (measured up to 228 — overkill
   * damage, an unestablished hypothesis). Absent = unmeasured, never 0.
   */
  assist_state?: string | null
  assist_gamertag?: string | null
  assist_team_id?: number | null
  killer_damage_pct?: number | null
  assist_damage_pct?: number | null
  /**
   * The kill's VICTIM, joined server-side from killer_victim_pairs by the
   * (killer, instant) key with a unanimity guard: two distinct victims on the same
   * key (a double kill at the same millisecond) name NEITHER. Absent when the
   * pair is missing — never a random victim.
   */
  victim_xuid?: string | null
  victim_gamertag?: string | null
  victim_team_id?: number | null
  /**
   * THE MEDAL'S IDENTITY (`medal` events only). medal_name is the ENGLISH
   * name read from the film (a measured quantity); label/description are resolved
   * locale-aware server-side (medal_definitions), medal_image_url is the reference's
   * image. Resolution absent -> only medal_name travels: the frontend writes it out in
   * full, never another medal's image.
   */
  medal_name?: string | null
  medal_name_id?: number | null
  medal_label?: string | null
  medal_description?: string | null
  medal_image_url?: string | null
}

export type MatchTugOfWarBin = components['schemas']['MatchTugOfWarBin']

export type MatchImpactBadge = components['schemas']['MatchImpactBadge']

export type MatchKDTimelinePoint = components['schemas']['MatchKDTimelinePoint']

/** Aggregated killer->victim pair for the match_view.18 chart (antagonists). */
export type MatchKillerVictimPair = components['schemas']['MatchKillerVictimPair']

/** Pair (assistant -> assisted killer) aggregated over the match. */
export type MatchAssistPair = components['schemas']['MatchAssistPair']

/**
 * "Assists" block: the pairs AND the scope of their measurement.
 *
 * DIRECT re-export of the contract, without rewriting `pairs: […] | null`: the nullable
 * array is the feed's real shape (huma serializes every Go slice this way) and
 * hiding it would make the component carry a silent `undefined`. `measured_deaths` at 0
 * = "not measured"; an empty `pairs` with `measured_deaths` > 0 = "no assist".
 */
export type MatchAssistPairs = components['schemas']['MatchAssistPairs']

/**
 * POC (BATCH G.3, 2026-08-30): a weapon, its measured kills and its killer-victim
 * distance for ONE player on THIS match. `measured_kills` is ALWAYS
 * <= the weapon's total kill count (position coverage measured at a 75.8% floor,
 * never 100%).
 */
export type MatchKillDistanceWeapon = components['schemas']['MatchKillDistanceWeapon']

/**
 * POC (BATCH G.3): grouping the measured weapons by player (xuid). No
 * gamertag here — resolved frontend-side from the already-loaded scoreboard (same
 * pattern as MatchObjectivesSection).
 */
export type MatchKillDistancePlayer = components['schemas']['MatchKillDistancePlayer']

export interface MatchCombatTab {
  highlight_events: MatchHighlightEvent[]
  /** V7 */
  tug_of_war: MatchTugOfWarBin[]
  /** Deprecated. Prefer impact_roles (8 typed narrative roles). */
  impact_badges: MatchImpactBadge[]
  kd_timeline: MatchKDTimelinePoint[]
  nemesis_duels: MatchNemesisRow[]
  /** Aggregated killer->victim pairs (match_view.18). Empty if killer_victim_pairs is absent. */
  killer_victim?: MatchKillerVictimPair[]
  /**
   * Pairs (assistant -> assisted killer) + the measurement's scope. ABSENT when the match
   * has no film row at all: the UI then renders nothing.
   */
  assist_pairs?: MatchAssistPairs
  /** MV2 Phase 1: 8 typed narrative roles via narrative.IdentifyImpactRoles. */
  impact_roles?: MatchViewImpactRole[]
  /** MV2 Phase 1: intra-match cadence (ChartSeries<ChartPointStacked>). */
  cadence?: MatchViewCadence | null
  /**
   * Hierarchical frag breakdown v2 (sunburst class->role) of the viewer for this
   * match. Nil if the viewer has no kill (the frontend renders null). See P3.
   */
  frag_distribution?: FragDistribution
  /**
   * POC (BATCH G.3, 2026-08-30, user-feedback plan §3bis DEC-8): measured
   * kills and average killer-victim distance by weapon, PER PLAYER (not
   * just the viewer), for this match. Absent/empty if no kill has a
   * measured position — a clean degradation, never an error.
   */
  kill_distance_by_weapon?: MatchKillDistancePlayer[]
  /** "Tools of destruction" of the page's player (Squad and Sessions builder). */
  weapon_tools?: SquadWeaponTools | null
}

/** MV2: an assigned narrative role (1 entry per player x role). */
export type MatchViewImpactRole = components['schemas']['MatchViewImpactRole']

/** MV2: cadence chart (mirror domain.ChartSeries<ChartPointStacked>). */
export interface MatchViewCadence {
  key: string
  label_key?: string
  datapoints: Array<{
    category: string
    components: Record<string, number>
  }>
  meta?: Record<string, unknown>
}

/** MV4.B: a 6-axis radar series per player. */
export interface MatchViewRadarSeries {
  xuid: string
  gamertag?: string
  axes: Array<{
    Axis: string
    Value: number
    Raw: number
  }>
  mode_family?: string
}

export interface MatchScoreboardRow {
  xuid: string
  gamertag: string
  team_side: string | null
  /** Localized team label supplied by the backend (Halo 5: "Rouge"/"Red"
   *  from team_colors). Absent/empty for titles with no team reference
   *  (Halo Infinite) -> the frontend falls back to resolveTeamName (Eagle/Cobra). */
  team_name?: string | null
  /** Team identity color (#RRGGBB) supplied by the backend (Halo 5: from
   *  team_colors), absent for Halo Infinite. The frontend does not read it: a
   *  side's color is its allegiance token (`team-ally` / `team-enemy`), adjustable in
   *  accessibility settings. */
  team_color?: string | null
  is_me: boolean
  /** True if the participant was detected as a bot (xuid in "bid(N.0)" format). */
  is_bot?: boolean
  /**
   * Participation (PlayerParticipationInfo API): WHO joined/left MID-
   * game, and WHEN (RFC3339 UTC). Absent on matches from before these columns — the
   * replay then derives presence from the film's life bounds (presenceFeed.ts).
   */
  joined_in_progress?: boolean | null
  left_in_progress?: boolean | null
  first_joined_time?: string | null
  last_leave_time?: string | null
  rank: number | null
  score: number | null
  kills: number | null
  deaths: number | null
  assists: number | null
  kda?: number | null
  shots_fired: number | null
  shots_hit: number | null
  accuracy: number | null
  damage_dealt: number | null
  damage_taken: number | null
  average_life: string | null
  avg_life_seconds?: number | null
  headshot_kills: number | null
  max_killing_spree: number | null
  perfect_kills: number | null
  power_weapon_kills: number | null
  melee_kills: number | null
  grenade_kills?: number | null
  // Native Halo 5 kill mechanics (assassinations + Spartan abilities) — null outside h5.
  assassination_kills?: number | null
  ground_pound_kills?: number | null
  shoulder_bash_kills?: number | null
  /** Canonical outcome key (MT-06): the web localizes via useOutcomeLabel/useOutcomeMapping. */
  outcome?: 'win' | 'loss' | 'tie' | 'dnf'
  top_weapon_id?: number | null
  top_weapon_label?: string | null
  expected_kills?: number | null
  expected_deaths?: number | null
  expected_assists?: number | null
  /** True if the expected K/D come from the local model (Halo 5), not from the skill API. */
  locally_estimated?: boolean
  weapon_kills?: PlayerWeaponKillRow[]
  /** Medals won by THIS player in this match (scoreboard expander). */
  medals?: PlayerMedalRow[]
  /** True if there was a bot on the player's team — only for tracked players. */
  had_bot_teammate?: boolean
  /** Skill rank (CSR/LUSR) for this match — only for tracked players. */
  skill_rank?: MatchScoreboardSkillRank | null
  /** Objective stats (CTF/Zones/Oddball) — null outside an objective mode or an unsupported
   *  title (objective_stats capability). Only the played mode's fields are non-nil. */
  objective?: MatchScoreboardObjective | null
}

export type MatchScoreboardSkillRank = components['schemas']['MatchScoreboardSkillRank']

export type MatchScoreboardObjective = components['schemas']['MatchScoreboardObjective']

export type MatchRosterRow = components['schemas']['MatchRosterRow']

export type MatchNemesisRow = components['schemas']['MatchNemesisRow']

export type MatchEncounterRow = components['schemas']['MatchEncounterRow']

export interface MatchTeamTab {
  roster: MatchRosterRow[]
  scoreboard: MatchScoreboardRow[]
  nemesis: MatchNemesisRow[]
  encounters: MatchEncounterRow[]
}

/** A media item associated to a match — the shape REALLY served in `media_tab.media_items`. */
export type MatchAssociatedMedia = components['schemas']['MatchAssociatedMedia']

export type MatchMediaTab = components['schemas']['MatchMediaTab']

export type MatchCitationsTab = components['schemas']['MatchCitationsTab']

/** NATIVE commendation (Halo 5) earned on a match — displayed as-is. */
export type MatchNativeCommendation = components['schemas']['MatchNativeCommendation']

export interface MatchViewResponse {
  header: MatchViewHeader
  rank: MatchViewRank
  summary_tab: MatchSummaryTab
  combat_tab: MatchCombatTab
  team_tab: MatchTeamTab
  media_tab: MatchMediaTab
  citations_tab: MatchCitationsTab
  /** MV4.B Phase 1: 6-axis radar per player (empty if awards are absent). */
  radar?: MatchViewRadarSeries[]
  /** Sprint 54-B: privacy warning */
  privacy_warning?: MatchPrivacyWarning | null
  /**
   * RC6 — true when the match has its `match_registry` populated but at least
   * one critical secondary source is empty (scoreboard / events / stats /
   * medals). The strict 404 remains for match_id values totally absent from the DB.
   * The frontend shows a degraded banner instead of the error screen.
   */
  is_partial?: boolean
  /**
   * Stable codes for the reasons behind the partiality. Used to translate into
   * i18n messages frontend-side ("incomplete sync", "expired film", etc.).
   * Codes: "<source>_empty" (scoreboard, events, player_stats, medals: read succeeded, nothing to show),
   * "<source>_unavailable" and "section_unavailable" (read FAILED: a transient view, never cached).
   */
  partial_reasons?: string[]
  /** The match's Emprise, cards = the page player's team's players (absent without them). */
  emprise?: MatchEmpriseBlock | null
  /** Each teammate's "isolation", in the same order as the Emprise's cards. */
  lives_near_teammate?: MatchLivesNearTeammate | null
}

export type MatchEmpriseBlock = components['schemas']['MatchEmpriseBlock']
export type MatchLivesNearTeammate = components['schemas']['MatchLivesNearTeammate']
export type MatchLivesPlayer = components['schemas']['MatchLivesPlayer']

/** Prev/next navigation between a player's adjacent matches (chronological order). */
export type MatchNeighbors = components['schemas']['MatchNeighbors']

// ---------------------------------------------------------------------------
// Citations (Slice 2B)
// ---------------------------------------------------------------------------

/** A citation enriched with its tiered progress. */
export type CitationItem = components['schemas']['CitationItem']

/** Group of citations by category. */
export type CitationCategoryGroup = components['schemas']['CitationCategoryGroup']

export interface CitationsQueryRequest {
  filters: FilterContextInput
}

export type CitationsPageResponse = components['schemas']['CitationsPageResponse']

// Lifetime totals of native commendations (Halo 5, AXIS B).
export type NativeCommendationTotal = components['schemas']['NativeCommendationTotal']
export type NativeCommendationCategoryGroup = components['schemas']['NativeCommendationCategoryGroup']
export type NativeCommendationsTotalsResponse =
  components['schemas']['NativeCommendationsTotalsResponse']

// ---------------------------------------------------------------------------
// Timeseries (Slice 3B)
// ---------------------------------------------------------------------------

/** A point of a cumulative or rolling curve indexed on matches. */
export type CumulativePoint = components['schemas']['CumulativePoint']

/** A bucket of a distribution histogram. */
export type DistributionBucket = components['schemas']['DistributionBucket']

/** An (x, y) pair for a correlation scatter plot. */
export type CorrelationDataPair = components['schemas']['CorrelationDataPair']

/** A point of the intensity heatmap (day x hour). */
export type IntensityHeatmapPoint = components['schemas']['IntensityHeatmapPoint']

/** A raw per-match row for the frontend's timeline charts. */
export type TimeseriesMatchRow = components['schemas']['TimeseriesMatchRow']

export type TimeseriesSummaryTab = components['schemas']['TimeseriesSummaryTab']

export type TimeseriesCumulTab = components['schemas']['TimeseriesCumulTab']

export type TimeseriesIntensityTab = components['schemas']['TimeseriesIntensityTab']

export type TimeseriesDistributionsTab = components['schemas']['TimeseriesDistributionsTab']

export interface TimeseriesQueryRequest {
  filters: FilterContextInput
}

/** RankDelta — skill rating delta over the scope. Mirror of Go's domain.RankDelta.
 *  Kind = "csr" (ranked) or "lusr" (unranked); value = signed sum of the
 *  per-match deltas; count = match count of the Kind retained in the scope. */
export type RankDelta = components['schemas']['RankDelta']

/** KPIStats — the player's aggregates over the filtered scope. Mirror of Go's domain.KPIStats. */
export type KPIStats = components['schemas']['KPIStats']

export type TimeseriesWeaponKill = components['schemas']['TimeseriesWeaponKill']

/** Frag breakdown by type over the period (1st tab's donut, Halo 5). */
export type TimeseriesKillTypes = components['schemas']['TimeseriesKillTypes']

export type OutcomesPeriodPoint = components['schemas']['OutcomesPeriodPoint']

/** A player's first frag/death on ONE match (seconds, null = event absent). */
export type FirstBloodMatchPointDTO = components['schemas']['FirstBloodMatchPoint']

/** A player's "first frag / first death" series — the payload of the 3 surfaces
 *  (Squad/Dynamics, Timeseries, Session). The DTO suffix avoids a collision
 *  with the `FirstBloodLanes` component's props type. */
export type FirstBloodPlayerSeriesDTO = components['schemas']['FirstBloodPlayerSeries']

/** Row of the solo intensity heatmap (1 match x 10 normalized phases). */
export type IntensityMatchRow = components['schemas']['IntensityMatchRow']

/** Aggregate per session/week/month (the "Solo performance per session" chart). */
export type SoloSessionPerfPoint = components['schemas']['SoloSessionPerfPoint']

/** Block with auto-adaptive granularity + points. */
export type SoloSessionPerfBlock = components['schemas']['SoloSessionPerfBlock']

export type TimeseriesPageResponse = components['schemas']['TimeseriesPageResponse']

// ---------------------------------------------------------------------------
// Session Compare (Slice 3C)
// ---------------------------------------------------------------------------

/** A data point per match for the progression charts (K/D, cumulative, accuracy). */
export type SessionMatchPoint = components['schemas']['SessionMatchPoint']

/** Axis of the 6-axis participation profile, normalized 0..100. */
export type SessionParticipationAxis = components['schemas']['SessionParticipationAxis']

// Base = the generated OpenAPI schema (single source). avg_pace_ratio is kept
// (average absolute engagement, pace_joueur/pace_lobby; 1.0 = lobby pace), added via
// live-fetch and consumed by SessionCompareEngagement, until the OpenAPI schema is
// regenerated with it (the generated one still carries avg_residual_brut).
export type SessionCompareEntry = components['schemas']['SessionCompareEntry'] & {
  avg_pace_ratio?: number | null
}

export type SessionCompareMetricRow = components['schemas']['SessionCompareMetricRow']

export type SessionDetailMatchRow = components['schemas']['SessionDetailMatchRow']

export type SessionCompareSuggestion = components['schemas']['SessionCompareSuggestion']

export interface SessionPageRequest {
  filters?: FilterContextInput
  session_label?: string | null
  compare_session_label?: string | null
  enable_compare?: boolean
  /** Locale ("fr" | "en") for the FR/EN resolution of maps/modes/playlists. */
  locale?: string
}

export type SessionPageResponse = components['schemas']['SessionPageResponse']

// ─── Wave 3 (D22): cross-cutting Support / Range sections ─────────────────────────────
// Go contract: internal/domain/coordination.go and internal/domain/match_range.go, served
// WITHIN the existing page response (no extra request). `Couverture` is the same
// type as on the Tactical side (rate + raw + per match + N + a low-sample flag):
// a single definition, two reading aliases.
// The `CoordinationBlock` / `CoordinationMatchPoint` / `Couverture` aliases are placed at the end of the
// file (batch Q's block, shared by Sessions and Timeseries).
// `MatchRangeBlock` / `MatchRangeProfile` / `MatchRangePlayer` (batch N2) are already aliased
// above, placed by batch R for the Squad: the Sessions page reads them as-is.

// ─── "Formes retenues" block: the material of the objective cards (Squad > Contributions,
// Timeseries > Usages). Go contract: internal/domain/squad_formes.go. The block carries
// NO aggregate — the shares are computed in `features/squad/objectif/` and
// `features/squad/formes/model/objectives.ts`, right where they are displayed.

export type SquadFormesBlock = components['schemas']['SquadFormesBlock']
/** The balance of power at the objective, evening after evening (batch L3, D6/D7). */
export type SquadObjectiveHistory = components['schemas']['SquadObjectiveHistory']
export type SquadObjectiveEvening = components['schemas']['SquadObjectiveEvening']
export type SquadFormesMatch = components['schemas']['SquadFormesMatch']

export type SquadFormesObjective = components['schemas']['SquadFormesObjective']
export type SquadFormesObjectiveColumn = components['schemas']['SquadFormesObjectiveColumn']
export type SquadFormesObjectivePlayer = components['schemas']['SquadFormesObjectivePlayer']

// ─── "Emprise" block (batch L4 of the PLAN_EMPRISE_ET_CARTES_DEPLACEES_2026-09-26 plan). Go contract:
// internal/domain/squad_emprise.go. Resources are a LIST (a resource with no data is
// absent); result, score and dominance join in from `match_history` by `match_id`.
export type SquadEmpriseBlock = components['schemas']['SquadEmpriseBlock']
export type SquadEmpriseMatch = components['schemas']['SquadEmpriseMatch']
export type SquadEmpriseObject = components['schemas']['SquadEmpriseObject']
export type SquadEmpriseObjectShare = components['schemas']['SquadEmpriseObjectShare']
export type SquadEmpriseCount = components['schemas']['SquadEmpriseCount']
export type SquadEmpriseHabit = components['schemas']['SquadEmpriseHabit']
export type SquadEmpriseEvening = components['schemas']['SquadEmpriseEvening']
// Life placement (PLAN_EMPRISE_VIES_2026-09-28 plan, batch V3): the `squad_emprise.placement` block.
export type SquadEmprisePlacement = components['schemas']['SquadEmprisePlacement']
export type SquadEmprisePlacementPlayer = components['schemas']['SquadEmprisePlacementPlayer']
export type SquadEmprisePlacementLife = components['schemas']['SquadEmprisePlacementLife']
export type SquadEmprisePlacementQuadrant = components['schemas']['SquadEmprisePlacementQuadrant']['quadrant']
// The Emprise of the Timeseries' solo scope (PLAN_TIMESERIES_USAGES_EMPRISE_2026-10-05 plan,
// D2): the Squad's block, plus the per-map and equipment grid. Go contract:
// internal/domain/solo_emprise.go; "My lives": internal/domain/timeseries_lives.go.
export type SoloEmpriseBlock = components['schemas']['SoloEmpriseBlock']
export type EmpriseMapColumn = components['schemas']['EmpriseMapColumn']
export type EmpriseEquipmentFamily = components['schemas']['EmpriseEquipmentFamily']
export type TimeseriesLivesNearTeammate = components['schemas']['TimeseriesLivesNearTeammate']

// ─── Sprint 54-C : Compare joueur vs joueur ───────────────────────────────────

export interface NormalizedPlayerStats {
  xuid: string
  gamertag: string
  title_slug: string
  is_local: boolean
  matches: number
  win_rate: number
  kda: number
  kdr: number
  kills_per_game: number
  deaths_per_game: number
  assists_per_game: number
  accuracy: number
  damage_per_game: number
  // Phase 2 — enriched metrics
  damage_taken_per_game: number
  perfect_kills_per_game: number
  max_killing_spree: number
  avg_life_secs: number
  headshot_kills_per_game: number
  perf_ath: number
  lusr_ath: number
  career_rank: number
  /** Localized career rank title ("Platinum General VI"). Empty if the rank is unknown. */
  career_rank_label?: string
  /** Current peak CSR (current season), fetched live. 0 if unranked. */
  highest_csr?: number
  /** Tier label of the current peak CSR ("Platinum IV"). */
  highest_csr_label?: string
  /** All-time peak CSR. 0 if none. */
  highest_csr_all_time?: number
  /** Tier label of the all-time peak CSR ("Onyx"). */
  highest_csr_all_time_label?: string
  /** Lifetime cumulative playtime (s) from the Waypoint service record. */
  time_played_seconds?: number
  extended?: Record<string, unknown>
}

export type CompareMetricRow = components['schemas']['CompareMetricRow']

export interface CompareRequest {
  target_gamertag: string
}

export interface CompareResponse {
  player_a: NormalizedPlayerStats
  player_b: NormalizedPlayerStats
  metrics: CompareMetricRow[]
  title_slug: string
  /** Narrative badges ally_plus / tough_enemy / ordinal for player B (best-effort). */
  encounter_badges?: MatchEncounterBadge[]
  /** C3.6: warning if player B is private or not found. */
  privacy_warning?: MatchPrivacyWarning | null
  /** C3.6: indicates whether player B's data is partial (null fields). */
  player_b_partial?: boolean
  /**
   * Both players' weapon profile.
   * ADDITIVE and absent when it is not readable: a title without a weapon registry, player B
   * absent from the shared database, missing wiring.
   *
   * Typed FROM THE GENERATED CONTRACT, unlike the rest of this hand-written interface: the new
   * field has no reason to diverge again from the contract, and migrating the whole interface is a
   * separate batch (recorded as a Discovery item in the plan).
   */
  weapons?: components['schemas']['CompareWeaponProfile']
}

/** A side of the weapon profile — the scope, the classes, range by role, the top 3. */
export type CompareWeaponSide = components['schemas']['CompareWeaponSide']

/** A weapon class and the share of the player's frags it carries. */
export type CompareFragClass = components['schemas']['CompareFragClass']

/** A top-3 weapon: bilingual name, frags, registry dimensions, icon. */
export type CompareTopWeapon = components['schemas']['CompareTopWeapon']

// ─── Sprint 54-B : Match Privacy ─────────────────────────────────────────────

export type MatchPrivacyInfo = components['schemas']['MatchPrivacyInfo']

export type MatchPrivacyWarning = components['schemas']['MatchPrivacyWarning']

// ─── Sprint 54-E : Leaderboard ───────────────────────────────────────────────

export type LeaderboardEntry = components['schemas']['LeaderboardEntry']

export interface LeaderboardRequest {
  category?: string
  season_id?: string
  playlist_id?: string
  limit?: number
}

export type LeaderboardResponse = components['schemas']['LeaderboardResponse']

export type LeaderboardCatalogRef = components['schemas']['LeaderboardCatalogRef']

export type LeaderboardCatalog = components['schemas']['LeaderboardCatalog']

// ---------------------------------------------------------------------------
// Auth locale
// ---------------------------------------------------------------------------

export interface LoginRequest {
  username: string
  password: string
}

export type LoginResponse = components['schemas']['LoginResponse']

export interface RegisterRequest {
  username: string
  password: string
  invite_code?: string
}

export type RegisterResponse = components['schemas']['RegisterResponse']

export type AdminUserSummary = components['schemas']['AdminUserSummary']

export type AdminInviteSummary = components['schemas']['AdminInviteSummary']

// Contract GENERATED from Huma: `group_id` (membership in a group) and
// `join_url` (relative /join?invite= link, rendered server-side) appear in it
// since 2026-09-15 — no more fields to add by hand.
export type InviteCode = components['schemas']['InviteCode']

// ---------------------------------------------------------------------------
// Groups / families (mutual data access)
// ---------------------------------------------------------------------------
// Contract GENERATED from Huma (V72-01 / H5 then H7): the /groups routes are typed
// server-side, with `role` as an enum (owner|member) and `members` non-nullable -> direct re-export,
// no more manual type to keep in sync in parallel.

export type GroupMember = components['schemas']['GroupMember']
export type Group = components['schemas']['Group']
/** Union derived from the contract (no hardcoded literal: the enum lives in domain/group.go). */
export type GroupRole = GroupMember['role']

// ---------------------------------------------------------------------------
// Xbox RTA presence watcher
// ---------------------------------------------------------------------------

export interface WatcherLastSeen {
  /** RFC3339 UTC timestamp (e.g. "2026-05-25T20:00:36Z") */
  timestamp: string
  /** Game name (e.g. "Halo Infinite") */
  title_name: string
  /** Xbox title ID (optional) */
  title_id?: string
}

export interface WatcherPlayerStatus {
  gamertag: string
  xuid: string
  /** Watcher FSM state: "Idle" / "Watching" / "Syncing" / "Cooling" */
  state: string
  /** Raw Xbox state: "Online" / "Away" / "Offline" — empty if no event was received */
  presence_state?: string
  in_game: boolean
  state_since: string
  state_duration: string
  cooldown_left?: string
  subscribe_error?: string
  /** Last known Xbox activity (an Offline snapshot). Set by the REST poll. */
  last_seen?: WatcherLastSeen
  /** RFC3339 UTC of the last presence event received (each successful REST poll). The feed's liveness. */
  last_event_at?: string
}

export type WatcherStatusResponse = components['schemas']['WatcherStatusResponse']

export interface WatcherAuthAttempt {
  attempt_id: string
  user_code: string
  verification_url: string
  expires_in: number
}

export interface WatcherAuthStatus {
  status: 'pending' | 'authorized' | 'failed' | 'expired'
  error_code?: string
  gamertag?: string
  xuid?: string
}

// ---------------------------------------------------------------------------
// Asset Drawer (Phase 2)
// ---------------------------------------------------------------------------

// AssetMeta — regenerated contract type. The sprite fields (Halo 5 medals) and
// description are now carried (the server resolves them in the request's language) by the OpenAPI schema (optional:
// empty for maps/weapons), no more need for a manual shim.
export type AssetMeta = components['schemas']['AssetMeta']

// ---------------------------------------------------------------------------
// Achievements Xbox (bilingues EN/FR)
// ---------------------------------------------------------------------------

export type AchievementsSummary = components['schemas']['AchievementsSummary']

export type AchievementEntry = components['schemas']['AchievementEntry']

export type AchievementsPageResponse = components['schemas']['AchievementsPageResponse']

// ---------------------------------------------------------------------------
// Backup (pkg/duckdbbackup)
// ---------------------------------------------------------------------------

export interface IntegrityResult {
  ok: boolean
  detail?: string      // first error message if !ok
  checked_at: string   // ISO 8601 UTC
}

export interface BackupConfig {
  interval: string
  keep_daily: number
  keep_weekly: number
  keep_monthly: number
}

export interface BackupStatusResponse {
  enabled: boolean
  available: boolean
  last_backup_at?: string   // ISO 8601, absent if never backed up
  last_snapshot_id?: string
  last_exported?: string[]
  last_duration_ms?: number
  integrity_checks?: Record<string, IntegrityResult>
  config?: BackupConfig     // absent when the scheduler is nil (backup not configured)
}

export type BackupRunResult = components['schemas']['BackupRunResult']

// ─── Admin — Data integrity (sync invariants) ─────────────────────────
// Mirror of domain.AdminInvariantsResponse (GET /admin/invariants).

export interface AdminInvariantViolation {
  key: string
  severity: 'fail' | 'warn'
  count: number
  sample: string[] | null
  description: string
}

export interface AdminPlayerInvariantsReport {
  player_slug: string
  gamertag: string
  xuid: string
  check_error?: string
  violations: AdminInvariantViolation[]
  fail_count: number
  warn_count: number
}

export type AdminInvariantsResponse = components['schemas']['AdminInvariantsResponse']

// ─── Admin — DB contention (B-swap shared) ───────────────────────────────────
// Mirror of domain.DBContentionResponse (GET /admin/db-contention).

export type DBContentionResponse = components['schemas']['DBContentionResponse']

// ─── Admin — Token health (Access / XSTS / Refresh) ───────────────────────
// Mirror of domain.TokenHealthResponse (GET /admin/token-health).

export type TokenStatus = 'ok' | 'expiring' | 'expired' | 'absent' | 'reauth'

export type PlayerTokenHealth = components['schemas']['PlayerTokenHealth']

export type TokenHealthResponse = components['schemas']['TokenHealthResponse']

// ─── Admin — Player directory (ADR 0035) ─────────────────────────────────
// Mirrors of domain.AdminIdentitiesResponse (GET /admin/identities). One row
// per identity (xuid), with what each of the four registries knows about it.
// `xuid` can be empty: an orphaned player folder or a profile without a resolved
// Xbox identity stays VISIBLE, which is this view's whole purpose.

export type IdentityProfileRef = components['schemas']['ProfileRef']

export type IdentityAccountRef = components['schemas']['AccountRef']

export type IdentityTokenRef = components['schemas']['TokenRef']

export type IdentityOrphanDirRef = components['schemas']['OrphanDirRef']

export type IdentityAnomaly = components['schemas']['IdentityAnomaly']

export type IdentityRecord = components['schemas']['IdentityRecord']

export type AdminIdentitiesResponse = components['schemas']['AdminIdentitiesResponse']

// ─── Admin — Monitoring dashboard ─────────────────────────────────────────────
// Mirrors of domain.AdminMonitoringOverview (GET /admin/monitoring/overview),
// of the scheduler response (GET /admin/monitoring/scheduler — types from the Go
// scheduler package), and of the job list (GET /admin/monitoring/jobs).

export type MonitoringSchedulerSummary = components['schemas']['MonitoringSchedulerSummary']

export type MonitoringJobsSummary = components['schemas']['MonitoringJobsSummary']

export type MonitoringDataHealth = components['schemas']['MonitoringDataHealth']

export type MonitoringTokensSummary = components['schemas']['MonitoringTokensSummary']

export type MonitoringInvariantsSummary = components['schemas']['MonitoringInvariantsSummary']

export type MonitoringServerInfo = components['schemas']['MonitoringServerInfo']

export type AdminMonitoringOverview = components['schemas']['AdminMonitoringOverview']

/** Duration of a post-sync pipeline step (monitoring timeline P4). */
export type PostSyncStepTiming = components['schemas']['PostSyncStepTiming']

/** Post-sync pipeline counters (mirror of domain.PostSyncResult). */
export interface PostSyncCounters {
  perf_scores_computed: number
  lusr_updated: number
  career_synced: boolean
  views_refreshed: number
  achievements_synced: boolean
  matches_promoted_friends: number
  engagement_scores_computed: number
  engagement_coefs_updated: number
  sessions_assigned: number
  citations_computed: number
  /** Caught up by convergence (steps 1.54 / 1.56). */
  converged_events: number
  converged_psa: number
  /** Total pipeline duration + per-step breakdown (timeline). */
  duration_ms: number
  step_timings?: PostSyncStepTiming[]
  fatal_errors?: string[]
}

export type SchedulerOutcome = 'ok' | 'skipped' | 'failed'

export interface SchedulerPlayerOutcome {
  gamertag: string
  xuid: string
  outcome: SchedulerOutcome | ''
  reason: string
  attempted_at: string
  duration_ms: number
  matches_inserted?: number
  matches_skipped?: number
  medals_inserted?: number
  sync_status?: string
  error_count?: number
  first_error?: string
  consecutive_zero_inserts?: number
  post_sync?: PostSyncCounters
  /** Post-sync durations (ms) of this player's last cycles (oldest -> most recent), a trend sparkline. */
  post_sync_history_ms?: number[]
}

export interface SchedulerGateClaim {
  gamertag: string
  source: string
  age_ms: number
  stale: boolean
}

export interface SchedulerGateSnapshot {
  inflight_watcher: number
  inflight_gate: number
  granted_total: number
  coalesced_total: number
  stale_count: number
  claims?: SchedulerGateClaim[]
}

export interface SchedulerSnapshot {
  last_cycle_at: string
  last_cycle_result?: {
    total: number
    synced: number
    skipped: number
    failed: number
    duration_ns: number
  }
  interval_minutes: number
  pool_size: number
  players: SchedulerPlayerOutcome[]
  gate: SchedulerGateSnapshot
  /** true = a cycle has run since this boot; false = a snapshot rehydrated from
   *  disk (the last cycle before the restart). Combined with last_cycle_at (empty/
   *  zero = no known data) to distinguish the three states on the UI side (C1). */
  since_boot: boolean
}

/** Journal of global admin actions (GET /admin/actions/journal, survives a reboot). */
export type AdminActionJournalEntry = components['schemas']['AdminActionJournalEntry']
export type AdminActionJournalResponse = components['schemas']['AdminActionJournalResponse']

export interface SchedulerCycleRecord {
  /** RFC3339 */
  at: string
  trigger: 'tick' | 'manual'
  total: number
  synced: number
  skipped: number
  failed: number
  duration_ms: number
  /** Cumulative window of UNAVAILABILITY of shared reads during this cycle
   *  (drain + RW hold + reopen, B-swap). */
  blocked_ms: number
  /** Complete RO->RW swaps during this cycle. */
  swap_count: number
  /** Reads rejected with 503 during this cycle. */
  reads_rejected: number
  /** Cumulative time of Halo API calls during this cycle (all goroutines). */
  api_ms: number
  /** Cumulative persist write time (shared + player) during this cycle. */
  persist_write_ms: number
}

export interface AdminSchedulerStatusResponse {
  available: boolean
  snapshot?: SchedulerSnapshot
  /** Most recent first — an in-memory ring, lost on a server restart. */
  history: SchedulerCycleRecord[]
  history_since_boot: boolean
  zero_insert_warn_threshold: number
}

export interface AdminJobsResponse {
  generated_at: string
  jobs: AsyncJobStatus[]
}

// ─── Admin — Convergence (per-player enrichment backlog) ────────────────
// Mirror of domain.AdminConvergenceReport (GET /admin/monitoring/convergence).

export type PlayerConvergenceReport = components['schemas']['PlayerConvergenceReport']

export type ConvergenceTotalsSinceBoot = components['schemas']['ConvergenceTotalsSinceBoot']

export type AdminConvergenceReport = components['schemas']['AdminConvergenceReport']

// ─── Admin — Performance (expvar aggregates since boot) ─────────────────────
// Mirror of domain.AdminPerfStats (GET /admin/monitoring/perf).

export type PerfCallStats = components['schemas']['PerfCallStats']

export type PerfAPIBuckets = components['schemas']['PerfAPIBuckets']

export type AdminPerfStats = components['schemas']['AdminPerfStats']

/** Aggregate of a Halo API call attributed to a player. Mirror of domain.PerfPlayerCallStats. */
export type PerfPlayerCallStats = components['schemas']['PerfPlayerCallStats']

/** A persisted detection with a lifecycle. Mirror of domain.MonitoringDetection. */
export type MonitoringDetection = components['schemas']['MonitoringDetection']

/** Response of GET /admin/monitoring/detections. Mirror of domain.AdminDetectionsResponse. */
export type AdminDetectionsResponse = components['schemas']['AdminDetectionsResponse']

/** Data freshness for a tracked player. Mirror of domain.PlayerFreshness. */
export type PlayerFreshness = components['schemas']['PlayerFreshness']

/** Freshness per active title. Mirror of domain.TitleFreshnessReport. */
export type TitleFreshnessReport = components['schemas']['TitleFreshnessReport']

/** Response of GET /admin/monitoring/freshness. Mirror of domain.AdminFreshnessResponse. */
export type AdminFreshnessResponse = components['schemas']['AdminFreshnessResponse']

/** Size of a DuckDB database + WAL. Mirror of domain.ResourceDBFile. */
export type ResourceDBFile = components['schemas']['ResourceDBFile']

/** Response of GET /admin/monitoring/resources. Mirror of domain.AdminResourcesResponse. */
export type AdminResourcesResponse = components['schemas']['AdminResourcesResponse']

/** Status of a cron. Mirror of domain.CronStatusEntry. */
export type CronStatusEntry = components['schemas']['CronStatusEntry']

/** A feature's liveness. Mirror of domain.FeatureHeartbeat. */
export type FeatureHeartbeat = components['schemas']['FeatureHeartbeat']

/** Response of GET /admin/monitoring/crons. Mirror of domain.AdminCronsResponse. */
export type AdminCronsResponse = components['schemas']['AdminCronsResponse']

// ─── Admin — Replay build queue + workers ───────────────────────
// Mirrors of domain.BuildQueueJob / BuildQueueWorker / AdminBuildQueueResponse
// (GET /admin/monitoring/build-queue). State lives server-side: this view is
// complete even when the worker runs on another machine.

/** A job in the durable build queue. */
export type BuildQueueJob = components['schemas']['BuildQueueJob']

/** A worker known to the queue (last heartbeat, online or not). */
export type BuildQueueWorker = components['schemas']['BuildQueueWorker']

/** Response of GET /admin/monitoring/build-queue. */
export type AdminBuildQueueResponse = components['schemas']['AdminBuildQueueResponse']

/** A match's debrief delay: the instant of each step since the match ended. */
export type MatchDelay = components['schemas']['MatchDelay']

/** A measured step of a match's path (domain.MatchStep). */
export type MatchDelayStep = components['schemas']['MatchDelayStep']

// NB: the Watcher types (WatcherStatusResponse, WatcherPlayerStatus) already
// exist earlier in this file (the historical watcher section) — the monitoring
// dashboard reuses them via features/settings/watcher-queries.ts.

// ─── Admin — Data quality (unknowns + resolution actions) ───────────────
// Mirrors of domain.AdminDataQualityCounts / Issues / actions.

export type AdminDataQualityCounts = components['schemas']['AdminDataQualityCounts']

export type DataQualityIssueKind =
  | 'raw_uuids'
  | 'untranslated_modes'
  | 'orphan_playlists'
  | 'orphan_xuids'

export type AdminDataQualityIssue = components['schemas']['AdminDataQualityIssue']

export type AdminDataQualityIssues = components['schemas']['AdminDataQualityIssues']

export type RegistryNamesBackfillResult = components['schemas']['RegistryNamesBackfillResult']

export type ResolveResult = components['schemas']['ResolveResult']

/** Mirror of domain.ModeTranslationRequest; `mode_key` is the mode's technical key, not a label. */
export interface ModeTranslationRequest {
  mode_key: string
  names: Record<string, string> // key = a language code from config/locales.toml
}

/** Mirror of domain.AssetTranslationRequest. */
export interface AssetTranslationRequest {
  asset_kind: string // playlist | map | pair | game_variant
  asset_id: string
  names: Record<string, string> // key = a language code from config/locales.toml
}

export type CatalogRefreshResult = components['schemas']['CatalogRefreshResult']

/** Mirror of domain.LyingBitsResetResult — resets lying backfill_completed bits. */
export type LyingBitsResetResult = components['schemas']['LyingBitsResetResult']

// ─── Admin — Log viewer ───────────────────────────────────────────────────
// Mirrors of domain.AdminLogModules / AdminLogTail.

export type AdminLogModule = components['schemas']['AdminLogModule']

export type AdminLogModules = components['schemas']['AdminLogModules']

export interface AdminLogEntry {
  time?: string
  level: string
  msg?: string
  module?: string
  request_id?: string
  event_id?: string
  err?: string
  source?: string
  fields?: Record<string, unknown>
  raw?: string
}

export type AdminLogTail = components['schemas']['AdminLogTail']

/**
 * A player involved in an objective event (e.g. the scorer of a capture).
 * Exact mirror of the `objective-events` DTO (camelCase keys).
 */
export interface MatchObjectiveEventPlayer {
  xuid: string
  role: string
}

/**
 * A filmed objective event (CTF flag capture, etc.).
 *
 * Source: `GET /players/{slug}/matches/{matchId}/objective-events`. Exact
 * mirror of the backend DTO (camelCase, nullable fields omitted from the JSON). For CTF:
 * objectiveType='flag', eventType='capture', value=1, teamId=0|1 (same
 * numbering as scoreboard.team_side), players[0].xuid = the scorer.
 */
export interface MatchObjectiveEvent {
  matchId: string
  seq: number
  timeMs?: number
  objectiveType: string
  eventType: string
  teamId?: number
  value?: number
  source: string
  confidence: string
  players: MatchObjectiveEventPlayer[]
}

/**
 * A keyframe v3 player position decoded from the film (match-level — §N).
 * Exact mirror of the `positions` DTO (camelCase keys). x/y/z are Halo world
 * coordinates; team is -1 (unknown) when spatial clustering could not
 * attribute it, 0/1 otherwise (best-effort, no xuid attribution in v1).
 */
export interface MatchPlayerPosition {
  timeMs: number
  x: number
  y: number
  z: number
  team: number
}


// --- 2D Replay (GET /players/{slug}/matches/{matchId}/replay) ---
//
// THESE TYPES ARE NO LONGER HAND-WRITTEN. Since the endpoint is declared in Huma, the
// replay document has a schema in `api/openapi.yaml`, hence a generated definition in
// `generated.ts`. Keeping a second hand-written copy would create two truths that
// would diverge at the first field added on the Go side — exactly what the
// `tools/lint-contract-ratchet.mjs` ratchet forbids.
//
// The aliases below still exist, and that is not cosmetic: the contract's names
// are generic (`Track`, `Shot`, `Bounds`…) because they live in a flat namespace
// shared by the whole API. The `Replay` prefix says which document they are
// pieces of, and keeps a replay `Point` from being confused with a timeseries point.
//
// Artifact pre-built offline (`cmd/replay-build`). Positions in WORLD METERS: the
// build requires the map's bounds (`-map`) and refuses to produce an artifact without them,
// which is what makes the frozen map background overlayable on the replay. The client auto-frames via `bounds`.
// `points[].t` = time-step index in [0, frameCount).
export type ReplayPoint = components['schemas']['Point']
export type ReplayTrack = components['schemas']['Track']
/** The life at the film's native rate (schema 109): differential columns, re-read by `lib/replay/replayFullRate.ts`. */
export type ReplayFullRateTrack = components['schemas']['FullRateTrack']
export type ReplayBounds = components['schemas']['Bounds']
export type ReplayMapObject = components['schemas']['MapObject']
export type ReplaySurface = components['schemas']['Surface']
export type ReplayShot = components['schemas']['Shot']
export type ReplayGrenade = components['schemas']['Grenade']
export type ReplayProjectile = components['schemas']['Projectile']
export type ReplayLoadout = components['schemas']['Loadout']
export type ReplayAmmoSlot = components['schemas']['AmmoSlot']
export type ReplayInventory = components['schemas']['Inventory']
/**
 * ReplayGrenadeRead — ONE reading of carried grenades on the `grenadeReads` axis (schema 20).
 * Two channels feed it, and `src` says which: 'kf' (keyframe, ~20 s) or 'delta' (a delta
 * packet, transmitted ON CHANGE).
 */
export type ReplayGrenadeRead = components['schemas']['GrenadeRead']

/** ReplayAmmoRead: an ammo reading for a weapon slot on the `ammoReads` axis. */
export type ReplayAmmoRead = components['schemas']['AmmoRead']
// The ACTIVE state of a piece of equipment (schema 7): episodes dated per life, two
// measured families (`camo`, `overshield`) — see equipmentFx.ts for the rendering-side reading.
export type ReplayEquipmentEpisode = components['schemas']['EquipmentEpisode']
// A grapple PULL (schema 8): a measured window [t0, t1] per life + an anchor
// point in world coordinates — see grappleLayer.ts for the drawing.
export type ReplayGrappleLine = components['schemas']['GrappleLine']
// An equipment PLACEMENT (schema 9): a wall, a sensor, or an object whose nature is not
// established (`family: other`). `owner` is the placer's SLOT (-1 if no biped
// present within 3 m at that time) and `h` is their AIM heading at the moment of placement, in degrees
// [0,360[ — the same convention as `Point.h`, and NEVER the object's own orientation, which the
// film does not carry. See equipmentPlacementsLayer.ts for the rendering.
export type ReplayEquipmentPlacement = components['schemas']['EquipmentPlacement']
// A WEAPON PAD (schema 11): the position where a weapon of the same family respawns, its
// spawns, its presence intervals and its respawn cycle WHEN IT IS ESTABLISHED
// (`cycle` is `null` otherwise — never an unstable figure). MATCH data, not map data:
// the pad belongs to the map, the weapon that appears on it belongs to the match.
export type ReplayWeaponPad = components['schemas']['WeaponPad']
export type ReplayPadPresence = components['schemas']['PadPresence']
export type ReplayPadCycle = components['schemas']['PadCycle']
// A COMPLETED pad occupancy (schema 11): the pad emptied somewhere within
// [tLow, tHigh]. Since schema 30 (2026-08-31), `t` carries the EXACT instant and `xuid` the
// picker when the native `biped_pickup` event dates the occupancy; otherwise the interval stands
// alone and `xuid` is `null`.
export type ReplayPadPickup = components['schemas']['PadPickup']
// SCORE OVER TIME (schema 12): the two teams' curve and the player counters,
// decoded from the film and published ON CHANGE ONLY — the data is a sequence of
// STEPS, not a regular sampling. `t` is a document frame (the same grid as
// `tracks`), `v` the value reached at that frame.
//
// TWO READING LEVELS, AND THEY ARE NEVER CONFUSED. `rounds` carries the value WITHIN a
// round (it resets to zero at each Oddball round), `total` the match's cumulative total.
// A single-round mode therefore has a `rounds` of length 1 and a `total` equal to it.
//
// A TEAM CAN HAVE NO SERIES AT ALL, and that is a measurement: the side that never scored
// emits nothing (CTF reference 3-0: a single series published). Its score is zero everywhere —
// never "unknown" (see teamSeriesFor, lib/replay/scoreTimeline.ts).
export type ReplayScoreTick = components['schemas']['ScoreTick']
export type ReplayScoreRound = components['schemas']['ScoreRound']
export type ReplayScoreSeries = components['schemas']['ScoreSeries']
export type ReplayTeamScore = components['schemas']['TeamScore']
export type ReplayTeamHold = components['schemas']['TeamHold']
export type ReplayPlayerScore = components['schemas']['PlayerScore']
export type ReplayScoreTimeline = components['schemas']['ScoreTimeline']
// THE IDENTITY REGISTRY (schema 50): what each name the document serves rests on —
// a direct link read from the film, a bridge via deaths, closure, roster elimination, or
// nothing at all (`non_resolu`, published and counted, never invented).
export type ReplayIdentitySection = components['schemas']['IdentitySection']
// THE COVERAGE of the score layer: by which route the teams' identity was resolved
// (`teamIdentity`: a | a0 | b | unresolved — `a0` = the final score of a one-sided match,
// schema 69), whether the mode carries the counter, whether the reading was
// truncated, and the number of published points. `oracle` says against which quantity the decoding was
// confronted (`displayed` = the score shown in-game).
export type ReplayScoreCoverage = components['schemas']['ScoreCoverage']
// A CTF flag's LIFE (schema 14): one entry per OBJECT (two flags in CTF), and a
// sequence of contiguous state intervals. `team` is the flag's OWNING team (-1 = a map
// outside the objective catalog).
//
// FOUR STATES, AND THE FOURTH CARRIES A MEASURED DOUBT. `carried` = a player carries it and a
// DATED fact ended the carry; `carried_open` = a player picked it up and NOTHING in the film says
// they dropped it (the interval runs to the end of the axis: it is an upper bound, not a
// measurement — the marker's independent check confirms 37/37 of closed carries and 0/5 of
// open ones); `dropped` = on the ground, at the last carrier's spot; `home` = on its pad.
//
// `xuid` is set for the two carried states, `null` for the other two. `x`/`y` are in world
// coordinates: for a carried state it is the PICKUP POINT, and the rest is read from the
// carrier's track — the carried flag is at its carrier's position, and republishing its own
// trajectory would mean republishing the player's.
export type ReplayFlagCarry = components['schemas']['FlagCarry']
export type ReplayFlagSpan = components['schemas']['FlagSpan']
// FREE OBJECTIVE OBJECTS (schema 21): where the object sits when NOBODY carries it.
// One entry per LIFE — the object appears, replicates its position, then goes silent because it was
// picked up or came to rest. `family` says what it is (`ball` today) and `en`/`fr`
// name it; `pts` is its real trajectory, never interpolated.
//
// A GAP BETWEEN TWO LIVES IS A CARRY, BUT THE DOCUMENT DOES NOT SAY BY WHOM: the carrier
// oracle was measured and refuted (phase D4). Do not infer a carrier client-side.
export type ReplayObjectiveObjectLife = components['schemas']['ObjectiveObjectLife']
export type ReplayObjectiveObjectPoint = components['schemas']['ObjectiveObjectPoint']
// EACH ZONE'S STATE for the mode (schema 16): who holds it, since when, and up to which gauge
// level it was contested. `zoneRef` is an INDEX into `mapObjectives.zones` — the
// static layer served with the document —, never a name: the A/B/C letter shown in-game does not exist
// in any decoded data.
//
// `owner` is `null` when NOBODY holds the zone, and that is a measurement (the channel's
// neutral value), not missing data. `active` marks the ACTIVE zone of a hill mode;
// `progress` is the gauge's peak reached during the interval, mapped to [0, 1].
//
// `gauge` (schema 18) is THE LIVE CAPTURE GAUGE: the dated series `[{t, v}]` of the gauge's
// value DURING its ramps (thinned out: one point per >= 0.02 change or per second of
// ramp, nothing outside a ramp, each ramp closed by its return to zero), on the same scale as
// `progress`. On a hill (schema 92) it is the active hill's capture, which also ramps
// down step by step when the holding side loses it (`gaugeRamps[].draining`). Rendering reads it as a
// staircase — the last value holds until the next point, one second after the series' last one.
// Absent on an artifact of schema
// <= 17 — and rendering then draws NO arc: the static apex used to read as a gauge.
export type ReplayZoneState = components['schemas']['ZoneState']
export type ReplayZoneSpan = components['schemas']['ZoneSpan']
export type ReplayGaugePoint = components['schemas']['GaugePoint']
// A RAMP OF THE CAPTURE GAUGE (schema 64): its bounds, and `capturingTeam` — THE SIDE
// PUSHING IT, successful or not. The server READS it from the film since batch 5.6 (the
// zone's pusher channel) instead of inferring it from the outcome. The key is ABSENT when the film names
// NEUTRAL, or when nothing measures it. Rendering then repaints neutral, and it NEVER infers the pusher
// from another source (neither "the side opposite the owner", which does not exist on a
// neutral base, nor the players present in the zone's volume).
//
// `t0`/`t1` PLACE the ramp, they do not date the gesture: `t0` is the start of the non-
// decreasing run, i.e. the return to zero that closes the previous ramp. The push starts at the
// first NON-ZERO point of `gauge` within these bounds (see `zoneSound.rampesDeJauge`).
export type ReplayZoneGaugeRamp = components['schemas']['ZoneGaugeRamp']
// The COVERAGE of the flag layer: the mode verdict and the three film signals that
// ground it, the oracle's pickups, the published carries split into closed / open, the rejections
// by cause, the marker's check (on the CLOSED ones; the open ones have their own count), and
// the inconsistencies. Absent = nobody read the film for this layer.
export type ReplayFlagCarriesCoverage = components['schemas']['FlagCarriesCoverage']

// A VEHICLE'S LIFE (schema 39): where it is born, its sampled trajectory with its heading,
// its occupancy episodes (who is aboard and when), and up to which frame to display it.
// `end` is ALWAYS `unknown` (see `apps/go-api/internal/games/halo_infinite/film/replay/document_vehicles.go`):
// dating the destruction was measured and REFUTED once already
// (V3_DESTRUCTION_DATEE_2026-09-02) — the sprite's disappearance was then NEVER to be read as
// an explosion.
//
// `tEnd` IS AN ADVANCE DECLARATION (2026-09-03): a second Go batch measures
// destruction once more (schema 39) while this web batch prepares the layer. The GENERATED
// contract (`generated.ts`) carries NEITHER `tEnd` NOR a `"destroyed"` value for `end` — both
// are therefore added here BY HAND, TOLERANTLY (optional), until
// `make openapi-gen` regenerates them: a current artifact (`end` always `"unknown"`, `tEnd`
// absent) passes through this type with no change in behavior. `end` stays a BARE `string`
// (not a `'unknown' | 'destroyed'` literal) because that is already how it is on the generated side — tightening
// it here would break the re-export if the Go side one day publishes a third value. The layer reads
// `VEHICLE_END_DESTROYED` (vehiclesLayer.ts) rather than a literal scattered at every call site.
export type ReplayVehicleTrack = components['schemas']['VehicleTrack'] & {
  /** Frame index of the destruction (schema 39, `omitempty` on the Go side). Absent as long as the
   *  measurement has not succeeded — see the header above. */
  tEnd?: number
}
// A vehicle's birth: position, and NEVER a heading (`h` absent by construction — the
// orientation sheet of the creation record is not readable, see the Go comment). The
// client orients the vehicle on its FIRST moving sample, or nose up the screen
// if it has none.
export type ReplayVehicleSpawn = components['schemas']['VehicleSpawn']
// A trajectory point: position + heading (`h`, in degrees, the SAME convention as `Point.h` — 0 =
// +X, 90 = +Y). `h` is the VELOCITY's direction at that instant; at rest it holds the LAST
// known heading (carried forward), never recomputed from noise.
export type ReplayVehicleSample = components['schemas']['VehicleSample']
// An OCCUPANCY EPISODE: a biped (its `slot`) aboard from 'T0' to 'T1'. `seat` (0 = driver)
// is a POINTER — nil = no matched event. An empty `xuid` = an unnamed occupant, the episode
// stays published. Two episodes of the same vehicle can overlap (several passengers).
export type ReplayVehicleRide = components['schemas']['VehicleRide']
// AN OCCUPANT AIM READING (schema 39), on the frame axis: `h` = heading, `p` = pitch,
// the SAME conventions as `Point.h`/`Point.p` (the same `i21` component, the same accessor on the Go side). It is
// the aim of the MAN aboard — driver, gunner or passenger, each their own —, never
// the chassis's orientation nor the turret's (the latter replicates NOTHING: refuted with a
// reference in batch V11). `p` absent reads as "LEVEL", never "unknown".
export type ReplayVehicleAim = components['schemas']['VehicleAim']
// The sprite of a chassis FAMILY, placed AT REQUEST TIME by the service (never in the artifact):
// `tinted` says the visual is tinted via `multiply` (black outlines, see `tintedIconCanvas`).
//
// `kind`, `en` and `fr` ARE AN ADVANCE DECLARATION (2026-09-16, batch 1.9.9), the same
// process and the same reason as `tEnd` above: the GENERATED contract (`generated.ts`) does not
// carry them yet — the schema number only goes up once, when the wave of batches
// touching the document merges. They are therefore added here BY HAND and TOLERANTLY (optional): a
// current artifact ignores them with no change in behavior.
//
// WHAT THEY SAY. Almost every family is a PROPER NAME from the game (Warthog, Banshee):
// nothing about it is translated, the table's key IS the name, and the three fields stay empty. They
// only fill in for a family the title QUALIFIES in its manifest — today the
// only banned automatic turret, which is NOT a vehicle but a MAP ELEMENT
// (`kind: "map_element"`, user decision of 2026-09-14). The layer reads
// `VEHICLE_KIND_MAP_ELEMENT` (vehiclesLayer.ts) rather than a literal scattered at every call site.
export type ReplayVehicleLabel = components['schemas']['VehicleLabel'] & {
  /** NATURE of the family when it is not a vehicle in the match. Absent = a vehicle. */
  kind?: string
  /** EN/FR label of the family. Absent for a proper name from the game (the general case). */
  en?: string
  fr?: string
}
// What the vehicles layer saw, resolved, and refused to say — published even without a vehicle (same
// reason as `placements`/`groundWeapons`: distinguish a map without a vehicle from an unread film).
export type ReplayVehicleCoverage = components['schemas']['VehicleCoverage']
// A weapon from the title's VEHICLE WEAPON REGISTRY (schema 69, `doc.vehicleWeapons`, keyed by
// `Shot.w`): shape, tint, sound (absent = a deliberate silence) and an anchor on the sprite. Read by
// `model/vehicleWeaponRegistry.ts` ALONE.
export type ReplayVehicleWeapon = components['schemas']['VehicleWeapon']

// ---------------------------------------------------------------------------
// Schemas 25 to 27 of the replay document — HAND-WRITTEN, and here is why.
//
// The `api/openapi.yaml` contract is GENERATED from the Go DTOs (`make openapi-gen`), and
// `generated.ts` is derived from it. The `weaponChanges` (schema 25), `equipmentChanges`
// (25) and `groundWeapons` (26) layers were shipped on the Go side on 2026-08-30 WITHOUT the
// contract being regenerated: the generated file therefore does not carry them, and the web batch consumes them anyway —
// the artifact itself already publishes them.
//
// THIS IS NOT A PERMANENT WORKAROUND. Three things bound it:
//   - the shape is verified ON THE RECORD by a guard rail that reads the Go structs' `json:`
//     tags (`groundWeaponContract.guard.test.ts`) — a field renamed on the Go side fails
//     CI, exactly as a regeneration would;
//   - these declarations DISAPPEAR on the next `make openapi-gen && make generate-types`:
//     the intersection below is removed, and the three interfaces become
//     `components['schemas'][...]` re-exports like their neighbors;
//   - a measurable removal criterion: `grep groundWeapons apps/go-api/api/openapi.yaml`
//     returns `ReplayDocument`'s field (not just `GroundWeaponCoverage`).
// ---------------------------------------------------------------------------

/**
 * ReplayWeaponChange — ONE weapon-in-hand change (schema 25), dated to the millisecond then
 * projected onto the document's frame axis.
 *
 * `w` is the weapon family as an 8-digit hex value — the SAME identifier space as
 * `ReplayLoadout.w` and `ReplayWeaponPad.weapon`, hence the same key in `weaponLabels`. It is
 * EMPTY on a drop (the slot no longer has a weapon); `from` carries the previous family
 * when the film gives it, and it is what NAMES the dropped weapon.
 *
 * Re-announcements of a weapon already carried at spawn do not enter here: those are not
 * pickups (see document_weapon_changes.go).
 */
export interface ReplayWeaponChange {
  /** Frame index, on the same axis as `ReplayPoint.t`. */
  t: number
  /** The biped's slot: it names the Track concerned, hence a LIFE. */
  slot: number
  kind: 'taken' | 'dropped' | 'swapped'
  /** Weapon family now carried. Empty on a drop. */
  w?: string
  /** Previous family, when known. Empty otherwise. */
  from?: string
  /**
   * Weapon SLOT affected (schema 69): 0 = the first weapon, 1 = the second — the same
   * key as a spawn loadout's `ReplayLoadout.k`. Absent from older artifacts.
   */
  k?: number
}

/**
 * ReplayEquipmentChange — ONE equipment pickup or consumption (schema 26).
 *
 * `r` is the PALETTE RANK, the same convention as `abilities[].r`: it is named via
 * `abilityLabels[String(r)]`. It is `REPLAY_NO_ABILITY_RANK` on a consumption — the player
 * no longer carries anything — and `from` carries it the same way when the previous rank is not
 * readable (a life's first emission).
 *
 * RESPAWN announcements do not enter here: what a player carries at birth is
 * already in `abilities` (see document_equipment_changes.go).
 */
export interface ReplayEquipmentChange {
  /** Frame index, on the same axis as `ReplayPoint.t`. */
  t: number
  /** The biped's slot: it names the Track concerned, hence a LIFE. */
  slot: number
  kind: 'taken' | 'spent'
  /** Palette rank now carried, or `REPLAY_NO_ABILITY_RANK` on a consumption. */
  r: number
  /**
   * Previous rank on this life, or `REPLAY_NO_ABILITY_RANK` when it is not readable.
   *
   * IT IS AN IDENTITY ONLY IF `gap` IS ABSENT OR ZERO — see below.
   */
  from: number
  /**
   * The emission comes from GATED RECOVERY (schema 38): its bytes exist in the film
   * in a form the strict scan rejects by construction, and its counter fills in
   * EXACTLY a gap announced by the rotation witness. The provenance is published so the
   * client can STATE it, never so it can devalue it: certification comes from the witness, not
   * from the path. A recovered one is therefore worth exactly a strict one.
   */
  recovered?: boolean
  /**
   * The RESIDUAL counter gap since the same life's previous emission, AFTER
   * recovery (schema 38): absent or 0 = a healthy chain; n > 0 = n emissions are STILL
   * missing right before this one.
   *
   * UNDER A GAP, `from` IS NOT A RELIABLE IDENTITY — and it is not false either: it
   * is UNKNOWN, and any consumer must treat it as such (the measured case is JGtm's `spent`
   * on `1b2d9e08`, which carries the grapple's rank because its translocator pickup was
   * missed). The home of this rule on the web side is `identityIsUnknown`
   * (`features/match-replay/placementTeleport.ts`).
   */
  gap?: number
}

/**
 * REPLAY_NO_ABILITY_RANK — the "no equipment" sentinel of `ReplayEquipmentChange`.
 *
 * It is `replay.NoAbilityRank` (= `filmdec.AbilitySetNoRank`), published as-is rather
 * than omitted so a client does not have to distinguish "field absent" from "rank zero": rank
 * 0 exists. The contract guard rail checks its value against the Go side.
 */
export const REPLAY_NO_ABILITY_RANK = -1

/**
 * ReplayGroundWeapon — ONE individual ground weapon, bounded by OBSERVATION (schema 27).
 *
 * THE DISAPPEARANCE IS AN INTERVAL WHEN `end` IS `seen`: `t1` is the last PROOF of
 * presence (a keyframe that still lists the object), `t1max` the first proof of ABSENCE.
 * The object disappeared somewhere between the two — the film does not say where. Rendering picks within
 * this interval, but it picks from MEASURED data: nothing is shown after `t1max`.
 *
 * On `pickup` (a pickup dated from the delta stream) and `open` (nothing proves the disappearance),
 * `t1max` equals `t1`: the end is exact, or the object stays to the very end.
 *
 * PAD WEAPONS ARE NOT HERE: they belong to `weaponPads`, which publishes them in
 * recurring clusters. Only objects that MOVED come out here.
 */
export interface ReplayGroundWeapon {
  /** Appearance frame, on the same axis as `ReplayPoint.t`. */
  t0: number
  /** Last proof of PRESENCE (see the header). */
  t1: number
  /** First proof of ABSENCE; equals `t1` outside `end: 'seen'`. */
  t1max: number
  /** Resting position — where the object lies. Same axes as `ReplayPoint.x/y`. */
  x: number
  y: number
  z?: number
  /** Weapon family as an 8-digit hex value (same space as `ReplayLoadout.w`). */
  w: string
  /** MEASURED origin of the appearance: a dead player's weapon, or a leftover. */
  origin: 'dropped' | 'spawned'
  /** Slot of the life that dropped it when a drop coincides, -1 otherwise. */
  dropper: number
  /** How the display ends (see the header). */
  end: 'pickup' | 'seen' | 'open'
  /** Slot of the life that picked it up, on `end: 'pickup'`. -1 otherwise. */
  picker: number
  /**
   * EXACT ammo at the moment the weapon hit the ground, read from the object's CREATION
   * record (batch 6.10, 2026-09-11). ABSENT is the majority case, and it is not a gap in
   * the object but a decoder READING reserve, counted by
   * `coverage.groundWeaponItems.ammoRead`. The tooltip then falls back to the dropper's
   * DATED inventory reading (`model/groundWeaponAmmo.ts`).
   */
  // NO `| null` HERE, unlike the slices: the Go side publishes an `omitempty` POINTER,
  // so the field is ABSENT or present — never `null`. The contract guard rail compares the
  // shape against the generated type, which says so too.
  ammo?: ReplayGroundWeaponAmmo
}

/**
 * ReplayGroundWeaponAmmo — what was left in the weapon on drop. TWO fields, not three: the
 * third one the film transmits has no established meaning, and a number with an unknown
 * meaning is not published.
 */
export interface ReplayGroundWeaponAmmo {
  /** Rounds in the magazine. */
  mag: number
  /** Rounds in reserve. */
  res: number
}

/**
 * The three layers of schemas 25-27 as TRANSPORT serves them: nullable like every
 * Go slice, filled in at the boundary (`normalizeReplayDocument`) and never read as-is.
 */
interface ReplayDocumentDeltaLayers {
  weaponChanges?: ReplayWeaponChange[] | null
  equipmentChanges?: ReplayEquipmentChange[] | null
  groundWeapons?: ReplayGroundWeapon[] | null
}

export type ReplayDocument = components['schemas']['ReplayDocument'] &
  ReplayDocumentDeltaLayers

// THE MAP BACKGROUND: the top-down image of a map, and the calibration that places it in the
// replay's world frame. The calibration travels WITH the image because an image whose
// placement is unknown overlays nothing — a lesson from the first reconstructed map, whose
// calibration had to be found by hand from player trajectories.
export type ReplayMapBackground = components['schemas']['MapBackground']
export type ReplayMapBackgroundCalibration = components['schemas']['MapBackgroundCalibration']

// The NAMED ZONES ("callouts") of the match's map: world polygons + official
// FR/EN labels, served separately from the document (per-map resolution at the service level, like the
// background). Absent = the map has none (the Forge case, by construction) — not a degradation.
export type ReplayMapCallouts = components['schemas']['MapCalloutsEntry']
export type ReplayCalloutZone = components['schemas']['CalloutZone']

// The STATIC OBJECTIVES of the played mode: zones (oriented boxes, cylinders) and
// point markers (spawns, deliveries, pads), joined by map_id to the versioned
// catalog and served WITH the document (`mapObjectives` — filled in at request time, never
// written into the artifact). Absent = a mode without static objectives (Slayer), a map outside the
// catalog, or an empty map_id — never a degradation. `team` = the team index TO DISPLAY,
// -1 = neutral (dynamic-possession modes arrive already neutralized).
export type ReplayMapObjectives = components['schemas']['MapObjectives']
export type ReplayObjectiveZone = components['schemas']['ObjectiveZoneDTO']
export type ReplayObjectiveMarker = components['schemas']['ObjectiveMarkerDTO']

// The map's PAD LOCATIONS, cross-referenced with the match and served WITH the document
// (`mapWeaponPads` — filled in at request time like `mapObjectives`, never written into
// the artifact). Each entry carries the SPAWNER's position as the map file places
// it, to the centimeter, and `pad`: the index of the `weaponPads` pad that CONFIRMS it.
//
// ONLY LIT-UP LOCATIONS ARRIVE, and that is a product decision: the map file
// places the pads, the mode lights them up (Cliffhanger carries seventeen, ten in CTF and
// zero in Super Fiesta). `catalogN` says how many the map carries in total — which the
// layer therefore does not display. Absent = a map outside the catalog, or no confirmed pad: the
// layer then falls back to the film's pads alone.
export type ReplayMapWeaponPads = components['schemas']['MapWeaponPads']
export type ReplayMapWeaponPad = components['schemas']['MapWeaponPadDTO']

// The film's matching table: xuid AND slot index.
//
// THE TWO FIELDS ARE NOT INTERCHANGEABLE: the xuid IDENTIFIES, the index ORDERS and only
// makes sense within this film. The film's events name their author by index;
// it is this table that lets it be translated into an identity without ever confusing the two.
// `name` is the gamertag AS THE FILM WRITES IT — it is not a resolution, nothing went
// to fetch it elsewhere, so nothing can have mismatched it.
export type ReplayRosterEntry = components['schemas']['RosterEntry']

// The TACTICAL tab — the entry screen: the maps PLAYED under the current filter, with
// their tally and the server's legibility verdict (`sous_plancher`). The per-map
// floor is published WITH the maps (`plancher_matchs`) because the screen must be able to
// NAME it to the user — never recompute it client-side, which would create two truths.
export type TacticalMapsPage = components['schemas']['TacticalMapsPage']
export type TacticalMapCard = components['schemas']['TacticalMapCard']

// The BODIES of the two tactical reads — they are POST because their scope is
// a LIST of match_id values, which does not fit in a query string. Typing the body on the
// generated contract (rather than a literal object) means a rename on the Go side breaks `tsc`
// here, instead of being discovered at runtime on an empty grid.
export type TacticalMapsBody = components['schemas']['TacticalMapsBody']
export type TacticalRasterBody = components['schemas']['TacticalRasterBody']

// The RESPONSE of the placement raster (analysis view, phase 5): cells pre-aggregated by the
// server (bounds, grid step, p50/p95 scale), named respawn clusters, and the
// coverage counters (matches retained/pending/not bakeable) that the view must display
// AS-IS — never recomputed client-side, the same rule as the grid's floor.
export type TacticalRaster = components['schemas']['TacticalRaster']
export type CelluleTactique = components['schemas']['CelluleTactique']
export type BornesMonde = components['schemas']['BornesMonde']
export type EchelleTactique = components['schemas']['EchelleTactique']
export type TacticalGrappe = components['schemas']['TacticalGrappe']

// A ZONE'S DETAIL (the "Replay" mini-tiles, batch M1): same typing reasons
// against the generated contract as the two reads above — a rename on the Go side breaks `tsc`
// here rather than being discovered at runtime.
export type TacticalCelluleBody = components['schemas']['TacticalCelluleBody']
export type TacticalCelluleReponse = components['schemas']['TacticalCelluleReponse']
export type TacticalContribution = components['schemas']['TacticalContribution']

// THE TEAMMATES-AT-DEATH READING (the "teammates" batch): the victim's team, the retaliation, the
// zone's tally and a death's sequence (view D, a route under the replay's guards).
export type TacticalBilanZone = components['schemas']['TacticalBilanZone']
export type TacticalBilanMorts = components['schemas']['TacticalBilanMorts']
export type TacticalCoequipier = components['schemas']['TacticalCoequipier']
export type TacticalEquipeALaMort = components['schemas']['TacticalEquipeALaMort']
export type TacticalSequence = components['schemas']['TacticalSequence']
export type TacticalSequenceBody = components['schemas']['TacticalSequenceBody']

// The COORDINATION block of batch N1 (support received), served as-is by Sessions and
// Timeseries. Strict aliases of the generated contract: a rename
// on the Go side breaks `tsc` here rather than being discovered at runtime.
export type CoordinationBlock = components['schemas']['CoordinationBlock']
export type CoordinationAppui = components['schemas']['CoordinationAppui']
export type CoordinationSessionPoint = components['schemas']['CoordinationSessionPoint']
export type CoordinationMatchPoint = components['schemas']['CoordinationMatchPoint']
export type Couverture = components['schemas']['Couverture']

// ---------------------------------------------------------------------------
// Trends (Ascension, 2026-10-05)
// ---------------------------------------------------------------------------

/**
 * Body of `POST /players/{player_slug}/pages/trends`. Hand-written: the body is
 * declared OPTIONAL on the Go side (`MarkRequestBodyOptional`), hence absent from the generated schemas.
 * Mirror of `domain.TrendsQueryRequest` (all fields are `omitempty`).
 */
export interface TrendsQueryRequest {
  /** `solo` (default) or `squad`. */
  view?: 'solo' | 'squad'
  /** Performance chain to isolate; empty = all types. */
  game_type?: string
  /** Squad members (Squad view). */
  selected_gamertags?: string[]
  /** Strict composition (Squad view). */
  exact_composition?: boolean
  /** Language of medal names. */
  locale?: string
}

export type TrendsPageResponse = components['schemas']['TrendsPageResponse']
export type TrendsMember = components['schemas']['TrendsMember']
export type TrendsIndicator = components['schemas']['TrendsIndicator']
export type TrendsHorizonCell = components['schemas']['TrendsHorizonCell']
export type TrendsMonthCell = components['schemas']['TrendsMonthCell']
export type TrendsPoint = components['schemas']['TrendsPoint']
export type TrendsSeries = components['schemas']['TrendsSeries']
export type TrendsGameType = components['schemas']['TrendsGameType']
export type TrendsCalendarDay = components['schemas']['TrendsCalendarDay']
export type TrendsWinLossBlock = components['schemas']['TrendsWinLossBlock']
export type TrendsWinLossRow = components['schemas']['TrendsWinLossRow']
export type TrendsMedalsBlock = components['schemas']['TrendsMedalsBlock']
export type TrendsMedalRow = components['schemas']['TrendsMedalRow']
export type TrendsMixBucket = components['schemas']['TrendsMixBucket']
