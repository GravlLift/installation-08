// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { motionCatalog } from '../test/spartanClips'
import type { SpartanClip } from './clips3d'
import { newClipMix, type ClipMix } from './clipSample3d'
import {
  ACTION_FADE_IN,
  dirWeights,
  IDLE_BELOW,
  LAND_SECONDS,
  MELEE_IMPACT,
  mixStride,
  MOVE_FULL,
  phaseTime,
  selectClips,
  STANCE_FADE,
  THROW_RELEASE,
  wrap180,
  type MotionInput,
  type MotionStances,
} from './clipSelect3d'

const CAT = motionCatalog()
/** Les huit directions de `motionCatalog` et leur angle (degrés, + = gauche). */
const DIRS: readonly (readonly [string, number])[] = [
  ['front', 0], ['frontleft', 45], ['left', 90], ['backleft', 135],
  ['back', 180], ['backright', -135], ['right', -90], ['frontright', -45],
]
const NONE: MotionStances = { crouch: [], sprint: [], slide: [], clamber: [], jump: [] }
const FPS = 10

function input(over: Partial<MotionInput> = {}): MotionInput {
  return {
    frame: 100,
    fps: FPS,
    weapon: 'rifle',
    gait: { speed: 0, rel: 0, phase: 0 },
    stances: NONE,
    events: { melee: [], grenade: [], reload: [], swaps: [] },
    ...over,
  }
}

/** layers : les couches de base (nom → poids, temps), poids sommés par nom. */
function base(mix: ClipMix): Map<string, { weight: number; time: number }> {
  const out = new Map<string, { weight: number; time: number }>()
  for (const l of mix.base.slice(0, mix.baseCount)) {
    const name = l.clip?.name ?? ''
    const prev = out.get(name)
    out.set(name, { weight: (prev?.weight ?? 0) + l.weight, time: l.time })
  }
  return out
}
const over = (mix: ClipMix) => mix.over.slice(0, mix.overCount).map((l) => ({ name: l.clip?.name, time: l.time, weight: l.weight }))
const total = (mix: ClipMix) => mix.base.slice(0, mix.baseCount).reduce((s, l) => s + l.weight, 0)
const select = (q: MotionInput) => selectClips(q, CAT, newClipMix())

describe('selectClips : locomotion', () => {
  it('immobile : l’attente seule, à l’heure de l’image ; à bord aussi', () => {
    const m = select(input({ gait: { speed: IDLE_BELOW / 2, rel: 0, phase: 3 } }))
    expect([...base(m).keys()]).toEqual(['combat:rifle:idle'])
    expect(base(m).get('combat:rifle:idle')?.time).toBeCloseTo(10)
    expect([...base(select(input({ gait: null }))).keys()]).toEqual(['combat:rifle:idle'])
  })

  it('les poids font 1 dans chaque état', () => {
    for (const speed of [0, 0.3, 0.8, 1.2, 2, 3]) {
      for (const rel of [0, 30, 100, -170]) expect(total(select(input({ gait: { speed, rel, phase: 1.3 } })))).toBeCloseTo(1, 9)
    }
  })

  it('marche, puis course, mêlées selon la vitesse entre les vitesses propres des clips', () => {
    const walkSpeed = 0.94 / (26 / 30)
    const runSpeed = 1.533 / (22 / 30)
    const at = (speed: number) => base(select(input({ gait: { speed, rel: 0, phase: 0 } })))
    expect(at(MOVE_FULL).get('combat:rifle:locomote_walk_front')?.weight).toBeCloseTo(1)
    expect(at(walkSpeed).get('combat:rifle:locomote_walk_front')?.weight).toBeCloseTo(1)
    const mid = at((walkSpeed + runSpeed) / 2)
    expect(mid.get('combat:rifle:locomote_walk_front')?.weight).toBeCloseTo(0.5)
    expect(mid.get('combat:rifle:locomote_run_front')?.weight).toBeCloseTo(0.5)
    expect(at(runSpeed + 1).get('combat:rifle:locomote_run_front')?.weight).toBeCloseTo(1)
  })

  it('le temps d’un clip qui se déplace vient de la phase : même phase, même temps ; à rebours, à rebours', () => {
    const clip = CAT.get('combat:rifle:locomote_run_front') as SpartanClip
    const t = (phase: number) => base(select(input({ gait: { speed: 2.1, rel: 0, phase } }))).get(clip.name)?.time ?? -1
    expect(t(4.2)).toBe(t(4.2))
    expect(t(4.2)).toBeCloseTo(phaseTime(clip, 4.2))
    // La phase avance avec la distance : un dixième de cycle plus loin, un dixième de cycle de clip.
    expect(t(4.3) - t(4.2)).toBeCloseTo(0.1 * clip.cycle)
    expect(t(4.1) - t(4.2)).toBeCloseTo(-0.1 * clip.cycle)
    // Aucune dépendance à l'image : seule la phase compte.
    const other = selectClips(input({ frame: 777, gait: { speed: 2.1, rel: 0, phase: 4.2 } }), CAT, newClipMix())
    expect(base(other).get(clip.name)?.time).toBe(t(4.2))
  })

  it('mixStride : la foulée moyenne des couches qui se déplacent', () => {
    expect(mixStride(select(input({ gait: { speed: 3, rel: 0, phase: 0 } })))).toBeCloseTo(1.533)
    expect(mixStride(select(input({ gait: { speed: 0, rel: 0, phase: 0 } })))).toBe(0)
  })
})

describe('selectClips : direction', () => {
  it('les poids des directions font 1 et sont continus sur les huit secteurs', () => {
    let prev: Map<string, number> | null = null
    for (let rel = -360; rel <= 360; rel += 0.5) {
      const p = dirWeights(CAT, 'rifle', 'run', rel)
      expect(p.wa + p.wb).toBeCloseTo(1, 12)
      const w = new Map<string, number>()
      if (p.a) w.set(p.a.name, (w.get(p.a.name) ?? 0) + p.wa)
      if (p.b) w.set(p.b.name, (w.get(p.b.name) ?? 0) + p.wb)
      if (prev) {
        for (const name of new Set([...w.keys(), ...prev.keys()])) {
          expect(Math.abs((w.get(name) ?? 0) - (prev.get(name) ?? 0))).toBeLessThan(0.5 / 45 + 1e-9)
        }
      }
      prev = w
    }
  })

  it('chaque secteur prend son clip, entre deux secteurs les deux voisins', () => {
    for (const [d, a] of DIRS) {
      const p = dirWeights(CAT, 'rifle', 'run', a)
      expect(p.a?.name).toBe(`combat:rifle:locomote_run_${d}`)
      expect(p.wa).toBeCloseTo(1)
    }
    const p = dirWeights(CAT, 'rifle', 'run', 22.5)
    expect([p.a?.name, p.b?.name]).toEqual(['combat:rifle:locomote_run_front', 'combat:rifle:locomote_run_frontleft'])
    expect(p.wa).toBeCloseTo(0.5)
    expect(wrap180(190)).toBe(-170)
  })

  it('le pistolet mêle ses quatre directions ; le marteau garde son avance de face et prend le fusil ailleurs', () => {
    const p = dirWeights(CAT, 'pistol', 'run', 45)
    expect([p.a?.name, p.b?.name]).toEqual(['combat:pistol:locomote_run_front', 'combat:pistol:locomote_run_left'])
    expect(p.wa).toBeCloseTo(0.5)
    expect(dirWeights(CAT, 'hammer', 'run', 0).a?.name).toBe('combat:hammer:locomote_run_front')
    expect(dirWeights(CAT, 'hammer', 'run', 90).a?.name).toBe('combat:rifle:locomote_run_left')
  })
})

describe('selectClips : postures', () => {
  const span = (t0: number, t1: number) => [{ t0, t1 }]
  const moving = { speed: 2.1, rel: 0, phase: 0.4 }

  it('sprint : fondu depuis le début de l’intervalle et après sa fin, fonction de l’image', () => {
    const w = (frame: number) => base(select(input({ frame, gait: moving, stances: { ...NONE, sprint: span(100, 120) } }))).get('sprint:rifle:locomote')?.weight ?? 0
    expect(w(99)).toBe(0)
    expect(w(100)).toBe(0)
    expect(w(100 + (STANCE_FADE * FPS) / 2)).toBeCloseTo(0.5)
    expect(w(110)).toBeCloseTo(1)
    expect(w(121 + (STANCE_FADE * FPS) / 2)).toBeCloseTo(0.5)
    expect(w(125)).toBe(0)
    // Pur : la même image, quel que soit l'ordre des appels.
    expect(w(101)).toBe(w(101))
  })

  it('accroupi : l’attente et la marche accroupies, le reste debout pendant le fondu', () => {
    const still = base(select(input({ frame: 110, gait: { speed: 0, rel: 0, phase: 0 }, stances: { ...NONE, crouch: span(100, 140) } })))
    expect(still.get('crouch:rifle:idle')?.weight).toBeCloseTo(1)
    const walk = base(select(input({ frame: 110, gait: { speed: 0.66, rel: 90, phase: 0 }, stances: { ...NONE, crouch: span(100, 140) } })))
    expect(walk.get('crouch:rifle:locomote_walk_left')?.weight).toBeCloseTo(1)
    const fading = base(select(input({ frame: 100.75, gait: { speed: 0, rel: 0, phase: 0 }, stances: { ...NONE, crouch: span(100, 140) } })))
    expect(fading.get('crouch:rifle:idle')?.weight).toBeCloseTo(0.5)
    expect(fading.get('combat:rifle:idle')?.weight).toBeCloseTo(0.5)
  })

  it('glissade : le clip depuis le début de l’intervalle, tenu à sa fin', () => {
    const m = base(select(input({ frame: 104, gait: moving, stances: { ...NONE, slide: span(100, 112) } })))
    expect(m.get('crouch:rifle:slide')?.weight).toBeCloseTo(1)
    expect(m.get('crouch:rifle:slide')?.time).toBeCloseTo(0.4)
  })

  it('escalade : entrée puis sortie étirées sur l’intervalle', () => {
    const at = (frame: number) => base(select(input({ frame, gait: moving, stances: { ...NONE, clamber: span(100, 105) } })))
    expect(at(101.5).get('combat:rifle:clamber_enter')?.weight).toBeCloseTo(1)
    expect(at(101.5).get('combat:rifle:clamber_enter')?.time).toBeCloseTo((1.5 / 6 / (10 / 22)) * (9 / 30))
    expect(at(106).get('combat:rifle:clamber_exit')?.time).toBeCloseTo(11 / 30)
    expect(at(98).has('combat:rifle:clamber_enter')).toBe(false)
  })

  it('saut : en l’air depuis le début, réception depuis la fin, puis la locomotion revient', () => {
    const stances = { ...NONE, jump: span(100, 104) }
    const air = base(select(input({ frame: 103, gait: moving, stances })))
    expect(air.get('combat:rifle:airborne_arc')?.weight).toBeCloseTo(1)
    expect(air.get('combat:rifle:airborne_arc')?.time).toBeCloseTo(0.3)
    const land = base(select(input({ frame: 106, gait: moving, stances })))
    expect(land.get('combat:rifle:land_hard')?.time).toBeCloseTo(0.1)
    expect(land.get('combat:rifle:land_hard')?.weight).toBeGreaterThan(0.9)
    const after = base(select(input({ frame: 105 + LAND_SECONDS * FPS + 1, gait: moving, stances })))
    expect(after.has('combat:rifle:land_hard')).toBe(false)
    expect(after.get('combat:rifle:locomote_run_front')?.weight).toBeCloseTo(1)
  })
})

describe('selectClips : actions par-dessus', () => {
  it('corps à corps : l’impact du clip tombe à l’image du coup', () => {
    const at = (frame: number) => over(select(input({ frame, events: { melee: [200], grenade: [], reload: [], swaps: [] } })))
    expect(at(200)[0]).toMatchObject({ name: 'combat:rifle:melee_strike_1', time: expect.closeTo(MELEE_IMPACT, 9), weight: 1 })
    expect(at(200 - (MELEE_IMPACT * FPS) / 2)[0].time).toBeCloseTo(MELEE_IMPACT / 2)
    // Avant le début du clip, et après sa fin : rien.
    expect(at(200 - MELEE_IMPACT * FPS - 0.1)).toEqual([])
    expect(at(212)).toEqual([])
  })

  it('grenade : le lâcher tombe à l’image du lancer ; rechargement depuis son image', () => {
    expect(THROW_RELEASE).toBe(0.25)
    const g = over(select(input({ frame: 300, events: { melee: [], grenade: [300], reload: [], swaps: [] } })))
    expect(g[0]).toMatchObject({ name: 'combat:rifle:throw_grenade', time: expect.closeTo(THROW_RELEASE, 9) })
    const r = over(select(input({ frame: 300 + ACTION_FADE_IN * FPS, events: { melee: [], grenade: [], reload: [300], swaps: [] } })))
    expect(r[0]).toMatchObject({ name: 'combat:rifle:reload_1', time: expect.closeTo(ACTION_FADE_IN, 9), weight: expect.closeTo(1, 9) })
  })

  it('changement d’arme : rangement de l’ancienne classe fini à l’image, dégainage de la nouvelle ensuite', () => {
    const swaps = [{ t: 400, from: 'rifle' as const, to: 'pistol' as const }]
    const before = over(select(input({ frame: 399.9, events: { melee: [], grenade: [], reload: [], swaps } })))
    expect(before.map((l) => l.name)).toEqual(['combat:rifle:put_away'])
    const after = over(select(input({ frame: 401, weapon: 'pistol', events: { melee: [], grenade: [], reload: [], swaps } })))
    expect(after.map((l) => l.name)).toEqual(['combat:pistol:ready'])
    expect(after[0].time).toBeCloseTo(0.1)
  })

  it('thruster: the dodge clip of the push direction plays from the push frame, the latest push wins', () => {
    const dodges = [{ t: 500, dir: 'left' as const }, { t: 504, dir: 'back' as const }]
    const at = (frame: number) => over(select(input({ frame, events: { melee: [], grenade: [], reload: [], swaps: [], dodges } })))
    expect(at(499)).toEqual([])
    expect(at(502)[0]).toMatchObject({ name: 'combat:rifle:dodge_left', time: expect.closeTo(0.2, 9) })
    expect(at(505)[0]).toMatchObject({ name: 'combat:rifle:dodge_back', time: expect.closeTo(0.1, 9) })
    // The clip lasts 19/30 s: gone 7 film frames (0.7 s) after the last push.
    expect(at(511)).toEqual([])
  })

  it('thruster: a class without its own dodge takes the rifle one', () => {
    const m = over(select(input({ frame: 501, weapon: 'pistol', events: { melee: [], grenade: [], reload: [], swaps: [], dodges: [{ t: 500, dir: 'front' }] } })))
    expect(m[0]?.name).toBe('combat:rifle:dodge_front')
  })
})
