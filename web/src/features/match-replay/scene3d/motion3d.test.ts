// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { msToFrames } from '@/lib/replay/replayLogic'

import type { ReplayKill } from '../model/killFeedLogic'
import { fakeClip, motionCatalog } from '../test/spartanClips'
import { testReplayDoc } from '../test/testDoc'
import type { Action3dInputs } from './action3dInputs'
import type { ActionContext } from './actionScene3d'
import { sautDepuisAction } from './filmActions3d'
import { registerSpartanClips, SpartanClips, type SpartanClip } from './clips3d'
import { newClipMix, type ClipMix } from './clipSample3d'
import { mixStride, phaseTime } from './clipSelect3d'
import { heldWeaponAt } from './heldWeapon3d'
import { Motion3d } from './motion3d'
import { postureFilm } from './posturesFilm3d'
import { buildTracks3d } from './tracks3d'

const FPS = 10
/** Le joueur A (emplacement 1) court vers +X à 2 u/s (0,2 u par image), face au déplacement. */
const doc = testReplayDoc({
  frameIntervalMs: 1000 / FPS,
  tracks: [{
    slot: 1, team: 0, xuid: 'A', startFrame: 0, endFrame: 100,
    points: Array.from({ length: 101 }, (_, t) => ({ t, x: 0.2 * t, y: 0, z: 0, h: 0 })),
  }],
  stances: [{ kind: 'jumpDerived', slot: 1, t0: 40, t1: 45 }],
  grenades: [{ slot: 1, rank: 0, t: 60, i: 0, s: 'x', x: 0, y: 0 }],
  loadouts: [{ t: 0, slot: 1, w: ['0xAAAA', '0xBBBB'] }],
  inventory: [{ t: 0, slot: 1, d: 0 }, { t: 80, slot: 1, d: 1 }],
  weaponLabels: {
    '0xAAAA': { en: 'BR75', fr: 'BR75', tint: 'kinetic', key: 'hinf_br75' },
    '0xBBBB': { en: 'Sidekick', fr: 'Sidekick', tint: 'kinetic', key: 'hinf_sidekick' },
  },
})
const MELEE_SPRITE = '/assets/killfeed/killfeed-65.png?v=2'
const kill = { tMs: 0, replayMs: 2500, xuid: 'A', victimXuid: 'V', teamID: 0, weaponLabel: '', weaponKey: '', weaponImageUrl: MELEE_SPRITE, medals: [] } as unknown as ReplayKill
const CATALOG = motionCatalog()

function motion(loaded = true, film = doc, catalogue = CATALOG): Motion3d {
  const source = new THREE.Group()
  registerSpartanClips(source, catalogue)
  const inputs = { framesPerSecond: FPS, kills: [kill], locale: 'en' } as unknown as Action3dInputs
  const ctx = {
    doc: film,
    tracks: buildTracks3d(film),
    inputs: () => inputs,
    spartanModel: () => (loaded ? source : null),
    dressOf: () => null,
  } as unknown as ActionContext
  return new Motion3d(ctx, (slot, frame) => heldWeaponAt(film, slot, frame, 'en'))
}

const base = (m: ClipMix) => m.base.slice(0, m.baseCount).map((l) => ({ name: l.clip?.name ?? '', time: l.time, weight: l.weight }))
const over = (m: ClipMix) => m.over.slice(0, m.overCount).map((l) => ({ name: l.clip?.name ?? '', time: l.time, weight: l.weight }))
const names = (layers: { name: string }[]) => layers.map((l) => l.name)

describe('Motion3d', () => {
  it('date les accroupissements et glissades aux millisecondes, avec repli sur les images', () => {
    const film = testReplayDoc({ ...doc, stances: [
      { kind: 'crouch', slot: 1, t0: 10, t1: 10, ms0: 1020, ms1: 1080 },
      { kind: 'crouch', slot: 1, t0: 20, t1: 21 },
      { kind: 'slide', slot: 1, t0: 30, t1: 31, ms0: 3020, ms1: 3180 },
    ] })
    const pistes = buildTracks3d(film)
    for (const [f, attendu] of [[9.7, false], [10.2, true], [10.5, true], [10.8, false], [11.3, false], [20, true], [21, true], [21.1, false]] as const) {
      expect(pistes.sample('A', f)?.crouch).toBe(attendu)
    }
    expect(postureFilm(film.stances[2], film)).toMatchObject({ t0: 30.2, t1: 30.8, fin: 31.8 })
    // Pendant la glissade, l'œil descend en fondu tandis que la pose du corps reste debout.
    const glissade = pistes.sample('A', 30.7)
    expect(glissade?.crouch).toBe(false)
    expect(glissade?.dropOeil).toBeGreaterThan(0)
    const m = motion(true, film)
    const poids = (f: number, suffixe: string) => base(m.at('A', f, false, newClipMix()) as ClipMix)
      .filter((l) => l.name.includes(suffixe)).reduce((s, l) => s + l.weight, 0)
    expect(poids(10.7, 'crouch:')).toBeGreaterThan(0.3)
    expect(poids(30.7, ':slide')).toBeGreaterThan(0.4)
  })
  it('rien tant que le Spartan animé n’est pas chargé, ni hors vie', () => {
    expect(motion(false).at('A', 20, false, newClipMix())).toBeNull()
    expect(motion().at('A', 150, false, newClipMix())).toBeNull()
    expect(motion().at('B', 20, false, newClipMix())).toBeNull()
  })

  it('court vers l’avant du fusil ; le temps du clip avance de la distance parcourue sur la foulée', () => {
    const m = motion()
    const run = CATALOG.get('combat:rifle:locomote_run_front') as SpartanClip
    const at = (f: number) => m.at('A', f, false, newClipMix()) as ClipMix
    // Entre les images 15 et 35 : vitesse établie, avant le saut (40).
    const a = at(15)
    expect(names(base(a))).toContain('combat:rifle:locomote_run_front')
    const stride = mixStride(a)
    const t15 = base(a).find((l) => l.name === run.name)?.time as number
    const t35 = base(at(35)).find((l) => l.name === run.name)?.time as number
    // 20 images à 0,2 u : 4 u, soit 4 / foulée cycles de plus.
    const expected = phaseTime(run, t15 / run.cycle - run.sync + 4 / stride)
    expect(t35).toBeCloseTo(expected, 6)
  })

  it('pur : une image rendue après d’autres, en avant comme en arrière, rend le même mélange', () => {
    const m = motion()
    const first = m.at('A', 37.5, false, newClipMix()) as ClipMix
    const snap = (x: ClipMix) => JSON.stringify([base(x), over(x)])
    const want = snap(first)
    m.at('A', 90, false, newClipMix())
    m.at('A', 5, false, newClipMix())
    expect(snap(m.at('A', 37.5, false, newClipMix()) as ClipMix)).toBe(want)
    expect(snap(motion().at('A', 37.5, false, newClipMix()) as ClipMix)).toBe(want)
  })

  it('lit les postures, les grenades et les coups de mêlée mortels du joueur', () => {
    const m = motion()
    expect(names(base(m.at('A', 42, false, newClipMix()) as ClipMix))).toContain('combat:rifle:airborne_arc')
    expect(names(over(m.at('A', 60, false, newClipMix()) as ClipMix))).toContain('combat:rifle:throw_grenade')
    const hit = Math.round(msToFrames(kill.replayMs, doc))
    expect(names(over(m.at('A', hit, false, newClipMix()) as ClipMix))).toContain('combat:rifle:melee_strike_1')
    expect(names(over(m.at('A', hit - 20, false, newClipMix()) as ClipMix))).not.toContain('combat:rifle:melee_strike_1')
  })

  it('un changement d’arme range l’ancienne puis sort la nouvelle, dont la classe prend la suite', () => {
    const m = motion()
    expect(names(over(m.at('A', 79.5, false, newClipMix()) as ClipMix))).toContain('combat:rifle:put_away')
    const after = m.at('A', 80.5, false, newClipMix()) as ClipMix
    expect(names(over(after))).toContain('combat:pistol:ready')
    expect(names(base(after)).some((n) => n.startsWith('combat:pistol:'))).toBe(true)
  })

  it('à bord d’un véhicule : l’attente seule', () => {
    const a = motion().at('A', 30, true, newClipMix()) as ClipMix
    expect(base(a).map((l) => [l.name, l.weight])).toEqual([['combat:rifle:idle', 1]])
  })
  it('déduit le saut de la montée puis du retour au sol et garde le repli publié', () => {
    const film = testReplayDoc({
      frameIntervalMs: 100, originMs: 12000,
      tracks: [{ slot: 1, team: 0, xuid: 'A', startFrame: 0, endFrame: 100,
        points: Array.from({ length: 101 }, (_, t) => ({ t, x: 0, y: 0, z: t === 12 ? 0.4 : t === 13 ? 0.2 : 0, h: 0 })) }],
      stances: [{ kind: 'jumpDerived', slot: 1, t0: 40, t1: 45 }],
      actions: [{ kind: 'jump', slot: 1, t: 10, ms: 1050 }, { kind: 'jump', slot: 1, t: 41, ms: 4100 }],
    })
    const m = motion(true, film)
    const at = (f: number) => base(m.at('A', f, false, newClipMix()) as ClipMix)
    expect(m.postures(1).jump).toEqual([sautDepuisAction(film, buildTracks3d(film), 1, 10.5), postureFilm(film.stances[0], film)])
    expect(names(at(12))).toContain('combat:rifle:airborne_arc')
    expect(names(at(16))).not.toContain('combat:rifle:airborne_arc')
    expect(at(42).find((l) => l.name === 'combat:rifle:airborne_arc')?.time).toBeCloseTo(0.2)
    expect(names(at(48))).not.toContain('combat:rifle:airborne_arc')
    expect(sautDepuisAction(film, buildTracks3d(film), 1, 30.25)).toEqual({ t0: 30.25, t1: 44.25 })
  })

  it('recharge à la milliseconde par arme et annule au changement', () => {
    const film = testReplayDoc({ ...doc,
      actions: [{ kind: 'reload', slot: 1, t: 70, ms: 7025 }, { kind: 'reload', slot: 2, t: 71, ms: 7100 }],
      loadouts: [{ t: 0, slot: 1, w: ['0x2b1824d5', '0xf408190f'] }],
      weaponLabels: { '0x2b1824d5': { en: 'BR75', fr: 'BR75', tint: 'kinetic', key: 'hinf_br75' },
        '0xf408190f': { en: 'Sidekick', fr: 'Sidekick', tint: 'kinetic', key: 'hinf_sidekick' } },
    })
    const extra = [fakeClip('combat:rifle:br:reload_1', 90), fakeClip('combat:pistol:strk:reload_1', 90)]
    const catalogue = new SpartanClips([...CATALOG.names().map((n) => CATALOG.get(n) as SpartanClip), ...extra], {
      weapons: [{ weapon: '2b1824d5', class: 'rifle', reload: extra[0].name },
        { weapon: 'f408190f', class: 'pistol', reload: extra[1].name }, { weapon: 'c3542946', class: 'pistol' }],
      classes: [{ class: 'rifle', reload: 'combat:rifle:reload_1' }],
    })
    const m = motion(true, film, catalogue)
    const at = (f: number) => over(m.at('A', f, false, newClipMix()) as ClipMix)
    expect(at(70.75).find((l) => l.name === extra[0].name)?.time).toBeCloseTo(0.05)
    expect(names(at(80.5))).not.toContain(extra[0].name)
    const repli = new SpartanClips([...CATALOG.names().map((n) => CATALOG.get(n) as SpartanClip)], {
      weapons: [{ weapon: '2b1824d5', class: 'rifle', reload: 'absent' }],
      classes: [{ class: 'rifle', reload: 'combat:rifle:reload_1' }],
    })
    expect(names(over(motion(true, film, repli).at('A', 70.75, false, newClipMix()) as ClipMix))).toContain('combat:rifle:reload_1')
    const mort = testReplayDoc({ ...film, tracks: [
      { slot: 1, team: 0, xuid: 'A', startFrame: 0, endFrame: 70, points: [{ t: 0, x: 0, y: 0, z: 0 }, { t: 70, x: 0, y: 0, z: 0 }] },
      { slot: 1, team: 0, xuid: 'A', startFrame: 71, endFrame: 100, points: [{ t: 71, x: 0, y: 0, z: 0 }, { t: 100, x: 0, y: 0, z: 0 }] },
    ], actions: [{ kind: 'reload', slot: 1, t: 69, ms: 6900 }] })
    expect(names(over(motion(true, mort, catalogue).at('A', 71.5, false, newClipMix()) as ClipMix))).not.toContain(extra[0].name)
    const sidekick = testReplayDoc({ ...film, actions: [{ kind: 'reload', slot: 1, t: 81, ms: 8100 }] })
    expect(names(over(motion(true, sidekick, catalogue).at('A', 81.5, false, newClipMix()) as ClipMix))).toContain(extra[1].name)
    const plasma = testReplayDoc({ ...film, loadouts: [{ t: 0, slot: 1, w: ['0xc3542946'] }], inventory: [{ t: 0, slot: 1, d: 0 }] })
    expect(names(over(motion(true, plasma, catalogue).at('A', 70.75, false, newClipMix()) as ClipMix))).not.toContain('combat:rifle:reload_1')
    // The film writes the message twice at an equipment use: no reload starts there, and the one under way stops.
    const usage = { kind: 'reload', slot: 1, t: 73, ms: 7325 }
    const coupe = testReplayDoc({ ...film, actions: [{ kind: 'reload', slot: 1, t: 70, ms: 7025 }, usage, usage] })
    const m2 = motion(true, coupe, catalogue)
    expect(names(over(m2.at('A', 72.5, false, newClipMix()) as ClipMix))).toContain(extra[0].name)
    expect(names(over(m2.at('A', 73.5, false, newClipMix()) as ClipMix))).not.toContain(extra[0].name)
    const seul = testReplayDoc({ ...film, actions: [usage, usage] })
    expect(names(over(motion(true, seul, catalogue).at('A', 73.5, false, newClipMix()) as ClipMix))).not.toContain(extra[0].name)
  })

  it('ajoute les coups non mortels et conserve le calage du coup mortel voisin', () => {
    const film = testReplayDoc({ ...doc, actions: [
      { kind: 'melee', slot: 1, t: 24, ms: 2400 },
      { kind: 'melee', slot: 1, t: 50, ms: 5000 },
      { kind: 'melee', slot: 2, t: 70, ms: 7000 },
    ] })
    const m = motion(true, film)
    const at = (f: number) => over(m.at('A', f, false, newClipMix()) as ClipMix).filter((l) => l.name.endsWith('melee_strike_1'))
    expect(at(23.9)).toHaveLength(0)
    expect(at(25)).toHaveLength(1)
    expect(at(25)[0].time).toBeCloseTo(0.1)
    expect(at(50.5)).toHaveLength(1)
    expect(at(50.5)[0].time).toBeCloseTo(0.05)
    expect(at(70)).toHaveLength(0)
  })
})
