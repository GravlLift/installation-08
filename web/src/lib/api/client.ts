/**
 * client.ts — minimal standalone stand-in for LevelUp's `lib/api/client`.
 *
 * The lifted scene/UI code calls a handful of `api.*` methods (getResponse, get,
 * getWithHeader, head, getBlob) to fetch mesh/armor/weapon assets from the LevelUp
 * backend. This viewer has no backend: `api` here is a plain `fetch` wrapper against
 * `API_BASE_URL` (empty by default, so paths resolve against the dev server / the
 * `public/` folder), with the same method shapes so the lifted files need no edits.
 * There is no session, no title header, no cross-title guard: none of that exists in
 * a standalone single-match viewer.
 */

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

/** Base URL for callers that build a GLTFLoader resource path by hand. */
export const API_BASE_URL = BASE_URL

export interface ApiError {
  code: string
  message: string
  retryable: boolean
  status: number
}

export interface CallOptions {
  signal?: AbortSignal
}

function resolve(path: string): string {
  return path.startsWith('http://') || path.startsWith('https://') ? path : `${BASE_URL}${path}`
}

async function toApiError(response: Response): Promise<ApiError> {
  let message = response.statusText || `HTTP ${response.status}`
  try {
    const body = (await response.clone().json()) as Partial<ApiError>
    if (body?.message) message = body.message
  } catch {
    // Non-JSON body: keep the status text.
  }
  return { code: '', message, retryable: response.status >= 500, status: response.status }
}

async function send(method: string, path: string, options?: CallOptions): Promise<Response> {
  const response = await fetch(resolve(path), { method, signal: options?.signal })
  if (!response.ok) throw await toApiError(response)
  return response
}

export const api = {
  getResponse: (path: string, options?: CallOptions): Promise<Response> => send('GET', path, options),

  get: async <T>(path: string, _headers?: Record<string, string>, options?: CallOptions): Promise<T> => {
    const response = await send('GET', path, options)
    return (await response.json()) as T
  },

  getWithHeader: async <T>(
    path: string,
    header: string,
    _headers?: Record<string, string>,
  ): Promise<{ data: T; header: string | null }> => {
    const response = await send('GET', path)
    return { data: (await response.json()) as T, header: response.headers.get(header) }
  },

  head: async (path: string, options?: CallOptions): Promise<void> => {
    await send('HEAD', path, options)
  },

  getBlob: async (path: string): Promise<Blob> => {
    const response = await send('GET', path)
    return response.blob()
  },
}

export function apiErrorMessage(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message
    if (typeof m === 'string' && m.length > 0) return m
  }
  if (err instanceof Error) return err.message
  return undefined
}

export function apiErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const c = (err as { code?: unknown }).code
    if (typeof c === 'string' && c.length > 0) return c
  }
  return undefined
}
