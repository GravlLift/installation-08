/**
 * standalone.ts — the client for this app's own Go server (`infinite-theater-3d serve`),
 * reached through the Vite dev proxy (or, in production, same-origin) at `/api/*`.
 *
 * Three routes exist: the match list, one match's replay document (gzip over the wire,
 * decompressed transparently by the browser's `fetch`), and that match's map mesh (a GLB,
 * range-capable, or a typed 404 when it has not been built).
 */
import type { ReplayDocument } from './types'

/** One row of `GET /api/matches` (see `internal/store/match.go`). The new match-select
 *  fields are optional: a match whose stored context data is missing omits them, and the
 *  outcome/score fields are present only for a signed-in account that is in the match. */
export interface MatchSummary {
  matchId: string
  mapName: string
  mapModule: string
  build: string
  durationMs: number
  players: { name: string; xuid?: string; teamId: number; isBot?: boolean }[] | null
  importedAt: string
  modeName?: string
  modeCategory?: string
  playlistName?: string
  isRanked?: boolean
  startTime?: string
  mapImageUrl?: string
  teamScores?: [number, number]
  outcome?: string
  scoreMine?: number
  scoreTheirs?: number
}

/** The JSON body of a 404 from `/mesh.glb` when the map's mesh has not been built. */
export interface MeshNotBuiltBody {
  error: 'mesh_not_built'
  moduleKey: string
}

/** Thrown by `fetchReplayDocument`/mesh checks when the server answers a typed error JSON. */
export class ApiError extends Error {
  status: number
  body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.status = status
    this.body = body
  }
}

/** Thrown when the map mesh for a match has not been built server-side. */
export class MeshNotBuiltError extends ApiError {
  moduleKey: string

  constructor(moduleKey: string) {
    super(`mesh not built${moduleKey ? ` for module ${moduleKey}` : ''}`, 404, {
      error: 'mesh_not_built',
      moduleKey,
    })
    this.moduleKey = moduleKey
  }
}

/** Thrown when the match id does not exist on the server. */
export class MatchNotFoundError extends ApiError {
  matchId: string

  constructor(matchId: string) {
    super(`match not found: ${matchId}`, 404, { error: 'match_not_found', id: matchId })
    this.matchId = matchId
  }
}

/** Thrown when a match has no map module at all, so no mesh can ever be built for it. */
export class NoMapModuleError extends ApiError {
  matchId: string

  constructor(matchId: string) {
    super(`match ${matchId} has no map module`, 409, { error: 'no_map_module', id: matchId })
    this.matchId = matchId
  }
}

/** The lifecycle of a module's mesh build job, as `GET`/`POST .../mesh/state`/`build` answer it. */
export type MeshBuildState = 'absent' | 'queued' | 'building' | 'ready' | 'failed' | 'cancelled'

/** The JSON body of `GET /api/matches/{id}/mesh/state` and `POST .../mesh/build` (see
 *  `meshStateJSON` in `cmd/infinite-theater-3d/serve.go`). Fields that do not apply to the
 *  current state are omitted by the server, never sent as `null`. */
export interface MeshStateBody {
  state: MeshBuildState
  moduleKey: string
  error?: string
  queuePosition?: number
  startedAt?: string
  elapsedMs?: number
  bytes?: number
  triangles?: number
}

async function readErrorBody(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

/** `GET /api/matches` — the match list, newest first (server-sorted). */
export async function fetchMatches(signal?: AbortSignal): Promise<MatchSummary[]> {
  const res = await fetch('/api/matches', { signal })
  if (!res.ok) {
    const body = await readErrorBody(res)
    throw new ApiError(`GET /api/matches: HTTP ${res.status}`, res.status, body)
  }
  return (await res.json()) as MatchSummary[]
}

/**
 * `GET /api/matches/{id}/replay` — the replay document. The response is gzip-encoded on
 * the wire; `fetch` decompresses it transparently (the browser always advertises
 * `Accept-Encoding: gzip` and the server honors it), so this returns the parsed JSON.
 */
export async function fetchReplayDocument(
  matchId: string,
  signal?: AbortSignal,
): Promise<ReplayDocument> {
  const res = await fetch(`/api/matches/${encodeURIComponent(matchId)}/replay`, { signal })
  if (!res.ok) {
    const body = await readErrorBody(res)
    if (res.status === 404) throw new MatchNotFoundError(matchId)
    throw new ApiError(`GET .../replay: HTTP ${res.status}`, res.status, body)
  }
  return (await res.json()) as ReplayDocument
}

/** The URL of a match's map mesh GLB — relative, so it goes through the same proxy/origin. */
export function meshUrl(matchId: string): string {
  return `/api/matches/${encodeURIComponent(matchId)}/mesh.glb`
}

/**
 * checkMesh issues a lightweight `HEAD` against the mesh route to tell "not built yet"
 * (`MeshNotBuiltError`) apart from "will stream fine" before the 3D view starts a full GET
 * through three.js's loader (which cannot distinguish the two on its own).
 */
export async function checkMesh(matchId: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(meshUrl(matchId), { method: 'HEAD', signal })
  if (res.ok) return
  if (res.status === 404) {
    // HEAD carries no body; re-fetch with GET to read the typed error JSON (the body is tiny).
    const getRes = await fetch(meshUrl(matchId), { signal })
    const body = (await readErrorBody(getRes)) as MeshNotBuiltBody | { error?: string; id?: string } | null
    if (body && (body as MeshNotBuiltBody).error === 'mesh_not_built') {
      throw new MeshNotBuiltError((body as MeshNotBuiltBody).moduleKey ?? '')
    }
    if (body && (body as { error?: string }).error === 'match_not_found') {
      throw new MatchNotFoundError(matchId)
    }
    throw new ApiError(`mesh check: HTTP ${res.status}`, res.status, body)
  }
  throw new ApiError(`mesh check: HTTP ${res.status}`, res.status, await readErrorBody(res))
}

/** Raises the typed errors `fetchMeshState`/`requestMeshBuild` share for a non-2xx response. */
function throwMeshError(res: Response, body: unknown, matchId: string, label: string): never {
  const errorCode = body && typeof body === 'object' ? (body as { error?: string }).error : undefined
  if (res.status === 404 && errorCode === 'match_not_found') throw new MatchNotFoundError(matchId)
  if (res.status === 409 && errorCode === 'no_map_module') throw new NoMapModuleError(matchId)
  throw new ApiError(`${label}: HTTP ${res.status}`, res.status, body)
}

/** `GET /api/matches/{id}/mesh/state` — the module's current build state, polled by the build
 *  panel while a build is queued or running. */
export async function fetchMeshState(matchId: string, signal?: AbortSignal): Promise<MeshStateBody> {
  const res = await fetch(`/api/matches/${encodeURIComponent(matchId)}/mesh/state`, { signal })
  const body = await readErrorBody(res)
  if (!res.ok) throwMeshError(res, body, matchId, 'GET .../mesh/state')
  return body as MeshStateBody
}

/** `POST /api/matches/{id}/mesh/build` — starts or joins the module's build; answers 202 with
 *  the queued/building state, or 200 with the ready state when the mesh already exists. */
export async function requestMeshBuild(matchId: string, signal?: AbortSignal): Promise<MeshStateBody> {
  const res = await fetch(`/api/matches/${encodeURIComponent(matchId)}/mesh/build`, {
    method: 'POST',
    signal,
  })
  const body = await readErrorBody(res)
  if (!res.ok) throwMeshError(res, body, matchId, 'POST .../mesh/build')
  return body as MeshStateBody
}

export async function cancelMeshBuild(matchId: string, signal?: AbortSignal): Promise<MeshStateBody> {
  const res = await fetch(`/api/matches/${encodeURIComponent(matchId)}/mesh/cancel`, { method: 'POST', signal })
  const body = await readErrorBody(res)
  if (!res.ok) throwMeshError(res, body, matchId, 'POST .../mesh/cancel')
  return body as MeshStateBody
}

// --- Account sign-in (`/api/auth/*`) ---------------------------------------------------------

/** The four states the sign-in contract defines. Fields that do not apply to a given state are
 *  omitted by the server, never sent as `null` — same convention as `MeshStateBody`. */
export type AuthStateValue = 'signed_out' | 'pending' | 'signed_in' | 'failed'

/** The body of `GET /api/auth/state`, `POST /api/auth/login` and `POST /api/auth/logout`. */
export interface AuthStateBody {
  state: AuthStateValue
  gamertag?: string
  verificationUri?: string
  userCode?: string
  expiresAt?: string
  error?: string
  /** True from a `--read-only` server, which never signs in. */
  readOnly?: boolean
}

/** The server's older `/api/auth/state` shape (`{signedIn, gamertag?}`), read only so this
 *  client still works against a server build that has not picked up the `{state:...}` contract
 *  yet (see `cmd/infinite-theater-3d/remote_routes.go`, `authState`). Once every server this
 *  app talks to answers with `state`, this type and `normalizeAuthState`'s fallback branch can
 *  go. */
interface LegacyAuthStateBody {
  signedIn?: boolean
  gamertag?: string
}

function isAuthStateValue(v: unknown): v is AuthStateValue {
  return v === 'signed_out' || v === 'pending' || v === 'signed_in' || v === 'failed'
}

/** Normalizes whatever `/api/auth/state` answers: the current `{state:...}` contract when
 *  present, the older `{signedIn}` shape otherwise. An unrecognized or missing `state` that
 *  does not look signed in reads as `signed_out`, never as an error. */
export function normalizeAuthState(raw: unknown): AuthStateBody {
  if (raw && typeof raw === 'object' && isAuthStateValue((raw as { state?: unknown }).state)) {
    return raw as AuthStateBody
  }
  const legacy = raw as LegacyAuthStateBody | null
  if (legacy && legacy.signedIn) {
    return { state: 'signed_in', gamertag: legacy.gamertag }
  }
  return { state: 'signed_out' }
}

/** `GET /api/auth/state` — the current sign-in state. */
export async function fetchAuthState(signal?: AbortSignal): Promise<AuthStateBody> {
  const res = await fetch('/api/auth/state', { signal })
  const body = await readErrorBody(res)
  if (!res.ok) throw new ApiError(`GET /api/auth/state: HTTP ${res.status}`, res.status, body)
  return normalizeAuthState(body)
}

/** `POST /api/auth/login` — starts the Microsoft device-code sign-in (202 with the pending
 *  state) or reports an already-signed-in account (200, `signed_in`). */
export async function startLogin(signal?: AbortSignal): Promise<AuthStateBody> {
  const res = await fetch('/api/auth/login', { method: 'POST', signal })
  const body = await readErrorBody(res)
  if (!res.ok) throw new ApiError(`POST /api/auth/login: HTTP ${res.status}`, res.status, body)
  return normalizeAuthState(body)
}

/** `POST /api/auth/logout` — signs out and returns the signed-out state. */
export async function requestLogout(signal?: AbortSignal): Promise<AuthStateBody> {
  const res = await fetch('/api/auth/logout', { method: 'POST', signal })
  const body = await readErrorBody(res)
  if (!res.ok) throw new ApiError(`POST /api/auth/logout: HTTP ${res.status}`, res.status, body)
  return normalizeAuthState(body)
}

// --- Remote matches and fetching (`/api/remote/matches`, `/api/matches/{id}/fetch*`) --------

/** One row of `GET /api/remote/matches` (see `internal/haloapi/client.go`, `Match`).
 *  `mapAssetId` is present when the service response names the map variant's asset id;
 *  `mapImageUrl` is present when that image is already stored locally ("" when not). */
export interface RemoteMatch {
  id: string
  map: string
  mode: string
  time: string
  mapAssetId?: string
  mapImageUrl?: string
}

/** The URL of `GET /api/remote/matches`: the signed-in player's own history, or with a
 *  `gamertag` any player's (`?gamertag=`, URL-encoded). */
export function remoteMatchesUrl(gamertag?: string | null): string {
  return gamertag ? `/api/remote/matches?gamertag=${encodeURIComponent(gamertag)}` : '/api/remote/matches'
}

/** `GET /api/remote/matches` — recent matches from the Halo service: the signed-in player's,
 *  or the named player's when `gamertag` is given. 401 when not signed in, 400 for a
 *  malformed gamertag, 404 (`gamertag not found`) when no player has that gamertag, 502 when
 *  the service call itself fails; each carries a typed `{error: string}` body that becomes
 *  this error's message. */
export async function fetchRemoteMatches(signal?: AbortSignal, gamertag?: string | null): Promise<RemoteMatch[]> {
  const res = await fetch(remoteMatchesUrl(gamertag), { signal })
  if (!res.ok) {
    const body = await readErrorBody(res)
    const message =
      body && typeof body === 'object' && typeof (body as { error?: string }).error === 'string'
        ? (body as { error: string }).error
        : `HTTP ${res.status}`
    throw new ApiError(`GET /api/remote/matches: ${message}`, res.status, body)
  }
  return (await res.json()) as RemoteMatch[]
}

/** The lifecycle of one match's remote fetch-and-build job, as the fetch state route answers
 *  it. `idle` means the server holds no job for this match id at all (never started, or a
 *  different match is the one in flight). */
export type FetchJobState = 'idle' | 'queued' | 'downloading' | 'building' | 'ready' | 'failed'

/** The body of `GET /api/matches/{id}/fetch/state` and the 202 from `POST .../fetch`. */
export interface FetchStateBody {
  state: FetchJobState
  matchId?: string
  done: number
  total: number
  error?: string
  /** The 1-based place a queued id has in the server's FIFO queue (1 = next). */
  position?: number
}

/** Thrown by `startMatchFetch` on 409: an older server runs one fetch at a time and refused
 *  this one as a duplicate (it never happens with a current server, which queues it). */
export class FetchConflictError extends ApiError {
  constructor(body: unknown) {
    super('a fetch is already in progress', 409, body)
  }
}

/** `GET /api/matches/{id}/fetch/state` — the match's current fetch/build job state, polled
 *  while a job for it is queued, downloading or building. */
export async function fetchFetchState(matchId: string, signal?: AbortSignal): Promise<FetchStateBody> {
  const res = await fetch(`/api/matches/${encodeURIComponent(matchId)}/fetch/state`, { signal })
  const body = await readErrorBody(res)
  if (!res.ok) throw new ApiError(`GET .../fetch/state: HTTP ${res.status}`, res.status, body)
  return body as FetchStateBody
}

/** `POST /api/matches/{id}/fetch` — queues this match for downloading and building; the
 *  server runs fetches one at a time, in FIFO order, and answers 202 with the match's
 *  snapshot (queued and its position, or its current state when already queued/in flight). */
export async function startMatchFetch(matchId: string, signal?: AbortSignal): Promise<FetchStateBody> {
  const res = await fetch(`/api/matches/${encodeURIComponent(matchId)}/fetch`, {
    method: 'POST',
    signal,
  })
  const body = await readErrorBody(res)
  if (res.status === 409) throw new FetchConflictError(body)
  if (!res.ok) throw new ApiError(`POST .../fetch: HTTP ${res.status}`, res.status, body)
  return body as FetchStateBody
}

/** The state of the Ekur export the server can see: a full valid reference, no candidate at
 *  all, or a candidate that does not carry the contract entries. */
export type CoatingsExportState = 'ok' | 'not_set' | 'invalid'

/** One coating library in the coating status: built, still current (not stale), and how many
 *  of its materials the export does not know (they render neutral). */
export interface CoatingsLibraryStatus {
  built: boolean
  stale: boolean
  materialsMissing: number
}

/** One coating library as the server sends it (`materials_missing` is the server's snake_case
 *  field). The client renames it to `materialsMissing` in `CoatingsLibraryStatus`. */
export interface CoatingsLibraryRaw {
  built: boolean
  stale: boolean
  materials_missing: number
}

/** The body of `GET /api/coatings/status` as the client consumes it (see `coatingsStatus` in
 *  `cmd/infinite-theater-3d/serve_coatings.go`): the export state and the three coating
 *  libraries, each reporting whether it is built, still current, and how many of its materials
 *  the export does not know. */
export interface CoatingsStatusBody {
  export: CoatingsExportState
  /** True when the `IT3D_EKUR_DIR` variable names the export (it always wins over the app's
   *  own `<data>/ekur`), so the in-app coatings setup cannot change what the builds read. */
  override: boolean
  libraries: {
    spartan_pieces: CoatingsLibraryStatus
    weapons: CoatingsLibraryStatus
    first_person: CoatingsLibraryStatus
  }
}

/** `GET /api/coatings/status` — the coating status. The viewer fetches it once per match view
 *  to decide whether to show its top-bar notice. The response never carries a path or an
 *  environment value. */
export async function fetchCoatingsStatus(signal?: AbortSignal): Promise<CoatingsStatusBody> {
  const res = await fetch('/api/coatings/status', { signal })
  const body = await readErrorBody(res)
  if (!res.ok) throw new ApiError(`GET /api/coatings/status: HTTP ${res.status}`, res.status, body)
  const raw = body as {
    export?: CoatingsExportState
    override?: boolean
    libraries?: Record<string, CoatingsLibraryRaw>
  }
  const libraries = raw.libraries ?? {}
  const norm = (key: 'spartan_pieces' | 'weapons' | 'first_person'): CoatingsLibraryStatus => {
    const lib = libraries[key] ?? { built: false, stale: false, materials_missing: 0 }
    return { built: lib.built, stale: lib.stale, materialsMissing: lib.materials_missing }
  }
  return {
    export: raw.export ?? 'not_set',
    override: raw.override ?? false,
    libraries: {
      spartan_pieces: norm('spartan_pieces'),
      weapons: norm('weapons'),
      first_person: norm('first_person'),
    },
  }
}

/** The stages of the in-app coatings setup job, in order, then its two outcomes. `idle`
 *  means no setup ran in this server process. */
export type CoatingsSetupJobState =
  | 'idle'
  | 'extracting'
  | 'validating'
  | 'queuing'
  | 'ready'
  | 'failed'

/** The body of `GET /api/coatings/setup/state` and of the 202 from `POST /api/coatings/setup`
 *  (see `coatingsSetupState` in `cmd/infinite-theater-3d/serve_coatings_setup.go`). `error`
 *  is the server's own message, present only when the state is `failed`. */
export interface CoatingsSetupStateBody {
  state: CoatingsSetupJobState
  error?: string
}

/** Thrown by `startCoatingsSetup` on 409: a setup is already running (another tab started
 *  it, or this page lost track of it). The caller polls the state route instead. */
export class CoatingsSetupConflictError extends ApiError {
  constructor(body: unknown) {
    super('a coatings setup is already in progress', 409, body)
  }
}

/** `GET /api/coatings/setup/state` — the setup job's current stage, polled while it runs. */
export async function fetchCoatingsSetupState(signal?: AbortSignal): Promise<CoatingsSetupStateBody> {
  const res = await fetch('/api/coatings/setup/state', { signal })
  const body = await readErrorBody(res)
  if (!res.ok) throw new ApiError(`GET /api/coatings/setup/state: HTTP ${res.status}`, res.status, body)
  return body as CoatingsSetupStateBody
}

/** `POST /api/coatings/setup` — starts the coatings setup (write the Ekur export straight from
 *  the installed game, validate it, queue the coating library rebuilds). 409 is
 *  `CoatingsSetupConflictError`. */
export async function startCoatingsSetup(signal?: AbortSignal): Promise<CoatingsSetupStateBody> {
  const res = await fetch('/api/coatings/setup', { method: 'POST', signal })
  const body = await readErrorBody(res)
  if (res.status === 409) throw new CoatingsSetupConflictError(body)
  if (!res.ok) throw new ApiError(`POST /api/coatings/setup: HTTP ${res.status}`, res.status, body)
  return body as CoatingsSetupStateBody
}
