// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * renderCoverage.ts — DID THE CLIP DRAW EVERY EVENT OF ITS WINDOW? The export's render coverage,
 * written into `<name>.camera.json` under `coverage` (docs/design/camera-scripts.md).
 *
 * Two inputs, from two sides that do not know each other:
 *  - THE LEDGER (`GET /api/matches/{id}/ledger?fromMs=&toMs=`, `serve_ledger.go`): every event of
 *    the match in the clip's window, each with its id;
 *  - THE DRAW RECORDS (`scene3d/drawRecorder3d`): what the layers marked while the export's frames
 *    rendered, by the same ids.
 * The join says, per event, `drawn: true` and which layers drew it (`by`), or `drawn: false`. An
 * undrawn event is NAMED here, never dropped: that is the point (a clip whose picture tells the
 * wrong story because an event was silently missing).
 *
 * `by: 'hud-hidden'` on an undrawn kill, medal or score: the export painted no HUD (a clean frame,
 * or no followed player, which is every camera-script export), and the HUD is the only painter of
 * the kill feed and the score. Still `drawn: false`.
 *
 * A score tick's id is its team and value (`score/<team>/<value>`): the HUD paints a value, not a
 * tick. It counts as drawn only when the value was painted at or after the tick's frame.
 */
import { ApiError } from '../../../lib/api/standalone'
import { frameToMs } from '../../../lib/replay/replayLogic'
import type { DrawMark } from '../scene3d/drawRecorder3d'

/** The clip's window: the film frames it renders, first and last, and their document instants. */
export interface CoverageWindow {
  fromFrame: number
  toFrame: number
  fromMs: number
  toMs: number
}

/** What an export's layers drew, handed from the export loop to whoever writes the sidecar. */
export interface RenderDraws {
  window: CoverageWindow
  /** Whether the export painted its HUD (kill feed, score). */
  hud: boolean
  marks: Record<string, DrawMark>
}

/** renderDrawsOf: the draw records of an export over the film frames `frames` (the plan's). */
export function renderDrawsOf(
  marks: ReadonlyMap<string, DrawMark>,
  frames: readonly number[],
  doc: { frameIntervalMs?: number | null },
  hud: boolean,
): RenderDraws {
  let from = Infinity
  let to = -Infinity
  for (const f of frames) {
    if (f < from) from = f
    if (f > to) to = f
  }
  if (!Number.isFinite(from)) from = to = 0
  const fromFrame = Math.floor(from)
  const toFrame = Math.ceil(to)
  const d = doc as Parameters<typeof frameToMs>[1]
  return {
    window: { fromFrame, toFrame, fromMs: Math.round(frameToMs(fromFrame, d)), toMs: Math.round(frameToMs(toFrame, d)) },
    hud,
    marks: Object.fromEntries(marks),
  }
}

/** A player of the ledger. */
export interface LedgerPlayer {
  gamertag?: string
  xuid?: string
  team?: number
  slot?: number
}

/** One ledger event (`serve_ledger.go` `ledgerEvent`). */
export interface LedgerEvent {
  id: string
  kind: string
  frame: number
  ms: number
  actor?: LedgerPlayer
  target?: LedgerPlayer
  weapon?: string
  facts?: Record<string, unknown>
}

/** The ledger route's answer (the fields the coverage reads). */
export interface Ledger {
  events: LedgerEvent[]
  notes?: string[]
}

/** `GET /api/matches/{id}/ledger?fromMs=&toMs=` — the match's events in a window of doc ms. */
export async function fetchLedger(matchId: string, fromMs: number, toMs: number, signal?: AbortSignal): Promise<Ledger> {
  const q = `fromMs=${Math.floor(fromMs)}&toMs=${Math.ceil(toMs)}`
  const res = await fetch(`/api/matches/${encodeURIComponent(matchId)}/ledger?${q}`, { signal })
  if (!res.ok) {
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    throw new ApiError(`GET .../ledger: HTTP ${res.status}`, res.status, body)
  }
  return (await res.json()) as Ledger
}

/** One event of the clip's window, and what drew it. */
export interface CoverageEntry {
  id: string
  kind: string
  frame: number
  actor: string | null
  target: string | null
  drawn: boolean
  /** The layers that drew it (`layer/what`, joined with ' + '), 'hud-hidden', or null. */
  by: string | null
}

/** Per kind: how many events, how many drawn. */
export interface CoverageKindCount {
  events: number
  drawn: number
  undrawn: number
}

export interface CoverageSummary {
  events: number
  drawn: number
  undrawn: number
  /** The undrawn events by kind (kinds with none left out). */
  undrawnByKind: Record<string, number>
  byKind: Record<string, CoverageKindCount>
}

/** The sidecar's `coverage`: the window, every event, the summary; or why it could not be built. */
export interface RenderCoverage {
  window: CoverageWindow
  hud: boolean
  events: CoverageEntry[]
  summary: CoverageSummary
  /** The ledger's own notes (what it could not place). */
  notes?: string[]
}

/** The coverage when the ledger could not be read: the window, and the reason. */
export interface RenderCoverageFailed {
  window: CoverageWindow
  error: string
}

/** The kinds the HUD alone paints. */
const HUD_KINDS = new Set(['kill', 'medal', 'score'])

/** nameOf: a player as the coverage names them (gamertag, else xuid, else team). */
function nameOf(p: LedgerPlayer | undefined): string | null {
  if (!p) return null
  return p.gamertag || p.xuid || (p.team !== undefined ? `team ${p.team}` : null)
}

/** buildCoverage: the ledger's events in the window joined to the draw records. */
export function buildCoverage(ledger: Ledger, draws: RenderDraws): RenderCoverage {
  const { window } = draws
  const events: CoverageEntry[] = []
  const byKind: Record<string, CoverageKindCount> = {}
  const undrawnByKind: Record<string, number> = {}
  let drawnCount = 0
  for (const e of ledger.events) {
    if (e.ms < window.fromMs || e.ms > window.toMs) continue
    const mark = draws.marks[e.id]
    const drawn = !!mark && (e.kind !== 'score' || mark.last >= e.frame)
    const by = drawn ? mark.by.join(' + ') : !draws.hud && HUD_KINDS.has(e.kind) ? 'hud-hidden' : null
    events.push({ id: e.id, kind: e.kind, frame: e.frame, actor: nameOf(e.actor), target: nameOf(e.target), drawn, by })
    const k = (byKind[e.kind] ??= { events: 0, drawn: 0, undrawn: 0 })
    k.events++
    if (drawn) {
      k.drawn++
      drawnCount++
    } else {
      k.undrawn++
      undrawnByKind[e.kind] = (undrawnByKind[e.kind] ?? 0) + 1
    }
  }
  const out: RenderCoverage = {
    window,
    hud: draws.hud,
    events,
    summary: { events: events.length, drawn: drawnCount, undrawn: events.length - drawnCount, undrawnByKind, byKind },
  }
  if (ledger.notes?.length) out.notes = ledger.notes
  return out
}

/** coverageWarning: the console line for a coverage with undrawn events (HUD-hidden ones aside), null otherwise. */
export function coverageWarning(c: RenderCoverage | RenderCoverageFailed | null): string | null {
  if (!c) return null
  if ('error' in c) return `[replay-export] render coverage unavailable: ${c.error}`
  const missing = Object.entries(c.summary.undrawnByKind)
  if (missing.length === 0) return null
  return `[replay-export] ${c.summary.undrawn} of ${c.summary.events} events in frames ${c.window.fromFrame}-${c.window.toFrame} were not drawn: ${missing.map(([k, n]) => `${k} ${n}`).join(', ')}`
}
