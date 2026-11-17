// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * soundLatency.measure.test.ts — MEASURES the live sound path on a real stored match.
 *
 * Opt-in: it runs only when `IT3D_SOUND_MEASURE_DATA` names a data directory (read-only), and
 * prints a JSON report (also written to `IT3D_SOUND_MEASURE_OUT` when set). It drives the REAL
 * `useReplaySound` beat and the REAL `ReplayAudioPlayer` through a clocked Web Audio double
 * (`soundLatencyHarness.ts`) with the beat of a slow main thread, and reads, for every event of
 * the busiest stretch of the match, the moment its source was asked to start against the moment
 * the event sits on the replay clock.
 *
 * The track is the one the page builds (`buildSoundTimeline` + footsteps + reloads + vents), each
 * event given a unique stem so its source can be traced back to it; the takes' durations are read
 * from the stored Opus files.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NO_ALLEGIANCE } from '@/lib/replay/filmAllegiance'
import { buildKillsFromDocument } from '@/lib/replay/killsFromDocument'
import { normalizeReplayDocument } from '@/lib/replay/replayNormalize'
import type { ReplayDocument } from '@/lib/api/types'

import {
  SimClock,
  SimContext,
  pageMsOf,
  opusDurationSeconds,
  quantile,
  simRandom,
  type SimSource,
} from '../test/soundLatencyHarness'
import { footstepSoundEvents } from './footstepSound'
import { parseFootstepManifest } from './footstepManifest'
import { parseReloadManifest, reloadLibrary, ventLibrary, weaponTagOf } from './reloadManifest'
import { reloadSoundEvents } from './reloadSound'
import { buildSoundTimeline, SOUND_CATEGORIES_DEFAULT } from './replaySound'
import { pickVariantStem, type ReplaySoundEvent } from './replaySoundVariants'
import { listenerAtOfPlayer } from './soundListenerOf'
import { placeOf } from './soundSpatial'
import { useReplaySound, type ReplaySoundContext } from './useReplaySound'
import { ventSoundEvents } from './ventSound'

const DATA = process.env.IT3D_SOUND_MEASURE_DATA ?? ''
const MATCH = process.env.IT3D_SOUND_MEASURE_MATCH ?? 'd01ba030-7f78-48a7-8ed2-f3be430c3fcf'
const OUT = process.env.IT3D_SOUND_MEASURE_OUT ?? ''
const WINDOW_MS = Number(process.env.IT3D_SOUND_MEASURE_WINDOW_MS ?? 30_000)
const ENABLED = DATA !== '' && existsSync(path.join(DATA, 'matches', MATCH, 'replay.json.gz'))

const holder = vi.hoisted(() => ({ timeline: [] as ReplaySoundEvent[] }))
vi.mock('./useSoundTimeline', () => ({
  useSoundTimeline: () => ({ timeline: holder.timeline, announcer: undefined }),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const SOUNDS = () => path.join(DATA, 'assets', 'sounds', 'halo_infinite')
const UNIQUE = '__ev'

/** What the harness knows of each traced event. */
interface Meta {
  e: ReplaySoundEvent
  foot: boolean
  own: boolean
  /** Linear level of the voice (event gain x distance), the weapon variation left out. */
  level: number
}

function loadTrack() {
  const raw = JSON.parse(gunzipSync(readFileSync(path.join(DATA, 'matches', MATCH, 'replay.json.gz'))).toString('utf8')) as ReplayDocument
  const doc = normalizeReplayDocument(raw)
  const followed = doc.tracks.find((t) => t.xuid)?.xuid ?? null
  const base = buildSoundTimeline(doc, buildKillsFromDocument(doc), SOUND_CATEGORIES_DEFAULT, undefined, null, undefined)
  const footManifest = parseFootstepManifest(JSON.parse(readFileSync(path.join(SOUNDS(), 'footsteps.json'), 'utf8')))
  const foot = footManifest ? footstepSoundEvents(footManifest, doc, 'default', followed) : []
  const reloadManifest = parseReloadManifest(JSON.parse(readFileSync(path.join(SOUNDS(), 'reloads.json'), 'utf8')))
  const tags = [...new Set(Object.keys(doc.weaponLabels ?? {}).map((id) => weaponTagOf(id)).filter((t): t is string => !!t))]
  const level = () => ({ rmsDb: -20, peakDb: -3 })
  const extras = reloadManifest
    ? [...reloadSoundEvents(doc, reloadLibrary(reloadManifest, tags, level), followed), ...ventSoundEvents(doc, ventLibrary(reloadManifest, tags, level), followed)]
    : []
  const all = [...base, ...extras, ...foot].sort((a, b) => a.ms - b.ms)
  return { doc, followed, all, footSet: new Set(foot) }
}

/** The densest `WINDOW_MS` of the track. */
function busiestWindow(all: readonly ReplaySoundEvent[]): { startMs: number; endMs: number } {
  // Densest in NON-footstep events (shots, throws, equipment): the footsteps of the same stretch ride along.
  let best = 0
  let bestStart = 0
  let j = 0
  for (let i = 0; i < all.length; i++) {
    while (all[j].ms < all[i].ms - WINDOW_MS) j++
    if (i - j + 1 > best) {
      best = i - j + 1
      bestStart = all[i].ms - WINDOW_MS
    }
  }
  return { startMs: Math.max(0, bestStart), endMs: bestStart + WINDOW_MS }
}

/** The beat of the page's animation loop for one scenario. */
interface Scenario {
  name: string
  /** Gap between two beats, ms. */
  gap: (rnd: () => number, tMs: number) => number
  /** Main-thread work before the sound beat runs inside a frame, ms. */
  work: (rnd: () => number) => number
}

const SCENARIOS: Scenario[] = [
  { name: '60fps', gap: () => 1000 / 60, work: (r) => r() * 4 },
  { name: 'slow 30-50 ms', gap: (r) => 30 + r() * 20, work: (r) => r() * 10 },
  {
    name: 'slow 30-50 ms + 250 ms hitch every 5 s',
    gap: (r, t) => (Math.floor(t / 5_000) !== Math.floor((t + 50) / 5_000) ? 250 : 30 + r() * 20),
    work: (r) => r() * 10,
  },
]

function durationsOf(stems: Iterable<string>): Map<string, number | null> {
  const out = new Map<string, number | null>()
  for (const s of stems) {
    if (out.has(s)) continue
    const file = path.join(SOUNDS(), `${s}.ogg`)
    out.set(s, existsSync(file) ? opusDurationSeconds(readFileSync(file)) : null)
  }
  return out
}

function stemOfUrl(url: string): string {
  return decodeURIComponent(url.split('/').pop() ?? '').replace(/\.ogg$/, '')
}

async function runScenario(scn: Scenario, doc: ReturnType<typeof loadTrack>['doc'], followed: string | null, traced: ReplaySoundEvent[], meta: Meta[], win: { startMs: number; endMs: number }) {
  const clock = new SimClock()
  const ctx = new SimContext(clock)
  vi.stubGlobal('AudioContext', function AudioContextDouble() { return ctx })
  const durations = durationsOf(traced.map((e) => e.stem.split(UNIQUE)[0]))
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const base = stemOfUrl(url).split(UNIQUE)[0]
    const d = durations.has(base) ? durations.get(base) : durationsOf([base]).get(base)
    if (d === null || d === undefined) return Promise.resolve({ ok: false, status: 404 })
    const ab = Object.assign(new ArrayBuffer(0), { url, seconds: d })
    return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(ab) })
  }))
  vi.spyOn(performance, 'now').mockImplementation(() => clock.nowMs)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  holder.timeline = traced
  const context: ReplaySoundContext = { allegiance: NO_ALLEGIANCE, endMatch: null, locale: undefined, followed, medals: [] }
  const kills = buildKillsFromDocument(doc)
  const { result, unmount } = renderHook(() => useReplaySound(doc, kills, 1, context))
  act(() => result.current.toggle())
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  act(() => result.current.setTransportPlaying(true))

  const listenerAt = followed ? listenerAtOfPlayer(doc, followed) : () => null
  const rnd = simRandom(0x5eed)
  const startMs = win.startMs - 2_000
  let t = 0
  const beat = (pageMs: number, ms: number) => {
    clock.nowMs = pageMs + scn.work(rnd)
    result.current.listener.current = listenerAt(ms)
    ctx.dispatchEnded()
    result.current.tick(ms, pageMs)
  }
  beat(0, startMs)
  const ticks: number[] = []
  while (startMs + t <= win.endMs) {
    const gap = scn.gap(rnd, t)
    t += gap
    ticks.push(gap)
    beat(t, startMs + t)
  }
  // Let every source end.
  for (let k = 0; k < 200; k++) {
    clock.nowMs += 100
    ctx.dispatchEnded()
  }
  unmount()

  // -- Analysis on the measured window only. --
  const targetPage = (e: ReplaySoundEvent) => e.ms - startMs
  const idxOfUrl = (url: string) => Number(stemOfUrl(url).split(UNIQUE)[1])
  const inWindow = (e: ReplaySoundEvent) => e.ms >= win.startMs && e.ms <= win.endMs
  const bySource = new Map<number, SimSource>()
  for (const s of ctx.sources) {
    if (!s.buffer || !s.buffer.url.includes(UNIQUE) || s.started === null) continue
    bySource.set(idxOfUrl(s.buffer.url), s)
  }
  const late: number[] = []
  const startsAt = new Map<number, number[]>()
  const cls = { own: { events: 0, played: 0 }, otherFoot: { events: 0, played: 0 }, otherNonFoot: { events: 0, played: 0 } }
  let loudRefused = 0
  const refusedLevels: Record<'own' | 'otherFoot' | 'otherNonFoot', number[]> = { own: [], otherFoot: [], otherNonFoot: [] }
  const cutShort: Record<'own' | 'otherFoot' | 'otherNonFoot', number[]> = { own: [], otherFoot: [], otherNonFoot: [] }
  const intervals: Array<[number, number]> = []
  for (let i = 0; i < traced.length; i++) {
    const e = traced[i]
    if (!inWindow(e)) continue
    const m = meta[i]
    const c = m.own ? cls.own : m.foot ? cls.otherFoot : cls.otherNonFoot
    c.events++
    const s = bySource.get(i)
    const played = !!s && s.started !== null && !(s.stopped !== null && s.stopped <= s.started)
    const k = m.own ? 'own' : m.foot ? 'otherFoot' : 'otherNonFoot'
    if (!played) {
      if (m.level >= 0.5) loudRefused++
      refusedLevels[k].push(m.level)
      continue
    }
    c.played++
    // CUT SHORT: its slot was taken (it stopped well before its file's end, the pause excluded here).
    const natural = durations.get(e.stem.split(UNIQUE)[0]) ?? null
    if (natural !== null && e.holdMs === undefined && e.cutMs === undefined && s.stopped !== null && s.stopped - s.started! < Math.min(natural, 12) - 0.03) {
      cutShort[k].push(m.level)
    }
    const startPage = pageMsOf(s.started!)
    late.push(startPage - targetPage(e))
    const key = Math.round(startPage * 10)
    startsAt.set(key, [...(startsAt.get(key) ?? []), targetPage(e)])
    intervals.push([startPage, pageMsOf(s.stopped ?? s.started! + 12)])
  }
  // Bunched: a source that starts at the SAME instant as another one whose event lies > 5 ms away.
  let bunched = 0
  for (const targets of startsAt.values()) {
    if (targets.length < 2) continue
    const lo = Math.min(...targets)
    const hi = Math.max(...targets)
    if (hi - lo > 5) bunched += targets.length
  }
  // Concurrent voices and live nodes, sampled every 5 ms, peak per second.
  const w0 = win.startMs - startMs
  const w1 = win.endMs - startMs
  const voicePeaks: number[] = []
  const nodePeaks: number[] = []
  for (let s0 = w0; s0 < w1; s0 += 1000) {
    let pv = 0
    let pn = 0
    for (let x = s0; x < s0 + 1000; x += 5) {
      let v = 0
      for (const [a, b] of intervals) if (a <= x && x < b) v++
      let n = 0
      for (const node of ctx.nodes) if (node.createdMs <= x && (node.releasedMs === null || node.releasedMs > x)) n++
      pv = Math.max(pv, v)
      pn = Math.max(pn, n)
    }
    voicePeaks.push(pv)
    nodePeaks.push(pn)
  }
  late.sort((a, b) => a - b)
  voicePeaks.sort((a, b) => a - b)
  nodePeaks.sort((a, b) => a - b)
  const r1 = (x: number) => Math.round(x * 10) / 10
  const pct = (n: number, d: number) => (d === 0 ? 0 : r1((100 * n) / d))
  const events = cls.own.events + cls.otherFoot.events + cls.otherNonFoot.events
  return {
    scenario: scn.name,
    ticks: { count: ticks.length, meanGapMs: r1(ticks.reduce((a, b) => a + b, 0) / ticks.length) },
    events,
    played: late.length,
    playedByClass: cls,
    refusedLoud: loudRefused,
    // Level (linear) of the refused and of the cut-short events, per class: max and median.
    refusedLevel: Object.fromEntries(Object.entries(refusedLevels).map(([k, v]) => {
      const s = [...v].sort((a, b) => a - b)
      return [k, { n: s.length, median: r1(100 * quantile(s, 0.5)) / 100, max: r1(100 * (s[s.length - 1] ?? 0)) / 100 }]
    })),
    cutShort: Object.fromEntries(Object.entries(cutShort).map(([k, v]) => {
      const s = [...v].sort((a, b) => a - b)
      return [k, { n: s.length, median: r1(100 * quantile(s, 0.5)) / 100, max: r1(100 * (s[s.length - 1] ?? 0)) / 100 }]
    })),
    latenessMs: {
      p50: r1(quantile(late, 0.5)),
      p90: r1(quantile(late, 0.9)),
      p99: r1(quantile(late, 0.99)),
      max: r1(late[late.length - 1] ?? Number.NaN),
      min: r1(late[0] ?? Number.NaN),
      over20msPct: pct(late.filter((x) => x > 20).length, late.length),
      over50msPct: pct(late.filter((x) => x > 50).length, late.length),
    },
    bunchedPct: pct(bunched, late.length),
    concurrentVoicesPerSecondPeak: { p50: quantile(voicePeaks, 0.5), p90: quantile(voicePeaks, 0.9), max: voicePeaks[voicePeaks.length - 1] },
    liveNodesPerSecondPeak: { p50: quantile(nodePeaks, 0.5), p90: quantile(nodePeaks, 0.9), max: nodePeaks[nodePeaks.length - 1] },
    nodesCreated: ctx.nodes.length,
  }
}

describe.skipIf(!ENABLED)('MEASURE — live sound lateness and load on a real match', () => {
  it('reports the lateness distribution and the voice/node peaks per scenario', async () => {
    const { doc, followed, all, footSet } = loadTrack()
    const win = busiestWindow(all.filter((e) => !footSet.has(e)))
    const listenerAt = followed ? listenerAtOfPlayer(doc, followed) : () => null
    const rnd = simRandom(1)
    const meta: Meta[] = []
    const traced: ReplaySoundEvent[] = []
    for (const e of all) {
      if (e.ms < win.startMs - 2_000 || e.ms > win.endMs) continue
      const i = traced.length
      const stem = `${pickVariantStem(e, rnd)}${UNIQUE}${i}`
      const { variants: _v, ...rest } = e
      void _v
      traced.push({ ...rest, stem })
      const place = placeOf(listenerAt(e.ms), e)
      meta.push({ e, foot: footSet.has(e), own: !e.at, level: Math.pow(10, (e.gainDb ?? 0) / 20) * (place?.gain ?? 1) })
    }
    const inWin = traced.filter((e) => e.ms >= win.startMs && e.ms <= win.endMs)
    const reports = []
    for (const scn of SCENARIOS) reports.push(await runScenario(scn, doc, followed, traced, meta, win))
    const report = {
      match: MATCH,
      window: win,
      eventsPerSecond: Math.round((10 * inWin.length) / (WINDOW_MS / 1000)) / 10,
      footstepShare: Math.round((100 * inWin.filter((_, k) => meta[traced.indexOf(inWin[k])].foot).length) / inWin.length),
      reports,
    }
    console.log(JSON.stringify(report, null, 2))
    if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2))
    expect(reports.length).toBe(SCENARIOS.length)
  }, 600_000)
})
