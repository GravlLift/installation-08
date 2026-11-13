/**
 * L'ÉQUIPEMENT 3D MONTRE CE QUE LA 2D MONTRE, AUX MÊMES IMAGES : poses (mur, capteur, objets
 * lâchés, traqueur), failles, câbles de grappin et poussées, sur un document bâti à la main.
 */
import { describe, expect, it } from 'vitest'

import { riftStations, riftStationsAt } from '../model/riftStations'
import { testReplayDoc } from '../test/testDoc'
import {
  equipmentTime3d,
  grappleShownAt,
  knockbackArrow,
  knockbackShownAt,
  placementDrawn,
  placementShownAt,
  placementSpans3d,
} from './equipment3d'

/** 100 ms par image : les durées de la 2D se lisent directement en images. */
const FRAME_MS = 100

function vie(slot: number, start: number, end: number) {
  return { slot, team: 0, startFrame: start, endFrame: end, points: [{ t: start, x: 0, y: 0 }, { t: end, x: 1, y: 0 }] }
}

const doc = testReplayDoc({
  frameCount: 2000,
  frameIntervalMs: FRAME_MS,
  tracks: [vie(3, 0, 400), vie(4, 0, 400)],
  abilityLabels: { '11': { fr: 'Translocateur quantique', en: 'Quantum Translocator' } },
  equipmentPlacements: [
    // Les panneaux d'un mur déployé : dessinés, 12,48 s de repli.
    { family: 'wall', id: '0x528fce46', origin: 'deployed', owner: 3, t0: 100, t1: 105, x: 1, y: 2, z: 0, h: 90 },
    // L'appareil du même mur : jamais dessiné en déployé (seuls les panneaux le sont).
    { family: 'wall', id: '0x8e2dc574', origin: 'deployed', owner: 3, t0: 100, t1: 101, x: 1, y: 2 },
    // Un capteur lâché à la mort : objet lâché, jusqu'à la fin du rejeu.
    { family: 'sensor', id: 'x', origin: 'dropped', owner: 3, t0: 401, t1: 402, x: 5, y: 5 },
    // Une grenade lâchée : jamais dessinée.
    { family: 'grenade_frag', id: 'g', origin: 'dropped', owner: 3, t0: 401, t1: 402, x: 5, y: 5 },
    // Un objet non identifié : bascule éteinte par défaut, rien.
    { family: 'other', id: 'o', origin: 'deployed', owner: 3, t0: 10, t1: 20, x: 0, y: 0 },
    // Un traqueur déployé (artefact ancien) : son impulsion seule, 400 ms.
    { family: 'threat_seeker', id: 's', origin: 'deployed', owner: 4, t0: 50, t1: 51, x: 3, y: 3 },
  ],
  riftPoses: [{ slot: 3, t: 200, t1: 260, x: 7, y: 7, z: 1 }],
  grappleLines: [
    { slot: 3, t0: 30, t1: 40, ax: 9, ay: 9, az: 2 },
    { slot: 4, t0: 50, t1: 50, ax: 9, ay: 9 },
  ],
  knockbacks: [
    { t: 120, slot: 4, by: 3, vx: 6, vy: 0, vz: 0 },
    { t: 130, slot: 4, by: 3, vx: 30, vy: 40, vz: 0 },
    { t: 140, slot: 4 },
  ],
})

const time = equipmentTime3d(doc)

describe('equipment3d — les poses suivent la porte du tracé 2D', () => {
  const spans = placementSpans3d(doc, time)

  it('ne retient que les panneaux du mur, le capteur lâché et le traqueur', () => {
    expect(spans.map((s) => [s.p.family, s.kind])).toEqual([
      ['wall', 'wall'],
      ['sensor', 'dropped'],
      ['threat_seeker', 'seeker'],
    ])
  })

  it('le mur tient sa durée de repli (12,48 s) depuis sa pose', () => {
    const wall = spans[0]
    expect(placementShownAt(wall, 99, time)).toBe(false)
    expect(placementShownAt(wall, 100, time)).toBe(true)
    expect(placementShownAt(wall, 100 + 12_480 / FRAME_MS, time)).toBe(true)
    expect(placementShownAt(wall, 101 + 12_480 / FRAME_MS, time)).toBe(false)
  })

  it('l objet lâché reste jusqu à la fin du rejeu', () => {
    expect(placementShownAt(spans[1], 1999, time)).toBe(true)
  })

  it('le traqueur ne montre que son impulsion', () => {
    const seeker = spans[2]
    expect(placementShownAt(seeker, 50, time)).toBe(true)
    expect(placementShownAt(seeker, 53, time)).toBe(true)
    expect(placementShownAt(seeker, 54, time)).toBe(false)
  })
})

describe('equipment3d — failles, câbles et poussées', () => {
  it('la faille vit de sa pose à sa fin lue', () => {
    const stations = riftStations(doc)
    expect(riftStationsAt(stations, 199)).toEqual([])
    expect(riftStationsAt(stations, 200)).toHaveLength(1)
    expect(riftStationsAt(stations, 260)).toHaveLength(1)
    expect(riftStationsAt(stations, 261)).toEqual([])
  })

  it('le câble est tendu pendant la traction mesurée, jamais sur une traction vide', () => {
    const [line, empty] = doc.grappleLines
    expect(grappleShownAt(line, 29)).toBe(false)
    expect(grappleShownAt(line, 30)).toBe(true)
    expect(grappleShownAt(line, 40)).toBe(true)
    expect(grappleShownAt(line, 41)).toBe(false)
    expect(grappleShownAt(empty, 50)).toBe(false)
  })

  it('la poussée dure l effet 2D (520 ms)', () => {
    const k = doc.knockbacks[0]
    expect(knockbackShownAt(k, 119, time)).toBe(false)
    expect(knockbackShownAt(k, 120, time)).toBe(true)
    expect(knockbackShownAt(k, 125, time)).toBe(true)
    expect(knockbackShownAt(k, 125.3, time)).toBe(false)
  })

  it('la flèche suit la vitesse imposée, plafonnée, et rien sans impulsion', () => {
    const slow = knockbackArrow(doc.knockbacks[0])
    expect(slow?.length).toBeCloseTo(1.2)
    expect(slow?.dir.toArray()).toEqual([1, 0, -0])
    expect(knockbackArrow(doc.knockbacks[1])?.length).toBe(1.5)
    expect(knockbackArrow(doc.knockbacks[2])).toBeNull()
  })

  it('repère des formes des poses éteint : seuls capteur et champ de réparation restent', () => {
    for (const kind of ['sensor', 'field'] as const) expect(placementDrawn(kind, false)).toBe(true)
    for (const kind of ['wall', 'rift', 'shroud', 'seeker', 'unnamed', 'dropped'] as const) {
      expect(placementDrawn(kind, false)).toBe(false)
      expect(placementDrawn(kind, true)).toBe(true)
    }
  })
})
