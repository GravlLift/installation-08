// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * cameraScriptApi.test.ts — the camera-script client: each call's method, encoded URL and body,
 * and the 404/400 answers turning into thrown errors that carry the server's error or reason.
 */
import { afterEach, expect, it, vi } from 'vitest'

import { deleteCameraScript, fetchCameraScript, listCameraScripts, saveCameraScript } from './cameraScriptApi'
import type { CameraScript } from '../scene3d/cameraScript3d'

afterEach(() => vi.unstubAllGlobals())

/** Stubs the global fetch to answer with the given status and JSON body. */
function stub(status: number, body?: unknown): ReturnType<typeof vi.fn> {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (body === undefined ? null : body),
  }
  const mock = vi.fn().mockResolvedValue(res)
  vi.stubGlobal('fetch', mock)
  return mock
}

const SCRIPT: CameraScript = {
  version: 1,
  matchId: 'm',
  name: 'intro',
  keys: [{ t: 0, pos: { at: 'world', point: [0, 0, 0] }, look: { at: 'world', point: [1, 0, 0] } }],
}

it('listCameraScripts GETs the encoded list URL and returns the scripts', async () => {
  const mock = stub(200, {
    scripts: [{ name: 'a', modified: '2026-01-01T00:00:00Z', keys: 3 }],
  })
  const out = await listCameraScripts('a b/c')
  expect(mock).toHaveBeenCalledTimes(1)
  expect(mock.mock.calls[0][0]).toBe('/api/matches/a%20b%2Fc/camera-scripts')
  expect(mock.mock.calls[0][1].method).toBeUndefined()
  expect(out).toEqual([{ name: 'a', modified: '2026-01-01T00:00:00Z', keys: 3 }])
})

it('fetchCameraScript GETs the encoded URL and returns the validated script', async () => {
  const mock = stub(200, SCRIPT)
  const out = await fetchCameraScript('m', 'intro')
  expect(mock.mock.calls[0][0]).toBe('/api/matches/m/camera-scripts/intro')
  expect(out).toEqual(SCRIPT)
})

it('fetchCameraScript throws an ApiError carrying the 404 body', async () => {
  stub(404, { error: 'script_not_found', name: 'nope' })
  await expect(fetchCameraScript('m', 'nope')).rejects.toMatchObject({
    status: 404,
    body: { error: 'script_not_found' },
  })
})

it('fetchCameraScript throws an Error with the parser message on a bad body', async () => {
  stub(200, { version: 2, matchId: 'm', name: 'x', keys: [] })
  await expect(fetchCameraScript('m', 'x')).rejects.toThrow('version must be exactly 1')
})

it('saveCameraScript PUTs the script JSON to the encoded URL', async () => {
  const mock = stub(200, { name: 'intro', keys: 1 })
  const out = await saveCameraScript(SCRIPT)
  expect(mock.mock.calls[0][0]).toBe('/api/matches/m/camera-scripts/intro')
  expect(mock.mock.calls[0][1].method).toBe('PUT')
  expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual(SCRIPT)
  expect(out).toEqual({ name: 'intro', keys: 1 })
})

it('saveCameraScript throws an ApiError carrying the 400 reason', async () => {
  stub(400, { error: 'invalid_script', reason: 'keys must be an array' })
  await expect(saveCameraScript(SCRIPT)).rejects.toMatchObject({
    status: 400,
    body: { error: 'invalid_script', reason: 'keys must be an array' },
  })
})

it('deleteCameraScript DELETEs the encoded URL', async () => {
  const mock = stub(204)
  await deleteCameraScript('a b/c', 'intro')
  expect(mock.mock.calls[0][0]).toBe('/api/matches/a%20b%2Fc/camera-scripts/intro')
  expect(mock.mock.calls[0][1].method).toBe('DELETE')
})

it('deleteCameraScript throws an ApiError on a 404', async () => {
  stub(404, { error: 'script_not_found', name: 'nope' })
  await expect(deleteCameraScript('m', 'nope')).rejects.toMatchObject({
    status: 404,
    body: { error: 'script_not_found' },
  })
})
