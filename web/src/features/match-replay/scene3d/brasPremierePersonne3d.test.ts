import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import type { Dress } from './armory3d'
import { verticalFovOf, viewmodelScale } from '../model/fovLogic'
import { BrasPremierePersonne3d, estMateriauBras, estMateriauPeint, memePeinture, peindreMateriauBras } from './brasPremierePersonne3d'

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
    const bras = new BrasPremierePersonne3d(scene, '/premiere-personne')
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
    const bras = new BrasPremierePersonne3d(scene, '/premiere-personne')
    expect(bras.racinesChargees()).toEqual([])
    bras.dispose()
    silence.mockRestore()
  })

  it('prépare tous les rigs chargés et attend les pièces de chacun avant de peindre', () => {
    const silence = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bras = new BrasPremierePersonne3d(new THREE.Scene(), '/premiere-personne')
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
