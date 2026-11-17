// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import type { Dress } from './armory3d'
import { verticalFovOf, viewmodelScale } from '../model/fovLogic'
import { firstPersonArms3d, estMateriauBras, estMateriauPeint, memePeinture, peindreMateriauBras } from './firstPersonArms3d'
import { LoadGate } from './loadGate3d'
import type { EvenementsPremierePersonne } from './firstPersonActions3d'
import type { RigPremierePersonne } from './premierePersonne3d'

// A rig download that never settles: a rig left mid-load stays in-flight, which the gate test needs.
const { fetchMesh } = vi.hoisted(() => ({ fetchMesh: vi.fn(() => new Promise<void>(() => {})) }))
vi.mock('./meshFetch', () => ({ fetchMesh }))

describe('estMateriauBras', () => {
  it('reconnaît la surface brute sans remplacer les matériaux de l’arme', () => {
    const bras = new THREE.MeshStandardMaterial()
    bras.userData.surfaceBrute = { asg: 0 }
    expect(estMateriauBras(bras)).toBe(true)
    const arme = new THREE.MeshStandardMaterial()
    expect(estMateriauBras(arme)).toBe(false)
    bras.map = new THREE.Texture()
    expect(estMateriauBras(bras)).toBe(false)
    expect(estMateriauBras(new THREE.MeshBasicMaterial())).toBe(false)
  })

  it('a raw rig weapon material (rigWeapon) is painted but is not an arm', () => {
    const arme = new THREE.MeshStandardMaterial()
    arme.userData.surfaceBrute = { asg: 0 }
    arme.userData.rigWeapon = true
    expect(estMateriauPeint(arme)).toBe(true)
    expect(estMateriauBras(arme)).toBe(false)
    const bras = new THREE.MeshStandardMaterial()
    bras.userData.surfaceBrute = { asg: 0 }
    expect(estMateriauPeint(bras)).toBe(true)
    expect(estMateriauBras(bras)).toBe(true)
  })
})


describe('contre-échelle du porteur au champ de la caméra', () => {
  it('garde la projection réglée à 55° et n’échelle pas la profondeur', () => {
    // Le catalogue de bras est hors de portée en test : on tait l’avertissement de repli.
    const silence = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scene = new THREE.Scene()
    const bras = new firstPersonArms3d(scene, '/premiere-personne')
    const porteur = scene.children[0]
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    bras.placer(camera)
    expect(porteur.scale.x).toBe(1)
    expect(porteur.scale.y).toBe(1)
    expect(porteur.scale.z).toBe(1)
    const large = verticalFovOf(120)
    camera.fov = large
    bras.placer(camera)
    const echelle = viewmodelScale(large, 55)
    expect(porteur.scale.x).toBeCloseTo(echelle, 6)
    expect(porteur.scale.y).toBeCloseTo(echelle, 6)
    expect(porteur.scale.z).toBe(1)
    bras.dispose()
    silence.mockRestore()
  })
})

describe('racinesChargees', () => {
  it('rend les racines des rigs chargés, vide sans rig chargé', () => {
    // Le catalogue de bras est hors de portée en test : on tait l'avertissement de repli.
    const silence = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scene = new THREE.Scene()
    const bras = new firstPersonArms3d(scene, '/premiere-personne')
    expect(bras.racinesChargees()).toEqual([])
    bras.dispose()
    silence.mockRestore()
  })

  it('prépare tous les rigs chargés et attend les pièces de chacun avant de peindre', () => {
    const silence = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bras = new firstPersonArms3d(new THREE.Scene(), '/premiere-personne')
    const interne = bras as unknown as {
      entrees: Map<string, { root: THREE.Object3D } | null>
      habillage: { actualiser: (f: string, r: THREE.Object3D) => void; enCours: (f: string) => boolean }
      peinture: { actualiser: (f: string, r: THREE.Object3D) => void }
    }
    const a = new THREE.Group(), b = new THREE.Group()
    interne.entrees.set('a', { root: a })
    interne.entrees.set('b', { root: b })
    const habiller = vi.spyOn(interne.habillage, 'actualiser').mockImplementation(() => {})
    vi.spyOn(interne.habillage, 'enCours').mockImplementation((f) => f === 'b')
    const peindre = vi.spyOn(interne.peinture, 'actualiser').mockImplementation(() => {})
    bras.preparerRig()
    expect(habiller).toHaveBeenCalledTimes(2)
    expect(peindre).toHaveBeenCalledOnce()
    expect(peindre).toHaveBeenCalledWith('a', a)
    interne.entrees.clear()
    bras.dispose()
    silence.mockRestore()
  })
})

describe("montrer : le rig se montre tel qu'il est, jamais replié sur le modèle statique en attente de peinture", () => {
  /** Une image nulle : `montrer` ne lit que la caméra et le rig. */
  const evenements = {
    rechargements: [], coups: [], tirs: [], grenades: [], changements: [], sprints: [],
    slides: [], accroupis: [], sauts: [], escalades: [], usages: [], frame: 0, fps: 30,
    rechargementValide: () => false,
  } as unknown as EvenementsPremierePersonne

  /** Le rig chargé : une racine avec un matériau de bras et un clip idle jouable. */
  function rigCharge(fichier: string, bras: firstPersonArms3d): THREE.Group {
    const materiau = new THREE.MeshStandardMaterial()
    materiau.userData.surfaceBrute = {}
    const racine = new THREE.Group()
    racine.add(new THREE.Mesh(new THREE.BoxGeometry(), materiau))
    const clip = {
      name: 'idle', action: 'idle', variant: 0, type: 'base', overlay: false,
      frameCount: 60, frameRate: 30, durationSeconds: 2,
    }
    const rig = { file: fichier, bones: 1, triangles: 1, bytes: 1, clips: [clip], actions: [{ action: 'idle', variant: 0, clip: 'idle' }], missingActions: [] } as unknown as RigPremierePersonne
    const idle = { time: 0, weight: 1 }
    const interne = bras as unknown as {
      entrees: Map<string, unknown>
      armes: Map<string, unknown>
      fichiersArmes: Map<string, string>
      habillage: { actualiser: (f: string, r: THREE.Object3D) => void; enCours: (f?: string) => boolean }
      peinture: { actualiser: (f: string, r: THREE.Object3D) => void; enCours: (f?: string) => boolean }
      xuid: string | null
      armurerie: { pending: (x: string) => boolean; regions: (x: string) => unknown; dress: (x: string) => unknown } | null
    }
    interne.entrees.set(fichier, { root: racine, materiaux: [materiau], mixer: { update: () => {} }, rig, actions: new Map([[clip.name, idle]]), listeActions: [idle], clip })
    interne.armes.set('arme', rig)
    interne.fichiersArmes.set(fichier, 'arme')
    return racine
  }

  function brasDeScene(): { bras: firstPersonArms3d; interne: { habillage: { enCours: (f?: string) => boolean }; peinture: { enCours: (f?: string) => boolean }; xuid: string | null; armurerie: { pending: (x: string) => boolean; regions: (x: string) => unknown; dress: (x: string) => unknown } | null } } {
    const silence = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bras = new firstPersonArms3d(new THREE.Scene(), '/premiere-personne')
    const interne = bras as unknown as ReturnType<typeof brasDeScene>['interne']
    ;(bras as unknown as { dispose: () => void }).dispose = () => { silence.mockRestore() }
    return { bras, interne }
  }

  it('montre le rig (vrai) pendant que la peinture est en cours, avec le revêtement posé', () => {
    const { bras, interne } = brasDeScene()
    const racine = rigCharge('a.glb', bras)
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    interne.peinture.enCours = () => true
    expect(bras.montrer(camera, 'arme', evenements, null)).toBe(true)
    expect(racine.visible).toBe(true)
  })

  it('montre le rig (vrai) pendant que les pièces sont en cours, avec les bras embarqués', () => {
    const { bras, interne } = brasDeScene()
    const racine = rigCharge('a.glb', bras)
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    interne.habillage.enCours = () => true
    expect(bras.montrer(camera, 'arme', evenements, null)).toBe(true)
    expect(racine.visible).toBe(true)
  })

  it('montre le rig (vrai) sans armure chargée, sans attendre l’armurerie', () => {
    const { bras, interne } = brasDeScene()
    rigCharge('a.glb', bras)
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    interne.xuid = '1'
    interne.armurerie = { pending: () => true, regions: () => null, dress: () => null }
    expect(bras.montrer(camera, 'arme', evenements, null)).toBe(true)
  })
})

describe('gate: first-person rig loading', () => {
  const evenements = {
    rechargements: [], coups: [], tirs: [], grenades: [], changements: [], sprints: [],
    slides: [], accroupis: [], sauts: [], escalades: [], usages: [], frame: 0, fps: 30,
    rechargementValide: () => false,
  } as unknown as EvenementsPremierePersonne

  function brasArme(gate: LoadGate): { bras: firstPersonArms3d; interne: { armes: Map<string, unknown>; fichiersArmes: Map<string, string>; indexPrêt: boolean } } {
    const bras = new firstPersonArms3d(new THREE.Scene(), '/premiere-personne', gate)
    const clip = {
      name: 'idle', action: 'idle', variant: 0, type: 'base', overlay: false,
      frameCount: 60, frameRate: 30, durationSeconds: 2,
    }
    const rig = { file: 'a.glb', bones: 1, triangles: 1, bytes: 1, clips: [clip], actions: [{ action: 'idle', variant: 0, clip: 'idle' }], missingActions: [] } as unknown as RigPremierePersonne
    const interne = bras as unknown as { armes: Map<string, unknown>; fichiersArmes: Map<string, string>; indexPrêt: boolean }
    interne.armes.set('arme', rig)
    interne.fichiersArmes.set('a.glb', 'arme')
    interne.indexPrêt = true
    return { bras, interne }
  }

  it('does not start the preload until it is armed (the gate idle)', () => {
    const silence = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const gate = new LoadGate()
    const { bras } = brasArme(gate)
    fetchMesh.mockClear()
    // Recording the preload starts no download...
    bras.precharger(['arme'])
    expect(fetchMesh).not.toHaveBeenCalled()
    // ...until the gate-idle trigger arms it.
    bras.demarrerPrecharge()
    expect(fetchMesh).toHaveBeenCalledTimes(1)
    bras.dispose()
    silence.mockRestore()
  })

  it('shows a rig gated, even if the preload only recorded it', () => {
    const silence = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const gate = new LoadGate()
    const { bras } = brasArme(gate)
    bras.precharger(['arme'])
    // The constructor already tracks the bras.json index load, so measure the rig's delta.
    const base = gate.pending
    // Showing the rig loads it, gated.
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    expect(bras.montrer(camera, 'arme', evenements, null)).toBe(false)
    expect(gate.pending - base).toBe(1)
    bras.dispose()
    silence.mockRestore()
  })
})

describe('peinture des bras', () => {
  it('garde le repli sans habit, style ou masques et écarte les armes', () => {
    const bras = new THREE.MeshStandardMaterial()
    const habit = {} as Dress
    bras.userData.surfaceBrute = {}
    expect(peindreMateriauBras(bras, habit)).toBe(false)
    bras.userData.style = {}
    expect(peindreMateriauBras(bras, habit)).toBe(false)
    bras.userData.armorMaps = {}
    expect(peindreMateriauBras(bras, null)).toBe(false)
    expect(peindreMateriauBras(bras, habit)).toBe(true)
    bras.map = new THREE.Texture()
    expect(peindreMateriauBras(bras, habit)).toBe(false)
  })

  it('identifie le cache par fichier et identité de l’habit', () => {
    const habit = {} as Dress
    expect(memePeinture('a', 'a', habit, habit)).toBe(true)
    expect(memePeinture('a', 'b', habit, habit)).toBe(false)
    expect(memePeinture('a', 'a', habit, {} as Dress)).toBe(false)
    expect(memePeinture('a', 'a', null, habit)).toBe(false)
  })
})
