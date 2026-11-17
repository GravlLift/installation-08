// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * emptyHands.sweep.test.ts — measure, classify and (for the longest cases) explain the frames in
 * which a living player carries no weapon in hand (`armeEnMain` returns null, no carried object).
 *
 * GATED: runs only when `IT3D_SWEEP=1` (never in CI). It fetches every stored match from the
 * local server, normalizes each replay, scans every living slot every 3rd frame, collects each
 * empty-hand INTERVAL, and prints a per-match summary plus the evidence that decides the cause of
 * the longest intervals.
 */
import { appendFileSync } from 'node:fs'
import { get } from 'node:http'
import { describe, expect, it } from 'vitest'

function report(text: string): void {
  console.log(text)
  const p = process.env.IT3D_SWEEP_OUT
  if (p) appendFileSync(p, text, 'utf8')
}

import { frameToMs, isAliveAt, trackWindow } from '@/lib/replay/replayLogic'
import { normalizeReplayDocument, type ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import { currentLifeOf, loadoutAt } from '@/lib/replay/rosterLogic'

import { armeEnMain, carriedObjectAt, suivreMain } from './armeEnMain'
import { inventoryAt } from './inventoryReading'

const BASE = 'http://127.0.0.1:8177'
const SWEEP = process.env.IT3D_SWEEP === '1'

/** One empty-hand run on one slot of one match. */
interface Interval {
  matchId: string
  slot: number
  start: number
  end: number
  lengthMs: number
}

function getJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        } else {
          resolve(JSON.parse(data) as T)
        }
      })
    }).on('error', reject)
  })
}

/** Scan one normalized document: alive frames, empty-hand frames, and the empty-hand intervals. */
function scanMatch(doc: ReplayDocumentReady): { alive: number; empty: number; intervals: Interval[] } {
  let alive = 0
  let empty = 0
  const open = new Map<number, { start: number; end: number }>()
  const intervals: Interval[] = []
  const close = (slot: number, start: number, end: number) =>
    intervals.push({ matchId: doc.matchId, slot, start, end, lengthMs: frameToMs(end, doc) - frameToMs(start, doc) })
  for (const track of doc.tracks) {
    const w = trackWindow(track)
    for (let f = w.start; f <= w.end; f += 3) {
      if (!isAliveAt(track, f)) continue
      alive++
      if (carriedObjectAt(doc, track.xuid, f)) continue // carrier holds an object, not a weapon
      if (armeEnMain(doc, track.slot, f) == null) {
        empty++
        const cur = open.get(track.slot)
        if (cur) cur.end = f
        else open.set(track.slot, { start: f, end: f })
      } else if (open.has(track.slot)) {
        const cur = open.get(track.slot)!
        close(track.slot, cur.start, cur.end)
        open.delete(track.slot)
      }
    }
    // Close a run that ends at the life's last frame.
    if (open.has(track.slot)) {
      const cur = open.get(track.slot)!
      close(track.slot, cur.start, cur.end)
      open.delete(track.slot)
    }
  }
  return { alive, empty, intervals }
}

/** The last dated hand read of `events` at or before `ms` and at/after `startMs`, or -Infinity. */
function lastDatedReadMs(events: { ms: number[]; w: number[] } | undefined, ms: number, startMs: number): number {
  if (!events) return -Infinity
  for (let i = events.ms.length - 1; i >= 0; i--) {
    if (events.ms[i] <= ms && events.ms[i] >= startMs) return events.ms[i]
  }
  return -Infinity
}

function shotsInLife(doc: ReplayDocumentReady, slot: number, start: number, end: number): number {
  return doc.shots.filter((s) => s.slot === slot && s.t >= start && s.t <= end).length
}

function weaponChangesInLife(doc: ReplayDocumentReady, slot: number, start: number, end: number) {
  return doc.weaponChanges.filter((c) => c.slot === slot && c.t >= start && c.t <= end)
}

function deltaAmmoInLife(doc: ReplayDocumentReady, slot: number, start: number, end: number) {
  return doc.ammoReads.filter((a) => a.slot === slot && a.src === 'delta' && a.ms >= frameToMs(start, doc) && a.ms <= frameToMs(end, doc))
}

function drawnInLife(doc: ReplayDocumentReady, slot: number, start: number, end: number) {
  return doc.drawnWeapons.filter((d) => d.slot === slot && d.t >= start && d.t <= end)
}

/**
 * The evidence that decides the cause of an empty hand at `frame`, and a cause label for it.
 * Mirrors `armeEnMain`'s decision so the label names the branch that left the hand empty.
 */
function diagnose(doc: ReplayDocumentReady, slot: number, frame: number): { cause: string; evidence: Record<string, unknown> } {
  const life = currentLifeOf(doc, slot, frame)
  const start = life ? trackWindow(life).start : 0
  const end = life ? trackWindow(life).end : 0
  const lo = loadoutAt(doc, slot, frame)
  const inv = inventoryAt(doc, slot, frame)
  const events = suivreMain(doc).get(slot)
  const ms = frameToMs(frame, doc)
  const eventMs = lastDatedReadMs(events, ms, frameToMs(start, doc))
  const portees = lo ? lo.weapons.filter(Boolean).length : 0
  const evidence: Record<string, unknown> = {
    frame,
    lifeWindow: [start, end],
    loadout: lo ? { weapons: lo.weapons, k: lo.k, src: lo.src, age: lo.age } : null,
    inventory: inv ? { d: inv.state.d, t: inv.state.t, age: inv.age, empty: inv.empty?.kind ?? null } : null,
    drawn: drawnInLife(doc, slot, start, end),
    deltaAmmo: deltaAmmoInLife(doc, slot, start, end).map((a) => ({ t: a.t, w: a.w, mag: a.mag })),
    weaponChanges: weaponChangesInLife(doc, slot, start, end).map((c) => ({ t: c.t, kind: c.kind, w: c.w, k: c.k })),
    shotCount: shotsInLife(doc, slot, start, end),
  }
  const label = causeOf(doc, { slot, frame, lo, inv, eventMs, portees, events, start, end })
  return { cause: label, evidence }
}

function causeOf(
  doc: ReplayDocumentReady,
  ctx: {
    slot: number
    frame: number
    lo: ReturnType<typeof loadoutAt>
    inv: ReturnType<typeof inventoryAt>
    eventMs: number
    portees: number
    events: { ms: number[]; w: number[] } | undefined
    start: number
    end: number
  },
): string {
  const { lo, inv, eventMs, portees, events, start, end } = ctx
  if (!lo) {
    return shotsInLife(doc, ctx.slot, start, end) === 0
      ? 'life without loadout and no shots'
      : 'life without loadout, shots present but hand not named'
  }
  const invFutur = inv != null && inv.age < 0
  const invPast = inv && inv.age >= 0
  const readLocates = eventMs !== -Infinity || invPast || invFutur
  // Mirror armeEnMain's precedence for the designated slot: a past dated read of the life
  // (selector, per-shot magazine) wins over the keyframe inventory; a future inventory read is
  // borrowed only when it designates a slot that holds a row weapon.
  const invMs = inv ? frameToMs(inv.empty ? ctx.frame - inv.empty.age : inv.state.t, doc) : -Infinity
  const lastEvent = eventMs !== -Infinity && events ? events.w[events.ms.indexOf(eventMs)] : undefined
  const d = invFutur
    ? lastEvent !== undefined
      ? lastEvent
      : inv && !inv.empty && (inv.state.d === 0 || inv.state.d === 1) && lo.weapons[inv.state.d] ? inv.state.d : undefined
    : lastEvent !== undefined && eventMs >= invMs
      ? lastEvent
      : invPast && inv && !inv.empty ? inv.state.d : undefined
  const id = d === 0 || d === 1 ? lo.weapons[d] : undefined
  if (id && !doc.weaponLabels?.[id]) return `weapon id with no family: ${id}`
  if (!readLocates) {
    // No dated read and no past inventory: the hand is only born of the row.
    if (portees === 1) return 'no read locates the hand; single weapon row not admissible (change dated)'
    return `no read locates the hand and ${portees} weapons carried`
  }
  if (d === 0 || d === 1) {
    if (!id) return `read locates emplacement ${d} whose weapon id is absent from the row`
    return `read locates the hand but emplacement ${d} resolves to no usable id`
  }
  // Emplacement 2 is the film's non-weapon object slot (grammar_inventaire.go: bare hands,
  // the pre-start state of every player, or an objective object). An empty hand here is the
  // measured truth, not a gap.
  if (d === 2) return 'read designates non-weapon emplacement 2 (bare hands / objective object)'
  return `read does not designate a weapon emplacement (d=${String(d)}, portees=${portees})`
}

describe.skipIf(!SWEEP)('empty hands sweep', () => {
  it('measures, classifies and explains empty-hand intervals across all stored matches', async () => {
    const matches = await getJson<{ matchId: string; mapName: string }[]>(`${BASE}/api/matches`)
    const docs = new Map<string, ReplayDocumentReady>()
    const perMatch: { id: string; mapName: string; alive: number; empty: number; pct: number; intervals: number; totalSec: number }[] = []
    const allIntervals: Interval[] = []
    for (const m of matches) {
      const raw = await getJson<Parameters<typeof normalizeReplayDocument>[0]>(`${BASE}/api/matches/${m.matchId}/replay`)
      const doc = normalizeReplayDocument(raw)
      docs.set(m.matchId, doc)
      const { alive, empty, intervals } = scanMatch(doc)
      const totalSec = intervals.reduce((s, i) => s + i.lengthMs, 0) / 1000
      perMatch.push({ id: m.matchId.slice(0, 8), mapName: m.mapName, alive, empty, pct: alive ? (empty / alive) * 100 : 0, intervals: intervals.length, totalSec })
      allIntervals.push(...intervals)
    }

    const pad = (s: string, n: number) => s.slice(0, n).padEnd(n)
    let out = '\n' + [pad('match', 10), pad('map', 24), pad('alive', 7), pad('empty', 7), pad('%', 7), pad('intv', 6), 'total s'].join(' ')
    for (const p of perMatch) {
      out += '\n' + [pad(p.id, 10), pad(p.mapName, 24), pad(String(p.alive), 7), pad(String(p.empty), 7), pad(p.pct.toFixed(1), 7), pad(String(p.intervals), 6), p.totalSec.toFixed(0)].join(' ')
    }
    out += `\nTOTAL empty frames ${perMatch.reduce((s, p) => s + p.empty, 0)} of ${perMatch.reduce((s, p) => s + p.alive, 0)} alive, ${allIntervals.length} intervals\n`

    const longest = [...allIntervals].sort((a, b) => b.lengthMs - a.lengthMs).slice(0, 15)
    out += '\n--- 15 longest empty-hand intervals (evidence decides the cause) ---\n'
    for (const iv of longest) {
      let doc = docs.get(iv.matchId)
      if (!doc) {
        const raw = await getJson<Parameters<typeof normalizeReplayDocument>[0]>(`${BASE}/api/matches/${iv.matchId}/replay`)
        doc = normalizeReplayDocument(raw)
        docs.set(iv.matchId, doc)
      }
      const { cause, evidence } = diagnose(doc, iv.slot, iv.start)
      out += `\n[${iv.matchId.slice(0, 8)}] slot ${iv.slot} frames ${iv.start}-${iv.end} (${(iv.lengthMs / 1000).toFixed(1)} s) -> ${cause}\n`
      out += `    ${JSON.stringify(evidence)}\n`
    }
    report(out)

    const byCause = new Map<string, { count: number; seconds: number }>()
    for (const iv of allIntervals) {
      const doc = docs.get(iv.matchId)!
      const { cause } = diagnose(doc, iv.slot, iv.start)
      const c = byCause.get(cause) ?? { count: 0, seconds: 0 }
      c.count++
      c.seconds += iv.lengthMs / 1000
      byCause.set(cause, c)
    }
    out = '\n--- cause breakdown (all intervals) ---\n'
    for (const [cause, c] of [...byCause.entries()].sort((a, b) => b[1].seconds - a[1].seconds)) {
      out += `${cause}: ${c.count} intervals, ${c.seconds.toFixed(0)} s\n`
    }
    report(out)

    expect(matches.length).toBeGreaterThan(0)
  }, 300000)
})
