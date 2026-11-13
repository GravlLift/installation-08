/**
 * Tests — objectives3dModel : LES OBJECTIFS DE LA 3D SUIVENT LES RÈGLES DE LA 2D.
 *
 * CE QUE CE FICHIER VERROUILLE :
 *  - les interrupteurs : `show.objectives` seul commande tout, les familles suivent le leur ;
 *  - les zones jointes au catalogue suivent leur activité et leur propriétaire ;
 *  - l'indice de hauteur d'un objet posé vient du porteur le plus proche dans le temps ;
 *  - drapeau, crâne et bombe : au-dessus du porteur localisé, au sol sinon.
 */
import { describe, expect, it } from 'vitest'

import type { XY } from '@/lib/replay/replayLogic'
import type {
  ReplayBombCarry,
  ReplayDocumentReady,
  ReplayFlagCarryReady,
  ReplayObjectiveObjectReady,
  ReplayZoneStateReady,
} from '@/lib/replay/replayNormalize'

import type { ObjectiveElementReady } from '../layers/objectivesLayer'
import {
  bombExplosionsOf,
  bombPlaceAt,
  carryHintAt,
  flagPlacesAt,
  objectivesShown,
  prepareFlag,
  prepareObjectives,
  sideInkOf,
  skullPlaceAt,
  zoneDisplayInkAt,
  type ZoneInks,
} from './objectives3dModel'

const ALLY = 'encre-allie'
const ENEMY = 'encre-adverse'
const NEUTRAL = 'encre-neutre'

/** Le joueur regardé est dans l'équipe 0. */
const allegiance = { ofTeam: (t: number | null | undefined) => (t == null || t < 0 ? null : t === 0) }
const inks: ZoneInks = {
  inkOf: sideInkOf(allegiance, (ally) => (ally ? ALLY : ENEMY)),
  neutral: NEUTRAL,
}

function zone(over: Partial<ObjectiveElementReady> = {}): ObjectiveElementReady {
  return {
    role: 'zone', team: -1, x: 0, y: 0, z: 0, kind: 'zone', family: 'cylinder',
    halfX: 0, halfY: 0, radius: 2, fwd: { x: 1, y: 0 }, ...over,
  }
}

const MARKER: ObjectiveElementReady = {
  role: 'flag_spawn', team: 0, x: 3, y: 3, z: 0, kind: 'marker', halfX: 0, halfY: 0, radius: 0, fwd: { x: 1, y: 0 },
}

function state(over: Partial<ReplayZoneStateReady> = {}): ReplayZoneStateReady {
  return { zoneRef: 0, spans: [], gauge: [], gaugeRamps: [], ...over }
}

function zoneDoc(states: ReplayZoneStateReady[], catalog: number): Pick<ReplayDocumentReady, 'zoneStates' | 'coverage'> {
  return { zoneStates: states, coverage: { zones: { catalog } } } as unknown as Pick<ReplayDocumentReady, 'zoneStates' | 'coverage'>
}

describe('objectivesShown', () => {
  it('sans familles, show.objectives commande tout', () => {
    expect(Object.values(objectivesShown(false, null)).every((v) => !v)).toBe(true)
    expect(Object.values(objectivesShown(true, null)).every((v) => v)).toBe(true)
  })

  it('avec familles, chacune suit la sienne et le crâne au sol reste visible', () => {
    const shown = objectivesShown(false, { flags: true, vipCrown: false, bombCarrier: true })
    expect(shown).toEqual({ zones: false, skullFree: true, flags: true, vipCrown: false, bombCarrier: true })
  })
})

describe('prepareObjectives', () => {
  it('joint les états par zoneRef et lit la lettre', () => {
    const p = prepareObjectives([zone(), zone({ x: 5 }), MARKER], zoneDoc([state({ zoneRef: 1, letterRank: 1 })], 2))
    expect(p.zones.map((z) => z.state?.zoneRef ?? null)).toEqual([null, 1])
    expect(p.zones.map((z) => z.letter)).toEqual([null, 'B'])
    expect(p.markers).toEqual([MARKER])
  })

  it('catalogue non joignable : aucun état', () => {
    const p = prepareObjectives([zone()], zoneDoc([state()], 3))
    expect(p.zones[0].state).toBeNull()
  })
})

/** Les pieds de A sont à z = 3 tant qu'il vit (images 0 à 100), B n'a jamais de hauteur. */
const zOf = (xuid: string, f: number) => (xuid === 'A' && f >= 0 && f <= 100 ? 3 : null)

describe('carryHintAt', () => {
  it('lit le porteur le plus proche dans le temps, à la borne la plus proche', () => {
    const seen: number[] = []
    const spy = (x: string, f: number) => {
      seen.push(f)
      return zOf(x, f)
    }
    expect(carryHintAt([{ xuid: 'A', t0: 10, t1: 20 }, { xuid: 'B', t0: 60, t1: 70 }], 30, spy)).toBe(3)
    expect(seen).toEqual([20])
    expect(carryHintAt([], 30, zOf)).toBeNull()
  })
})

describe('flagPlacesAt', () => {
  const carry: ReplayFlagCarryReady = {
    team: 1,
    spans: [
      { state: 'home', t0: 0, t1: 9, x: 1, y: 1, xuid: null, returnProgress: [] },
      { state: 'carried', t0: 10, t1: 19, x: 1, y: 1, xuid: 'A', returnProgress: [] },
      { state: 'dropped', t0: 20, t1: 29, x: 4, y: 4, xuid: null, returnProgress: [] },
      { state: 'carried_open', t0: 30, t1: 40, x: 4, y: 4, xuid: 'A', returnProgress: [] },
    ],
  }
  const posOf = (xuid: string, f: number): XY | null => (xuid === 'A' && f < 35 ? { x: 9, y: 9 } : null)
  const flag = prepareFlag(carry, zOf)

  it('à la base : posé au sol, sans base vide', () => {
    expect(flagPlacesAt(flag, 5, posOf, zOf)).toEqual({
      team: 1, live: { on: 'floor', at: { x: 1, y: 1 }, hint: 3 }, hollow: false, home: null,
    })
    expect(flag.homeHint).toBe(3)
  })

  it('porté : au-dessus du porteur, la base reste en fantôme', () => {
    const p = flagPlacesAt(flag, 15, posOf, zOf)
    expect(p?.live).toEqual({ on: 'carrier', xuid: 'A' })
    expect(p?.home).toEqual({ on: 'floor', at: { x: 1, y: 1 }, hint: 3 })
  })

  it('tombé : au sol, à la hauteur du dernier porteur', () => {
    expect(flagPlacesAt(flag, 25, posOf, zOf)?.live).toEqual({ on: 'floor', at: { x: 4, y: 4 }, hint: 3 })
  })

  it('portage non daté : fanion creux ; porteur perdu : libre à sa dernière position', () => {
    expect(flagPlacesAt(flag, 32, posOf, zOf)).toMatchObject({ live: { on: 'carrier', xuid: 'A' }, hollow: true })
    expect(flagPlacesAt(flag, 38, posOf, zOf)?.live).toEqual({ on: 'floor', at: { x: 9, y: 9 }, hint: 3 })
  })

  it('hors de tout intervalle : rien', () => {
    expect(flagPlacesAt(flag, 50, posOf, zOf)).toBeNull()
  })
})

describe('skullPlaceAt', () => {
  /** Deux vies-instant au même point : c'est le socle. */
  const instant = (t: number): ReplayObjectiveObjectReady =>
    ({ t0: t, t1: t, pts: [{ t, x: 2, y: 2 }], family: 'skull', fr: '', en: '' })
  const lives = [instant(0), instant(50)]
  const carries = [{ xuid: 'A', t0: 10, t1: 20, closed: true }]
  const sources = { lives, carries, socle: { x: 2, y: 2 } }
  const posOf = (xuid: string): XY | null => (xuid === 'A' ? { x: 7, y: 7 } : null)

  it('porté par un joueur localisé : au-dessus de lui', () => {
    expect(skullPlaceAt(sources, 15, posOf, zOf)).toEqual({ on: 'carrier', xuid: 'A' })
  })

  it('au repos : sur son socle, à la hauteur du porteur voisin', () => {
    expect(skullPlaceAt(sources, 30, posOf, zOf)).toEqual({ on: 'floor', at: { x: 2, y: 2 }, hint: 3 })
  })

  it('sans vie ni portage : rien', () => {
    expect(skullPlaceAt({ lives: [], carries: [], socle: null }, 30, posOf, zOf)).toBeNull()
  })
})

describe('bombPlaceAt', () => {
  const carries: ReplayBombCarry[] = [{ xuid: 'A', t0: 10, t1: 20, closed: true }]
  const posOf = (xuid: string, f: number): XY | null => (xuid === 'A' && f <= 20 ? { x: 6, y: 6 } : null)

  it('portée : sur son porteur ; lâchée : au sol au point du lâcheur', () => {
    expect(bombPlaceAt(carries, [], 15, posOf, zOf)).toEqual({ on: 'carrier', xuid: 'A' })
    expect(bombPlaceAt(carries, [], 30, posOf, zOf)).toEqual({ on: 'floor', at: { x: 6, y: 6 }, hint: 3 })
  })

  it('explosée, ou sans horloge de confiance : plus au sol', () => {
    expect(bombPlaceAt(carries, [25], 30, posOf, zOf)).toBeNull()
    expect(bombPlaceAt(carries, null, 30, posOf, zOf)).toBeNull()
  })

  it('les explosions se lisent dans les actions, triées, sous la garde d’horloge', () => {
    const objectives = [{ stat: 'bomb_detonations', t: 40 }, { stat: 'kills', t: 5 }, { stat: 'bomb_detonations', t: 12 }]
    const doc = { objectives, coverage: {} } as unknown as ReplayDocumentReady
    expect(bombExplosionsOf(doc)).toEqual([12, 40])
    const untrusted = { objectives, coverage: { originResolved: false } } as unknown as ReplayDocumentReady
    expect(bombExplosionsOf(untrusted)).toBeNull()
  })
})


describe('visibilité et couleur des objectifs 3D', () => {
  const prep = (role: string, st: ReplayZoneStateReady | null) =>
    prepareObjectives([zone({ role })], zoneDoc(st ? [st] : [], 1)).zones[0]

  it('ne dessine une colline que pendant un intervalle actif, avec son propriétaire', () => {
    const st = state({ spans: [
      { t0: 10, t1: 19, owner: null, active: true },
      { t0: 20, t1: 29, owner: 0, active: true },
      { t0: 30, t1: 39, owner: 1, active: false },
    ], gauge: [{ t: 20, v: 0.5 }], gaugeRamps: [{ t0: 20, t1: 29, capturingTeam: 1 }] })
    const hill = prep('hill', st)
    expect(zoneDisplayInkAt(hill, 5, inks)).toBeNull()
    expect(zoneDisplayInkAt(hill, 15, inks)).toBe(NEUTRAL)
    expect(zoneDisplayInkAt(hill, 25, inks)).toBe(ALLY)
    expect(zoneDisplayInkAt(hill, 35, inks)).toBeNull()
    expect(zoneDisplayInkAt(prep('hill', null), 15, inks)).toBeNull()
    const unjoined = prepareObjectives([zone({ role: 'hill' })], zoneDoc([st], 2)).zones[0]
    expect(zoneDisplayInkAt(unjoined, 15, inks)).toBeNull()
  })

  it('montre une zone Strongholds mesurée, neutre ou tenue, sans inventer un état absent', () => {
    const st = state({ spans: [{ t0: 0, t1: 9, owner: null, active: false }, { t0: 10, t1: 19, owner: 1, active: false }] })
    const stronghold = prep('zone', st)
    expect(zoneDisplayInkAt(stronghold, 5, inks)).toBe(NEUTRAL)
    expect(zoneDisplayInkAt(stronghold, 15, inks)).toBe(ENEMY)
    expect(zoneDisplayInkAt(stronghold, 25, inks)).toBeNull()
    expect(zoneDisplayInkAt(prep('zone', null), 5, inks)).toBeNull()
  })
})
