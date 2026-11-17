// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { nouvellePosePremierePersonne, posePremierePersonne, type EvenementsPremierePersonne } from './actionsPremierePersonne3d'
import type { ClipPremierePersonne, RigPremierePersonne } from './premierePersonne3d'
import { episodesRechargement, phaseRechargement, type ClipsRechargement } from './rechargementPremierePersonne3d'

const FPS = 30
/** ms on the 30 fps grid. */
const f = (ms: number) => (ms / 1000) * FPS

function clip(name: string, durationSeconds: number): ClipPremierePersonne {
  return { name, action: name, variant: 0, type: 'base', overlay: false, frameCount: Math.round(durationSeconds * 30), frameRate: 30, durationSeconds }
}
// The Heatwave's own clips (first-person library index, 2026-11-15).
const HEATWAVE: ClipsRechargement = {
  plein: null, vide: null, entree: clip('reload_enter', 0.7), boucle: clip('reload_continue_full', 0.367),
  boucleVide: clip('reload_continue_full', 0.367), sortie: clip('chamber_1', 1.033),
}
// The Hydra: its round clip lasts 0.83 s, the film's stages come every 0.42 s.
const HYDRA: ClipsRechargement = { ...HEATWAVE, entree: clip('reload_enter', 0.6), boucle: clip('reload_full', 0.833), boucleVide: clip('reload_full', 0.833) }

/** The film's messages of a Heatwave reload of `n` rounds (match 05dfe4e9, slot 532): starts and the closing cut, in frames. */
function heatwaveReload(n: number, from = 0): { debuts: number[]; coupures: number[] } {
  const debuts = [f(from)]
  for (let k = 0; k < n; k++) debuts.push(f(from + 684 + 367 * k), f(from + 700 + 367 * k))
  return { debuts, coupures: [f(from + 684 + 367 * n)] }
}

const nom = (c: ClipsRechargement, episodes: ReturnType<typeof episodesRechargement>, ms: number, tir = -Infinity) =>
  phaseRechargement(c, episodes, f(ms), FPS, tir, -Infinity)?.clip.name ?? null

describe('staged first-person reloads', () => {
  it('groups the film messages into one episode: the start, one stage per round, the closing cut', () => {
    const { debuts, coupures } = heatwaveReload(2)
    const [ep, ...rest] = episodesRechargement(debuts, coupures, FPS)
    expect(rest).toEqual([])
    expect(ep.etapes.map((e) => Math.round((e.t / FPS) * 1000))).toEqual([0, 684, 1051, 1418])
    expect(ep.etapes.map((e) => e.coupe)).toEqual([false, false, false, true])
  })

  it('starts no episode at a cut, and leaves out a cut long after the last stage', () => {
    const eps = episodesRechargement([f(5000)], [f(2000), f(7000)], FPS)
    expect(eps).toHaveLength(1)
    expect(eps[0].etapes).toEqual([{ t: f(5000), coupe: false }])
  })

  it('plays enter, one round clip per round, then the closing clip, and a fuller reload takes longer', () => {
    const one = episodesRechargement(...Object.values(heatwaveReload(1)) as [number[], number[]], FPS)
    const four = episodesRechargement(...Object.values(heatwaveReload(4)) as [number[], number[]], FPS)
    expect(nom(HEATWAVE, four, 100)).toBe('reload_enter')
    expect(nom(HEATWAVE, four, 700)).toBe('reload_continue_full')
    expect(nom(HEATWAVE, four, 1800)).toBe('reload_continue_full')
    expect(nom(HEATWAVE, four, 2200)).toBe('chamber_1')
    expect(nom(HEATWAVE, four, 2152 + 1100)).toBeNull()
    // One round: the closing clip starts at 1051 ms, four rounds at 2152 ms.
    expect(nom(HEATWAVE, one, 1100)).toBe('chamber_1')
    expect(nom(HEATWAVE, one, 1051 + 1100)).toBeNull()
    expect(nom(HEATWAVE, four, 1100)).toBe('reload_continue_full')
  })

  it('restarts the round clip at each stage, at full weight across the joins', () => {
    const eps = episodesRechargement(...Object.values(heatwaveReload(3)) as [number[], number[]], FPS)
    const a = phaseRechargement(HEATWAVE, eps, f(1051), FPS, -Infinity, -Infinity)!
    expect(a.temps).toBeCloseTo(0)
    expect(a.poids).toBe(1)
    const b = phaseRechargement(HEATWAVE, eps, f(1040), FPS, -Infinity, -Infinity)!
    expect(b.temps).toBeCloseTo(0.356, 2)
    expect(b.poids).toBe(1)
    expect(phaseRechargement(HEATWAVE, eps, f(683), FPS, -Infinity, -Infinity)?.poids).toBe(1)
  })

  it('fits a round clip longer than its stage into the stage (Hydra, 0.83 s clip every 0.42 s)', () => {
    const debuts = [0, 584, 601, 1001, 1018, 1418, 1435].map(f)
    const eps = episodesRechargement(debuts, [f(1835)], FPS)
    const p = phaseRechargement(HYDRA, eps, f(1209), FPS, -Infinity, -Infinity)!
    expect(p.clip.name).toBe('reload_full')
    expect(p.temps).toBeCloseTo(0.833 * (208 / 417), 2)
    expect(nom(HYDRA, eps, 1900)).toBe('chamber_1')
  })

  it('plays no closing clip after a reload cut mid-round, nor after a shot', () => {
    // Cindershot, match 05dfe4e9 slot 543: the second round is cut 0.13 s in.
    const c = { ...HEATWAVE, entree: clip('reload_enter', 0.633), boucle: clip('reload_continue_full', 0.533), sortie: clip('chamber_1', 1.5) }
    const eps = episodesRechargement([0, 617, 634, 1152, 1168].map(f), [f(1285)], FPS)
    expect(nom(c, eps, 1200)).toBe('reload_continue_full')
    // The cut round keeps the episode's pace (no fast forward into the cut).
    expect(phaseRechargement(c, eps, f(1200), FPS, -Infinity, -Infinity)?.temps).toBeCloseTo(0.048, 2)
    expect(nom(c, eps, 1300)).toBeNull()
    const full = episodesRechargement(...Object.values(heatwaveReload(2)) as [number[], number[]], FPS)
    expect(nom(HEATWAVE, full, 1500, f(1450))).toBeNull()
    expect(nom(HEATWAVE, full, 900, f(800))).toBeNull()
  })

  it('a magazine reload plays its one clip from the episode start, empty or full by the magazine', () => {
    const ma40: ClipsRechargement = { plein: clip('reload_full', 2.33), vide: clip('reload_empty', 2.67), entree: null, boucle: null, boucleVide: null, sortie: null }
    // MA40, match 05dfe4e9 slot 693: two more messages 233/266 ms in no longer restart the clip.
    const eps = episodesRechargement([0, 233, 266].map(f), [], FPS, () => true)
    const p = phaseRechargement(ma40, eps, f(500), FPS, -Infinity, -Infinity)!
    expect(p.clip.name).toBe('reload_empty')
    expect(p.temps).toBeCloseTo(0.5)
    expect(p.poids).toBeNull()
    expect(nom(ma40, episodesRechargement([0], [], FPS, () => false), 500)).toBe('reload_full')
    expect(nom(ma40, episodesRechargement([0], [], FPS), 500)).toBe('reload_full')
    expect(nom(ma40, eps, 2700)).toBeNull()
  })

  it('drives the first-person pose: the staged phases override the usual fade, a melee still wins', () => {
    const names = ['reload_enter', 'reload_continue_full', 'reload_continue_empty', 'chamber_1', 'melee_strike_1']
    const durees: Record<string, number> = { reload_enter: 0.7, reload_continue_full: 0.367, reload_continue_empty: 0.367, chamber_1: 1.033, melee_strike_1: 1.5 }
    const rig: RigPremierePersonne = { file: '', bones: 0, triangles: 0, bytes: 0, missingActions: [],
      clips: names.filter((n) => n !== 'reload_continue_empty').map((n) => clip(n, durees[n])),
      actions: names.map((n) => ({ action: n, variant: 0, clip: n === 'reload_continue_empty' ? 'reload_continue_full' : n })) }
    const e: EvenementsPremierePersonne = { rechargements: episodesRechargement(...Object.values(heatwaveReload(2)) as [number[], number[]], FPS),
      coups: [], tirs: [], grenades: [], changements: [], sprints: [], slides: [], accroupis: [], sauts: [], escalades: [], usages: [],
      frame: f(1051), fps: FPS, rechargementValide: () => true }
    let pose = posePremierePersonne(rig, e, nouvellePosePremierePersonne())
    expect(pose.base?.name).toBe('reload_continue_full')
    expect(pose.poidsBase).toBe(1)
    e.frame = f(1500)
    expect(posePremierePersonne(rig, e, nouvellePosePremierePersonne()).base?.name).toBe('chamber_1')
    e.coups = [f(1400)]
    pose = posePremierePersonne(rig, e, nouvellePosePremierePersonne())
    expect(pose.base?.name).toBe('melee_strike_1')
  })
})

// The Ravager's own clips (first-person library, 2026-11-15): no reload clip, a vent.
const RAVAGER: ClipsRechargement = {
  plein: null, vide: null, entree: null, boucle: null, boucleVide: null, sortie: null,
  vent: { entree: clip('vent_enter', 0.3), boucle: clip('vent_loop', 0.933), sortie: clip('vent_exit', 0.6) },
}

describe('the vent of a heat weapon', () => {
  // Match 05dfe4e9, TasteThePainbow's Ravager: reload messages at 7:56.8 and 7:57.4 (606 ms apart).
  const episodes = episodesRechargement([f(0), f(606)], [], FPS)

  it('plays the vent clips from the film reload message: enter, loop, exit', () => {
    expect(nom(RAVAGER, episodes, 100)).toBe('vent_enter')
    expect(nom(RAVAGER, episodes, 700)).toBe('vent_loop')
    expect(nom(RAVAGER, episodes, 1300)).toBe('vent_exit')
    expect(nom(RAVAGER, episodes, 1900)).toBeNull()
  })

  it('holds the loop until the last message of a longer vent', () => {
    const long = episodesRechargement([f(0), f(800), f(1600)], [], FPS)
    expect(nom(RAVAGER, long, 1500)).toBe('vent_loop')
    expect(nom(RAVAGER, long, 1700)).toBe('vent_exit')
  })

  it('ends at a shot fired after the vent starts', () => {
    expect(nom(RAVAGER, episodes, 700, f(500))).toBeNull()
  })

  it('leaves a weapon with reload clips on its reload', () => {
    const ma40: ClipsRechargement = { plein: clip('reload_full', 2.33), vide: null, entree: null, boucle: null, boucleVide: null, sortie: null, vent: RAVAGER.vent }
    expect(nom(ma40, episodes, 700)).toBe('reload_full')
  })
})