// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * drawRecorder3d.ts — WHAT THE RENDER DREW, EVENT BY EVENT, during a video export.
 *
 * The export's render coverage (`export/renderCoverage.ts`) says, for every event of the match
 * ledger (`GET /api/matches/{id}/ledger`) in the clip's window, whether the renderer drew something
 * for it. That answer comes from the layers themselves: each one, when it adds an instance, starts
 * an effect or plays an animation for an event, marks the event's ledger id here (`mark`). Nothing
 * here knows what is supposed to be drawn.
 *
 * A NO-OP OUTSIDE EXPORTS. `on` is false except between `start` and `stop` (the export loop): every
 * call site checks it before building an id, so live playback pays one boolean read per event the
 * layers already walk. `adds` is the one exception, a plain counter the shape pools bump on every
 * instance (an integer increment): a layer compares it before and after drawing an event to know
 * whether the draw actually placed something, rather than assuming it did.
 *
 * Ids are the ledger's own (`serve_ledger.go`): where the event lives in the document
 * (`shot/12` = `doc.shots[12]`), or, for the context's kills and medals, who and when.
 */

/** One event's draws: every layer/what that drew it, and the first and last exported frame it did. */
export interface DrawMark {
  by: string[]
  first: number
  last: number
}

export class DrawRecorder {
  /** True only while an export records (`start` .. `stop`). */
  on = false
  /** Instances placed by the scene's pools since load (`InstancePool`, model pools, corpses, flashes). */
  adds = 0
  /** The film frame the export is rendering (set by the export loop before each frame). */
  frame = 0
  private marks = new Map<string, DrawMark>()

  start(): void {
    this.marks = new Map()
    this.on = true
  }

  /** stop ends the recording and hands over its marks. */
  stop(): Map<string, DrawMark> {
    const out = this.marks
    this.on = false
    this.marks = new Map()
    return out
  }

  /** mark records that `by` (`<layer>/<what>`) drew event `id` at the current frame. */
  mark(id: string, by: string): void {
    if (!this.on) return
    const f = this.frame
    const m = this.marks.get(id)
    if (!m) {
      this.marks.set(id, { by: [by], first: f, last: f })
      return
    }
    if (!m.by.includes(by)) m.by.push(by)
    if (f < m.first) m.first = f
    if (f > m.last) m.last = f
  }
}

/** The scene's one recorder (one export runs at a time). */
export const drawRecorder = new DrawRecorder()

/** The ledger ids of the events the layers draw (`serve_ledger.go` builds the same). */
export const ledgerId = {
  shot: (i: number) => `shot/${i}`,
  damage: (i: number) => `damage/${i}`,
  action: (i: number) => `action/${i}`,
  grenade: (i: number) => `grenade/${i}`,
  projectile: (i: number) => `projectile/${i}`,
  detonationOfProjectile: (i: number) => `detonation/projectile/${i}`,
  detonationOfGrenade: (i: number) => `detonation/grenade/${i}`,
  weaponChange: (i: number) => `weaponChange/${i}`,
  pickup: (i: number) => `pickup/${i}`,
  death: (slot: number) => `death/${slot}`,
  score: (team: number, value: number) => `score/${team}/${value}`,
  medal: (xuid: string, contextMs: number, name: string) => `medal/${xuid}/${contextMs}/${name}`,
}

/** A kill as the ledger names it: its killer, victim and rank among that pair's kills. */
interface KillLike {
  xuid: string
  victimXuid?: string
  replayMs: number
}

const killIdCache = new WeakMap<readonly KillLike[], Map<KillLike, string>>()

/**
 * killIdsOf: the ledger id of every kill of a page's kill list (`kill/<killer>/<victim>/<n>`, n
 * counting that pair's kills in time order over the whole match), computed once per list.
 */
export function killIdsOf(kills: readonly KillLike[]): Map<KillLike, string> {
  let ids = killIdCache.get(kills)
  if (ids) return ids
  ids = new Map()
  const rank = new Map<string, number>()
  for (const k of [...kills].sort((a, b) => a.replayMs - b.replayMs)) {
    const pair = `${k.xuid}/${k.victimXuid ?? ''}`
    const n = rank.get(pair) ?? 0
    rank.set(pair, n + 1)
    ids.set(k, `kill/${pair}/${n}`)
  }
  killIdCache.set(kills, ids)
  return ids
}

/** weaponFamilyOf: a weapon identifier's 8-digit family, lower case (`0x1A22FEE642C9679F` -> `1a22fee6`). */
export function weaponFamilyOf(id: string): string {
  return id.toLowerCase().replace(/^0x/, '').slice(0, 8)
}

/** A weapon taken by a life: when, which family, and its ledger id. */
interface WeaponTake {
  t: number
  family: string
  id: string
}

interface WeaponEventsDoc {
  weaponChanges: readonly { t: number; slot: number; kind: string; w?: string }[]
  pickups?: readonly { t: number; slot: number; kind: string; w: string }[]
}

const takesCache = new WeakMap<object, Map<number, WeaponTake[]>>()

/** weaponTakesOf: each slot's weapon takes (weapon changes other than drops, weapon pickups), once per document. */
function weaponTakesOf(doc: WeaponEventsDoc): Map<number, WeaponTake[]> {
  let out = takesCache.get(doc)
  if (out) return out
  out = new Map()
  const add = (slot: number, take: WeaponTake) => out!.set(slot, [...(out!.get(slot) ?? []), take])
  doc.weaponChanges.forEach((c, i) => {
    if (c.kind !== 'dropped' && c.w) add(c.slot, { t: c.t, family: weaponFamilyOf(c.w), id: ledgerId.weaponChange(i) })
  })
  doc.pickups?.forEach((p, i) => {
    if (p.kind === 'weapon' && p.w) add(p.slot, { t: p.t, family: weaponFamilyOf(p.w), id: ledgerId.pickup(i) })
  })
  takesCache.set(doc, out)
  return out
}

/**
 * markHeldWeapon: the scene drew weapon `weaponId` in the hand of the biped of `slot` at `frame`;
 * every take of that weapon by that life at or before the frame is drawn by it (a slot is one life).
 */
export function markHeldWeapon(doc: WeaponEventsDoc, slot: number, frame: number, weaponId: string, by: string): void {
  if (!drawRecorder.on) return
  const takes = weaponTakesOf(doc).get(slot)
  if (!takes) return
  const family = weaponFamilyOf(weaponId)
  for (const take of takes) if (take.t <= frame && take.family === family) drawRecorder.mark(take.id, by)
}
