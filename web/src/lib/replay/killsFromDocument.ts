/**
 * killsFromDocument.ts — kill markers built from the DOCUMENT ALONE, no Match View context.
 *
 * LevelUp's own replay page gets its kill feed from `GET .../replay/context` (highlight
 * events, resolved weapon icons, assists) and aligns it to the film with `killFeedLogic.ts`.
 * This standalone server does not serve that route (see `docs/PARITY.md` §3) — but the
 * document itself carries `killCauses` (schema: killer xuid, optional victim xuid, a cause
 * `class` of `'ARME' | 'GRENADE' | 'MELEE'`, and an optional `category` such as `'Headshot'`),
 * dated in `feedMs` on the MATCH axis — the same axis `doc.originMs` anchors (see
 * `matchClock.ts`). That is enough to build real kill markers without inventing anything:
 *
 *   replayMs = feedMs - originMs   (= `matchClock(doc, null).filmMsOfMatchMs(feedMs)`)
 *
 * WHAT THIS DELIBERATELY LEAVES EMPTY. LevelUp's `KillEvent.weaponKey` is resolved against
 * its own database vocabulary (distinct from the film's `class`/`category`, confirmed by
 * reading a captured document: `class` only ever takes the three cause values above, never a
 * weapon hex id — `weaponLabels`/`killEffects` are themselves absent from this artifact).
 * Mapping `class` to `weaponKey` would be a guess, not a reading — `weaponKey`/`weaponLabel`/
 * `weaponImageUrl` stay empty, which the lifted rendering code already treats as "unknown
 * source" (a neutral kill-fx family, no weapon icon), not as a crash or a wrong icon.
 *
 * Assist data (`assistState`, `assistGamertag`, …) is not in `killCauses` at all and stays at
 * its "unknown" default. `headshot` IS read, from `category`.
 */
import { matchClock } from './matchClock'
import type { ReplayDocumentReady } from './replayNormalize'
import type { MedalEvent, ReplayKill } from '../../features/match-replay/model/killFeedLogic'

const HEADSHOT_CATEGORIES = new Set(['Headshot', 'HeadshotMultiplier'])

/** gamertagOfXuid — the roster's own name for a xuid, '' when the roster does not carry it. */
function gamertagOfXuid(doc: ReplayDocumentReady, xuid: string): string {
  return doc.roster.find((r) => r.xuid === xuid)?.name ?? ''
}

/**
 * buildKillsFromDocument reads `doc.killCauses` into the same `ReplayKill` shape the lifted
 * 3D scene already consumes (kill markers, kill popups, medal badges — medals stay empty,
 * there is no medal source here). Empty without an established clock (`matchClock` returns
 * `null` without `originMs`/`frameIntervalMs`/at least two frames) — the same guard every
 * other clock-dependent surface of this document uses, never a zero-offset guess.
 */
export function buildKillsFromDocument(doc: ReplayDocumentReady): ReplayKill[] {
  const clock = matchClock(doc, null)
  if (!clock) return []
  const medals: MedalEvent[] = []
  const out: ReplayKill[] = doc.killCauses.map((kc) => ({
    tMs: kc.feedMs,
    replayMs: clock.filmMsOfMatchMs(kc.feedMs),
    xuid: kc.killer,
    teamID: null,
    weaponKey: '',
    weaponLabel: '',
    weaponImageUrl: '',
    weaponTinted: false,
    headshot: kc.category ? HEADSHOT_CATEGORIES.has(kc.category) : undefined,
    assistState: '' as const,
    assistGamertag: '',
    assistTeamID: null,
    killerDamagePct: null,
    assistDamagePct: null,
    victimXuid: kc.victim ?? '',
    victimGamertag: kc.victim ? gamertagOfXuid(doc, kc.victim) : '',
    medals,
  }))
  out.sort((a, b) => a.replayMs - b.replayMs)
  return out
}
