// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/// <reference types="node" />
/**
 * testDoc.ts — THE replay document fixture, shared by every test in the feature.
 *
 * THE TEST DOCUMENT COMES IN THROUGH THE SAME DOOR AS THE SERVER'S: we describe a
 * transport document (optional fields omitted) and the `normalizeReplayDocument`
 * boundary fills it in. A test that built the normalized shape directly would be
 * testing a document the server never actually sends.
 *
 * ITS SCHEMA VERSION COMES FROM THE PRODUCER, not a literal (2026-09-13, batch 0.B). It
 * used to be pinned at version 1 — a number the server never served, under a comment
 * that stated the opposite principle. It's now read from the manifest that Go writes
 * (`fixtures/go/manifest.json`, see `goFixtures.ts`): the day the decoding bumps its
 * version, this fixture follows without anyone having to remember.
 *
 * WHAT IT IS NOT, AND WHY IT STAYS MINIMAL. It's not the COMPLETE document produced by
 * Go: that one lives in `fixtures/go/`, weighs 3.3 MiB and serves the contract test
 * (`test/goFixtures.contract.test.ts`), which runs it through the boundary and the pure
 * logic. Here, what we want is a MINIMAL document that each test overrides with what it
 * observes — a complete document would make 250 tests depend on values they don't
 * describe. The two are complementary: one proves the boundary holds on the REAL
 * document, the other isolates what a given test wants to show.
 *
 * "≤ 2 copies" rule (CLAUDE.md #6): this helper was born when a 3rd copy of this
 * fixture was about to appear. The `testDoc.guard.test.ts` guardrail forbids rebuilding
 * one by hand in the feature's tests, and forbids hardcoding a schema number there.
 */
import type { ReplayDocument } from '@/lib/api/types'

import { normalizeReplayDocument, type ReplayDocumentReady } from '../../../lib/replay/replayNormalize'

/**
 * Standalone port note: LevelUp reads this from the Go-written fixture manifest
 * (`test/fixtures/go/manifest.json`, via `goFixtures.ts`) so the fixture schema version
 * tracks the real decoder without anyone remembering to bump it. That fixture directory
 * (3.3 MiB, Go-only contract test) was not ported — this viewer's own tests never need a
 * schema bump to track the decoder, so the current schema version is a literal here.
 */
const SCHEMA_VERSION = 116

type RosterEntry = NonNullable<ReplayDocument['roster']>[number]

/**
 * Test roster entry: `seat` is OPTIONAL here and defaults to the film index — that's
 * been its definition since schema 60 (batch 1.9.14: a player's seat IS the index the
 * film writes; the document never omits it). Tests that want a mismatched seat
 * (different from the index) set it explicitly.
 */
export type TestRosterEntry = Omit<RosterEntry, 'seat'> & { seat?: number }

/** Overrides accepted by [testReplayDoc]: the document, with a test roster. */
export type TestReplayDocOverrides = Omit<Partial<ReplayDocument>, 'roster'> & {
  roster?: TestRosterEntry[]
}

/** Minimal valid, normalized replay document — override what the test wants to see. */
export function testReplayDoc(over: Partial<ReplayDocument> | TestReplayDocOverrides = {}): ReplayDocumentReady {
  const { roster, ...rest } = over as TestReplayDocOverrides
  return normalizeReplayDocument({
    schemaVersion: SCHEMA_VERSION,
    matchId: 'm',
    titleSlug: 'halo_infinite',
    frameCount: 200,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    tracks: [],
    ...rest,
    ...(roster ? { roster: roster.map((r) => ({ ...r, seat: r.seat ?? r.filmIndex })) } : {}),
  })
}
