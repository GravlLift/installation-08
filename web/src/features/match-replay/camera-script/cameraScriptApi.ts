// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * cameraScriptApi.ts — THE CLIENT for a match's camera scripts (docs/design/camera-scripts.md,
 * unit 4a). Thin fetch wrappers over the server's `/api/matches/{id}/camera-scripts` routes, in
 * the style of `lib/api/standalone.ts`: relative URLs (same proxy/origin), `ApiError` on a bad
 * answer, ids and names through `encodeURIComponent`. The server does only a light shape check;
 * loading a script runs it through `parseCameraScript` for the full validation.
 */
import { ApiError } from '../../../lib/api/standalone'
import { parseCameraScript, type CameraScript } from '../scene3d/cameraScript3d'

/** One row of `GET .../camera-scripts`: the script's name, its modified time (RFC3339 UTC), and
 * its key count (see `handleCameraScriptList`). */
export interface CameraScriptSummary {
  name: string
  modified: string
  keys: number
}

/** The answer of a `PUT .../camera-scripts/{name}`: the stored name and its key count. */
export interface CameraScriptSaved {
  name: string
  keys: number
}

/** One row of `GET /api/spartan/poses`: a pose clip the scene can resolve as a hold's `clip`. */
export interface PoseSummary {
  id: string
  kind: 'idle' | 'stance' | 'emote'
  name: string
}

/** The JSON body of a non-OK answer, or null when there is none to read. */
async function readErrorBody(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

/** The relative URL of a camera script route; `name` omitted for the list route. */
function url(matchId: string, name?: string): string {
  const base = `/api/matches/${encodeURIComponent(matchId)}/camera-scripts`
  return name === undefined ? base : `${base}/${encodeURIComponent(name)}`
}

/** `GET /api/matches/{id}/camera-scripts` — the match's stored scripts, sorted by name. */
export async function listCameraScripts(matchId: string, signal?: AbortSignal): Promise<CameraScriptSummary[]> {
  const res = await fetch(url(matchId), { signal })
  if (!res.ok) {
    const body = await readErrorBody(res)
    throw new ApiError(`GET .../camera-scripts: HTTP ${res.status}`, res.status, body)
  }
  const data = (await res.json()) as { scripts: CameraScriptSummary[] }
  return data.scripts
}

/**
 * `GET /api/matches/{id}/camera-scripts/{name}` — one stored script, validated with
 * `parseCameraScript` against the route's match id. A parse failure throws an `Error` carrying
 * the parser's message; a non-OK HTTP answer throws an `ApiError`.
 */
export async function fetchCameraScript(
  matchId: string,
  name: string,
  signal?: AbortSignal,
): Promise<CameraScript> {
  const res = await fetch(url(matchId, name), { signal })
  if (!res.ok) {
    const body = await readErrorBody(res)
    throw new ApiError(`GET .../camera-scripts/${name}: HTTP ${res.status}`, res.status, body)
  }
  const raw = await res.json()
  const parsed = parseCameraScript(raw, matchId)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.script
}

/**
 * `PUT /api/matches/{id}/camera-scripts/{name}` — store the script under its own name (the
 * route's id is taken from `script.matchId`). A 400 throws an `ApiError` whose body carries the
 * server's `reason`.
 */
export async function saveCameraScript(script: CameraScript, signal?: AbortSignal): Promise<CameraScriptSaved> {
  const res = await fetch(url(script.matchId, script.name), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(script),
    signal,
  })
  if (!res.ok) {
    const body = await readErrorBody(res)
    throw new ApiError(`PUT .../camera-scripts/${script.name}: HTTP ${res.status}`, res.status, body)
  }
  return (await res.json()) as CameraScriptSaved
}

/**
 * `GET /api/spartan/poses` — the Spartan's pose catalog: the idle, emote and stance clips of
 * the game's animation graphs. A 503 (the game is not installed) resolves to an empty list;
 * it is not an error.
 */
export async function listPoses(signal?: AbortSignal): Promise<PoseSummary[]> {
  const res = await fetch('/api/spartan/poses', { signal })
  if (res.status === 503) return []
  if (!res.ok) {
    const body = await readErrorBody(res)
    throw new ApiError(`GET /api/spartan/poses: HTTP ${res.status}`, res.status, body)
  }
  const data = (await res.json()) as { poses: PoseSummary[] }
  return data.poses
}

/** `DELETE /api/matches/{id}/camera-scripts/{name}` — remove the script (204 on success). */
export async function deleteCameraScript(matchId: string, name: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url(matchId, name), { method: 'DELETE', signal })
  if (!res.ok) {
    const body = await readErrorBody(res)
    throw new ApiError(`DELETE .../camera-scripts/${name}: HTTP ${res.status}`, res.status, body)
  }
}
