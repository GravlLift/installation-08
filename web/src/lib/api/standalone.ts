/**
 * standalone.ts — the client for this app's own Go server (`infinite-theater-3d serve`),
 * reached through the Vite dev proxy (or, in production, same-origin) at `/api/*`.
 *
 * Three routes exist: the match list, one match's replay document (gzip over the wire,
 * decompressed transparently by the browser's `fetch`), and that match's map mesh (a GLB,
 * range-capable, or a typed 404 when it has not been built).
 */
import type { ReplayDocument } from './types'

/** One row of `GET /api/matches` (see `internal/store/match.go`). */
export interface MatchSummary {
  matchId: string
  mapName: string
  mapModule: string
  build: string
  durationMs: number
  players: { name: string; team: number }[] | null
  importedAt: string
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
