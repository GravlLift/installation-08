// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** cameraScriptModel.test.ts — the pure model of the camera panel (unit 4a). */
import { expect, it } from 'vitest'

import {
  addHold,
  captureKey,
  faceCameraHeading,
  gameFovOfVertical,
  insertKey,
  isDirty,
  isFrozenAt,
  keySummary,
  newCameraScript,
  newHold,
  removeHold,
  removeKey,
  replaceKey,
  scriptTimeNow,
  setFreezeAt,
  updateHold,
  updateKey,
  type KeyOpResult,
} from './cameraScriptModel'
import { scriptClockOf, type CameraKey, type CameraScript, type PlayerPoint, type ScriptPoint, type ScriptVec3 } from '../scene3d/cameraScript3d'
import { verticalFovOf } from '../model/fovLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'

const doc = (frameIntervalMs: number): ReplayDocumentReady => ({ frameIntervalMs } as ReplayDocumentReady)
const world = (point: ScriptVec3): ScriptPoint => ({ at: 'world', point })
const subj = (x: number, y: number, z: number, h: number) => ({ x, y, z, h })
const cap = (position: ScriptVec3, target: ScriptVec3, verticalFov = 23.4) => ({ position, target, verticalFov })

function base(): CameraScript {
  return {
    version: 1,
    matchId: 'm',
    name: 's',
    keys: [
      { t: 0, pos: world([0, 0, 0]), look: world([1, 0, 0]) },
      { t: 100, pos: world([0, 0, 0]), look: world([1, 0, 0]) },
      { t: 200, pos: world([0, 0, 0]), look: world([1, 0, 0]) },
    ],
  }
}

function tOf(r: KeyOpResult): number[] {
  expect(r).toMatchObject({ ok: true })
  return (r as { ok: true; script: CameraScript }).script.keys.map((k) => k.t)
}

it('newCameraScript builds an empty version-1 script with no clock', () => {
  expect(newCameraScript('m', 'intro')).toEqual({ version: 1, matchId: 'm', name: 'intro', keys: [] })
  expect(newCameraScript('m', 'intro').clock).toBeUndefined()
})

it('scriptTimeNow follows the film without a clock and the cursor with one', () => {
  const noClock: CameraScript = base()
  const withClock: CameraScript = { ...base(), clock: { startMs: 0, rates: [{ s: 0, rate: 1, ease: 'smooth' }] } }
  // frame 10 at a 100 ms interval is 1000 ms of film.
  expect(scriptTimeNow({ script: noClock, frame: 10, doc: doc(100), cursorMs: 999999 })).toBe(1000)
  // With a clock the panel acts at its own cursor, not the film frame.
  expect(scriptTimeNow({ script: withClock, frame: 10, doc: doc(100), cursorMs: 4242 })).toBe(4242)
})

it('gameFovOfVertical round-trips verticalFovOf at the common fields', () => {
  for (const g of [40, 70, 100, 120]) {
    expect(gameFovOfVertical(verticalFovOf(g))).toBe(g)
  }
})

it('captureKey: a world position and an orbit look take the captured points', () => {
  const c = cap([1, 2, 3], [4, 5, 6])
  const { key, fellBack } = captureKey({
    t: 500,
    capture: c,
    pos: { kind: 'world' },
    look: { kind: 'orbit' },
    subject: () => null,
    fov: 'base',
  })
  expect(fellBack).toBe(false)
  expect(key).toEqual({
    t: 500,
    pos: { at: 'world', point: [1, 2, 3] },
    look: { at: 'world', point: [4, 5, 6] },
    ease: 'smooth',
  })
  expect(key.fov).toBeUndefined()
})

it('captureKey: a world-aligned player position is the position minus the feet', () => {
  const { key, fellBack } = captureKey({
    t: 0,
    capture: cap([13, -5, 2], [4, 5, 6]),
    pos: { kind: 'player', xuid: 'p', relative: 'world' },
    look: { kind: 'orbit' },
    subject: () => subj(10, -5, 0, 0),
    fov: 'base',
  })
  expect(fellBack).toBe(false)
  expect(key.pos).toEqual({ at: 'player', xuid: 'p', offset: [3, 0, 2], relative: 'world' })
})

it('captureKey: a heading-relative position turns back to the captured position', () => {
  const position: ScriptVec3 = [13, -5, 2]
  for (const h of [0, 90, 225]) {
    const feet = subj(10, -5, 0, h)
    const { key, fellBack } = captureKey({
      t: 0,
      capture: cap(position, [4, 5, 6]),
      pos: { kind: 'player', xuid: 'p', relative: 'heading' },
      look: { kind: 'orbit' },
      subject: () => feet,
      fov: 'base',
    })
    expect(fellBack).toBe(false)
    const pp = key.pos as PlayerPoint
    expect(pp.relative).toBe('heading')
    const [ox, oy, oz] = pp.offset as ScriptVec3
    // Inverse: rotate the offset back by the heading and add the feet.
    const rad = (h * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    expect(feet.x + ox * cos - oy * sin).toBeCloseTo(position[0], 5)
    expect(feet.y + ox * sin + oy * cos).toBeCloseTo(position[1], 5)
    expect(feet.z + oz).toBeCloseTo(position[2], 5)
  }
})

it('captureKey: a look at a player is the captured target minus the feet', () => {
  const { key, fellBack } = captureKey({
    t: 0,
    capture: cap([1, 2, 3], [4, 5, 6]),
    pos: { kind: 'world' },
    look: { kind: 'player', xuid: 'p' },
    subject: () => subj(10, -5, 0, 0),
    fov: 'base',
  })
  expect(fellBack).toBe(false)
  expect(key.look).toEqual({ at: 'player', xuid: 'p', offset: [-6, 10, 6] })
})

it('captureKey: a missing subject falls back to the captured world points and says so', () => {
  const c = cap([1, 2, 3], [4, 5, 6])
  const { key, fellBack } = captureKey({
    t: 0,
    capture: c,
    pos: { kind: 'player', xuid: 'gone', relative: 'world' },
    look: { kind: 'player', xuid: 'gone' },
    subject: () => null,
    fov: 'base',
  })
  expect(fellBack).toBe(true)
  expect(key.pos).toEqual({ at: 'world', point: [1, 2, 3] })
  expect(key.look).toEqual({ at: 'world', point: [4, 5, 6] })
})

it('captureKey: the capture field carries the converted fov; base omits it', () => {
  const c = cap([1, 2, 3], [4, 5, 6], 23.4)
  const captured = captureKey({
    t: 0,
    capture: c,
    pos: { kind: 'world' },
    look: { kind: 'orbit' },
    subject: () => null,
    fov: 'capture',
  })
  expect(captured.key.fov).toBe(gameFovOfVertical(23.4))
})

it('insertKey keeps keys sorted (stable) and replaces a same-t non-cut key', () => {
  const s = base()
  expect(tOf(insertKey(s, { t: 150, pos: world([1, 1, 1]), look: world([2, 2, 2]) }))).toEqual([0, 100, 150, 200])
  expect(tOf(insertKey(s, { t: 50, pos: world([0, 0, 0]), look: world([0, 0, 0]) }))).toEqual([0, 50, 100, 200])
  expect(tOf(insertKey(s, { t: 300, pos: world([0, 0, 0]), look: world([0, 0, 0]) }))).toEqual([0, 100, 200, 300])

  // Same t as an existing non-cut key (t = 100) replaces it; the length is unchanged.
  const r = insertKey(s, { t: 100, pos: world([9, 9, 9]), look: world([9, 9, 9]) })
  expect(r).toMatchObject({ ok: true })
  const rs = (r as { ok: true; script: CameraScript }).script
  expect(rs.keys.length).toBe(3)
  expect(rs.keys[1].pos).toEqual({ at: 'world', point: [9, 9, 9] })
  expect(s.keys.length).toBe(3) // the input is left unchanged
})

it('insertKey rejects a non-cut after a cut at the same t and accepts a cut', () => {
  const s: CameraScript = {
    version: 1,
    matchId: 'm',
    name: 's',
    keys: [{ t: 50, pos: world([0, 0, 0]), look: world([1, 0, 0]), ease: 'cut' }],
  }
  expect(insertKey(s, { t: 50, pos: world([0, 0, 0]), look: world([1, 0, 0]) })).toMatchObject({ ok: false })
  const r = insertKey(s, { t: 50, pos: world([0, 0, 0]), look: world([1, 0, 0]), ease: 'cut' })
  expect(r).toMatchObject({ ok: true })
  expect((r as { ok: true; script: CameraScript }).script.keys.length).toBe(2)
})

it('replaceKey swaps the key in place', () => {
  const s = base()
  const r = replaceKey(s, 1, { t: 100, pos: world([7, 7, 7]), look: world([7, 7, 7]) })
  expect(r).toMatchObject({ ok: true })
  expect((r as { ok: true; script: CameraScript }).script.keys[1].pos).toEqual({ at: 'world', point: [7, 7, 7] })
  expect(tOf(r)).toEqual([0, 100, 200])
  expect(replaceKey(s, 3, { t: 100, pos: world([0, 0, 0]), look: world([0, 0, 0]) })).toMatchObject({ ok: false })
})

it('removeKey drops the key and leaves the input unchanged', () => {
  const s = base()
  const r = removeKey(s, 1)
  expect(r).toMatchObject({ ok: true })
  expect(tOf(r)).toEqual([0, 200])
  expect(s.keys.length).toBe(3)
})

it('updateKey re-sorts after a t change and reports the new index', () => {
  const r = updateKey(base(), 0, { t: 150 })
  expect(r).toMatchObject({ ok: true })
  expect((r as { ok: true; script: CameraScript; index: number }).index).toBe(1)
  expect(tOf(r)).toEqual([100, 150, 200])
})

it('updateKey edits ease/fov/roll without moving the key', () => {
  const r = updateKey(base(), 1, { fov: 80, roll: 5, ease: 'linear' })
  expect(r).toMatchObject({ ok: true })
  expect((r as { ok: true; script: CameraScript; index: number }).index).toBe(1)
  expect((r as { ok: true; script: CameraScript }).script.keys[1]).toMatchObject({ t: 100, fov: 80, roll: 5, ease: 'linear' })
})

it('updateKey: an out-of-range fov is rejected and leaves the input unchanged', () => {
  const s = base()
  const r = updateKey(s, 0, { fov: 200 })
  expect(r).toMatchObject({ ok: false })
  expect((r as { ok: false; error: string }).error).toMatch(/fov/)
  expect(s.keys[0].fov).toBeUndefined()
  expect(s.keys.length).toBe(3)
})

it('isDirty is false for the same script and field-order differences, true for real ones', () => {
  const s = base()
  expect(isDirty(null, s)).toBe(true)
  expect(isDirty(s, s)).toBe(false)
  // Field order within a key differs, the content does not.
  const reordered: CameraScript = {
    version: 1,
    matchId: 'm',
    name: 's',
    keys: [
      { pos: world([0, 0, 0]), look: world([1, 0, 0]), t: 0 },
      { pos: world([0, 0, 0]), look: world([1, 0, 0]), t: 100 },
      { pos: world([0, 0, 0]), look: world([1, 0, 0]), t: 200 },
    ],
  }
  expect(isDirty(s, reordered)).toBe(false)
  const diff: CameraScript = {
    ...s,
    keys: [...s.keys.slice(0, 1), { ...s.keys[1], pos: world([9, 9, 9]) }, ...s.keys.slice(2)],
  }
  expect(isDirty(s, diff)).toBe(true)
})

it('keySummary labels world and player keys', () => {
  const nameOf = (xuid: string): string => (xuid === 'A' ? 'Spartan117' : 'Other')
  const worldKey: CameraKey = { t: 0, pos: world([0, 0, 0]), look: world([1, 0, 0]) }
  expect(keySummary(worldKey, nameOf)).toBe('World → orbit point')
  const heading: CameraKey = {
    t: 0,
    pos: { at: 'player', xuid: 'A', relative: 'heading' },
    look: { at: 'player', xuid: 'A' },
  }
  expect(keySummary(heading, nameOf)).toBe('Follow Spartan117 (heading) → look at Spartan117')
  const aligned: CameraKey = {
    t: 0,
    pos: { at: 'player', xuid: 'A', relative: 'world' },
    look: { at: 'player', xuid: 'A' },
  }
  expect(keySummary(aligned, nameOf)).toBe('Follow Spartan117 → look at Spartan117')
})

it('newHold carries the documented defaults', () => {
  expect(newHold('p', 315200, 'mp:intro_emote:i_see_you')).toEqual({
    xuid: 'p',
    at: 315200,
    clip: 'mp:intro_emote:i_see_you',
    loop: false,
    blendMs: 250,
    heading: null,
    turnMs: 400,
    pitch: 0,
    weapon: 'keep',
    until: null,
  })
})

it('addHold keeps the holds sorted by at (stable) and revalidates', () => {
  const s = { ...base(), holds: [newHold('a', 200, 'c1'), newHold('b', 400, 'c2')] }
  const r = addHold(s, newHold('c', 300, 'c3'))
  expect(r).toMatchObject({ ok: true })
  const rs = (r as { ok: true; script: CameraScript }).script
  expect(rs.holds?.map((h) => [h.xuid, h.at])).toEqual([
    ['a', 200],
    ['c', 300],
    ['b', 400],
  ])
  // A hold sharing its time goes after the existing one (stable).
  const r2 = addHold(s, newHold('d', 200, 'c4'))
  expect(r2).toMatchObject({ ok: true })
  expect((r2 as { ok: true; script: CameraScript }).script.holds?.map((h) => h.xuid)).toEqual(['a', 'd', 'b'])
  expect(s.holds?.length).toBe(2) // the input is left unchanged
})

it('updateHold re-sorts after an at change and reports the new index; a same-player xuid is rejected', () => {
  const s = { ...base(), holds: [newHold('a', 200, 'c1'), newHold('b', 400, 'c2')] }
  const r = updateHold(s, 1, { at: 100 })
  expect(r).toMatchObject({ ok: true })
  expect((r as { ok: true; script: CameraScript; index: number }).index).toBe(0)
  expect((r as { ok: true; script: CameraScript }).script.holds?.map((h) => h.xuid)).toEqual(['b', 'a'])

  const r2 = updateHold(s, 0, { xuid: 'b' })
  expect(r2).toMatchObject({ ok: false })
  expect((r2 as { ok: false; error: string }).error).toMatch(/one hold per player/)
  expect(s.holds?.map((h) => h.xuid)).toEqual(['a', 'b'])

  expect(updateHold(s, 2, { clip: 'x' })).toMatchObject({ ok: false })
})

it('removeHold drops the hold and leaves the input unchanged', () => {
  const s = { ...base(), holds: [newHold('a', 200, 'c1'), newHold('b', 400, 'c2')] }
  const r = removeHold(s, 0)
  expect(r).toMatchObject({ ok: true })
  expect((r as { ok: true; script: CameraScript }).script.holds?.map((h) => h.xuid)).toEqual(['b'])
  expect(s.holds?.length).toBe(2)
})

it('faceCameraHeading faces the player from the camera east, north, west and south', () => {
  const feet = { x: 10, y: 5 }
  expect(faceCameraHeading([20, 5, 9], feet)).toBe(0) // east
  expect(faceCameraHeading([10, 15, 0], feet)).toBe(90) // north
  expect(faceCameraHeading([0, 5, 0], feet)).toBe(180) // west
  expect(faceCameraHeading([10, -5, 0], feet)).toBe(270) // south
})

it('setFreezeAt on a clock-less script creates the clock with the freeze entry; unfreezing returns it to no clock', () => {
  const s = base()
  expect(isFrozenAt(s, 300)).toBe(false)

  const r = setFreezeAt(s, 300, true)
  expect(r).toMatchObject({ ok: true })
  const clocked = (r as { ok: true; script: CameraScript }).script
  expect(clocked.clock).toEqual({
    startMs: 0,
    rates: [{ s: 0, rate: 1, ease: 'smooth' }, { s: 300, rate: 0, ease: 'cut' }],
  })
  expect(isFrozenAt(clocked, 300)).toBe(true)
  // The created clock keeps script time as document time up to the freeze, then stops.
  const view = scriptClockOf(clocked)
  expect(view.docMsAt(300)).toBe(300)
  expect(view.rateAt(300)).toBe(0)
  expect(view.rateAt(4000)).toBe(0)

  const r2 = setFreezeAt(clocked, 300, false)
  expect(r2).toMatchObject({ ok: true })
  const back = (r2 as { ok: true; script: CameraScript }).script
  expect(back.clock).toBeUndefined()
  expect(isFrozenAt(back, 300)).toBe(false)
})

it('freezing twice is idempotent and freezing a clocked script inserts the entry sorted', () => {
  const r1 = setFreezeAt(base(), 300, true)
  const r2 = setFreezeAt((r1 as { ok: true; script: CameraScript }).script, 300, true)
  expect(r2).toMatchObject({ ok: true })
  expect((r2 as { ok: true; script: CameraScript }).script).toBe(
    (r1 as { ok: true; script: CameraScript }).script,
  )

  const clocked: CameraScript = {
    ...base(),
    clock: { startMs: 0, rates: [{ s: 0, rate: 1, ease: 'smooth' }, { s: 500, rate: 2, ease: 'smooth' }] },
  }
  const r3 = setFreezeAt(clocked, 400, true)
  expect(r3).toMatchObject({ ok: true })
  expect((r3 as { ok: true; script: CameraScript }).script.clock?.rates).toEqual([
    { s: 0, rate: 1, ease: 'smooth' },
    { s: 400, rate: 0, ease: 'cut' },
    { s: 500, rate: 2, ease: 'smooth' },
  ])
  // Unfreezing a clock that is not identical to no clock keeps the rest of the clock.
  const r4 = setFreezeAt((r3 as { ok: true; script: CameraScript }).script, 400, false)
  expect(r4).toMatchObject({ ok: true })
  expect((r4 as { ok: true; script: CameraScript }).script.clock?.rates).toEqual([
    { s: 0, rate: 1, ease: 'smooth' },
    { s: 500, rate: 2, ease: 'smooth' },
  ])
})

it('isFrozenAt is true only for a rate-0 entry exactly at the time', () => {
  const s: CameraScript = {
    ...base(),
    clock: { startMs: 0, rates: [{ s: 0, rate: 1, ease: 'smooth' }, { s: 300, rate: 0, ease: 'cut' }] },
  }
  expect(isFrozenAt(s, 300)).toBe(true)
  expect(isFrozenAt(s, 0)).toBe(false) // s = 0 has rate 1
  expect(isFrozenAt(s, 301)).toBe(false)
})
