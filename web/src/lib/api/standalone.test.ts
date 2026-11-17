// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * standalone.test.ts — the texture quality on the client side: every mesh/variant URL carries
 * the `?quality=high` parameter only for High; Standard (or no quality at all) leaves the URLs
 * byte-for-byte the pre-quality ones. Covers the mesh GLB route, the HEAD check, and the
 * state/build/cancel build routes.
 */
import { afterEach, expect, it, vi } from 'vitest'

import {
  cancelMeshBuild,
  checkMesh,
  fetchMeshState,
  meshUrl,
  qualityQuery,
  requestMeshBuild,
} from './standalone'

afterEach(() => vi.unstubAllGlobals())

it('qualityQuery: High adds the parameter, Standard and absent add none', () => {
  expect(qualityQuery('high')).toBe('?quality=high')
  expect(qualityQuery('standard')).toBe('')
  expect(qualityQuery(undefined)).toBe('')
})

it('meshUrl: Standard leaves the URL unchanged, High carries the parameter', () => {
  expect(meshUrl('abc')).toBe('/api/matches/abc/mesh.glb')
  expect(meshUrl('abc', 'standard')).toBe('/api/matches/abc/mesh.glb')
  expect(meshUrl('abc', 'high')).toBe('/api/matches/abc/mesh.glb?quality=high')
})

it('checkMesh HEADs the chosen quality URL', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
  vi.stubGlobal('fetch', fetchMock)
  await checkMesh('abc', undefined, 'high')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[0][0]).toBe('/api/matches/abc/mesh.glb?quality=high')
  expect(fetchMock.mock.calls[0][1].method).toBe('HEAD')
})

it('checkMesh HEADs the unchanged URL for Standard', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
  vi.stubGlobal('fetch', fetchMock)
  await checkMesh('abc', undefined, 'standard')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[0][0]).toBe('/api/matches/abc/mesh.glb')
})

it('the state/build/cancel routes carry the High quality', async () => {
  const body = { state: 'ready', moduleKey: 'mod' }
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body })
  vi.stubGlobal('fetch', fetchMock)
  await fetchMeshState('abc', undefined, 'high')
  await requestMeshBuild('abc', undefined, 'high')
  await cancelMeshBuild('abc', undefined, 'high')
  expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
    '/api/matches/abc/mesh/state?quality=high',
    '/api/matches/abc/mesh/build?quality=high',
    '/api/matches/abc/mesh/cancel?quality=high',
  ])
  expect(fetchMock.mock.calls[1][1].method).toBe('POST')
})

it('the state/build/cancel routes omit the parameter for Standard', async () => {
  const body = { state: 'ready', moduleKey: 'mod' }
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body })
  vi.stubGlobal('fetch', fetchMock)
  await fetchMeshState('abc', undefined, 'standard')
  await requestMeshBuild('abc', undefined, 'standard')
  await cancelMeshBuild('abc', undefined, 'standard')
  expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
    '/api/matches/abc/mesh/state',
    '/api/matches/abc/mesh/build',
    '/api/matches/abc/mesh/cancel',
  ])
})
