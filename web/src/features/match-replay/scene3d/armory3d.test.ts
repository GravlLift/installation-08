import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReplaySpartan, SpartanArmorManifest } from '@/lib/replay/spartanArmor'

import type { CoatingFile, CoatingTable } from './armorCoating3d'
import { LAYER_BYTES } from './armorGradients3d'
import { ArmorLibrary, type ArmorLibraryIO } from './armorLibrary3d'
import type { ArmorIndex } from './armorPlan3d'
import { SpartanArmory } from './armory3d'
import { dressSpartan } from './spartanArmor3d'

const BONES = ['b_pedestal', 'b_pelvis', 'b_head']
const POSE = { translation: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] }

/** Une racine portant les os `BONES` en chaîne (racine, bassin, tête). */
function skeletonRoot(names = BONES): { root: THREE.Group; skeleton: THREE.Skeleton } {
  const bones = names.map((n) => Object.assign(new THREE.Bone(), { name: n }))
  bones.forEach((b, i) => {
    if (i > 0) bones[i - 1].add(b)
    b.position.set(0, i * 0.1, 0)
  })
  const root = new THREE.Group()
  root.add(bones[0])
  root.updateMatrixWorld(true)
  return { root, skeleton: new THREE.Skeleton(bones) }
}

/** La scène d'un GLB de pièce : un maillage à peau sur ses propres os. */
function pieceScene(names = BONES): THREE.Object3D {
  const { root, skeleton } = skeletonRoot(names)
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
  root.add(mesh)
  mesh.bind(skeleton)
  return root
}

function rigidScene(): THREE.Object3D {
  const root = new THREE.Group()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
  mesh.position.set(0, 0, 0.5)
  root.add(mesh)
  root.updateMatrixWorld(true)
  return root
}

function index(): ArmorIndex {
  const piece = (k: string) => ({ key: k, region: k.slice(0, 8), permutation: k.slice(9), file: `piece-${k}.glb`, triangles: 1 })
  return {
    schema: 2,
    skeleton: { bones: BONES, root: 0 },
    pieces: [piece('aaaaaaaa-11111111'), piece('aaaaaaaa-13d24f1f'), piece('bbbbbbbb-22222222')],
    attachments: [{ key: 'cccccccc', tag: 'cccccccc', entry: 0, file: 'attachment-cccccccc.glb', triangles: 1, marker: 'm', offset: POSE }],
    markers: [{ name: 'm', instances: [{ region: '', permutation: '', bone: 'b_head', node: 2, translation: [0, 0.2, 0], rotation: [0, 0, 0, 1] }] }],
    themes: [{ name: 'mk7', ocur: 'o', permutation: '13d24f1f', read: true, base_regions: [{ region: 'aaaaaaaa', permutation: '13d24f1f' }] }],
    failures: [],
  }
}

function manifest(hash = 'h1'): SpartanArmorManifest {
  return {
    core_id: 'c', theme_path: 't', theme_tag_id: 1, variant_id: 0x0badf00d, is_kit: false, config_hash: hash,
    body: { body_type: 'Medium', left_arm: 'None', right_arm: 'None', left_leg: 'None', right_leg: 'None' },
    regions: [
      { region: 0, permutation: 0, region_key: 'aaaaaaaa', permutation_key: '11111111', source: 'helmet' },
      { region: 0, permutation: 0, region_key: 'bbbbbbbb', permutation_key: '22222222', source: 'theme' },
    ],
    attachments: [{ slot: 'hip_attachment', path: 'p', resolved: true, tag_key: 'cccccccc' }],
  }
}

const SWATCH = {
  index: 0, gradient_scale: [1, 1] as [number, number], roughness: 4, roughness_white: 0.3, roughness_black: 0.5, metallic: 0.2, emissive: 0,
  top: [0.9, 0.9, 0.9] as [number, number, number], mid: [0.5, 0.5, 0.5] as [number, number, number], bot: [0.1, 0.1, 0.1] as [number, number, number],
  scratch_color: [0.3, 0.3, 0.3] as [number, number, number], scratch_roughness: 0.2, scratch_metallic: 1,
}

/** La table des revêtements : la liste `b0799de3` a pour défaut `036e9dd8`, une zone sans dégradé. */
function table(): CoatingTable {
  return {
    schema: 1, globals: {}, default_styles: { b0799de3: '036e9dd8' },
    styles: { '036e9dd8': { grime_amount: 0, scratch_amount: 0, regions: { '0b7e328b': { '229d91fa': SWATCH } } } },
    visors: { patterns: {}, colors: {} },
  }
}

/** Le revêtement `2c5251bc` : la liste `b0799de3` prend le style `f56eda13`, une zone à dégradé `c5e192fb`. */
function coatingFile(): CoatingFile {
  return {
    style: '2c5251bc', lists: { b0799de3: 'f56eda13' },
    styles: { f56eda13: { grime_amount: 0, scratch_amount: 0.5, regions: { '0b7e328b': { '229d91fa': { ...SWATCH, gradient: 'c5e192fb', top: [0.2, 0.3, 0.4] } } } } },
  }
}

/** Une pièce dont le matériau est peint par la vue (masques chargés, style de la liste `b0799de3`). */
function paintedPiece(): THREE.Object3D {
  const root = pieceScene()
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.material.userData = {
        armorMaps: { asg: null, mask0: null, mask1: null },
        style: { stylelist: 'b0799de3', region: '0b7e328b', intentions: ['229d91fa'], layers: 1, texel_density: [1, 1], offset: [0, 0] },
      }
    }
  })
  return root
}

/**
 * Un réseau factice : chaque fichier rend une scène fraîche, `fail` les fichiers en échec. Les
 * URLs sous `/armes/` (la bibliothèque des armes) lisent `weaponDocs`, sinon les documents d'armure.
 */
function fakeIO(fail: Set<string> = new Set(), scenes: Record<string, () => THREE.Object3D> = {}, weaponDocs: Record<string, () => unknown> = {}) {
  const nameOf = (url: string) => url.slice(url.lastIndexOf('/') + 1)
  const loadGlb = vi.fn(async (url: string) => {
    const name = nameOf(url)
    if (fail.has(name)) throw new Error('404')
    return (scenes[name] ?? (name.startsWith('attachment-') ? rigidScene : pieceScene))()
  })
  const documents: Record<string, () => unknown> = { 'index.json': index, 'coatings.json': table, 'coating-2c5251bc.json': coatingFile }
  const fetchJson = vi.fn(async (url: string) => {
    const name = nameOf(url)
    if (fail.has(name)) throw new Error('404')
    const docs = String(url).includes('/armes/') ? { ...documents, ...weaponDocs } : documents
    const doc = docs[name]
    if (!doc) throw new Error('404')
    return doc()
  })
  const loadSwatch = vi.fn(async (url: string) => {
    if (fail.has(nameOf(url))) throw new Error('404')
    return new Uint8Array(LAYER_BYTES)
  })
  return { io: { fetchJson, loadSwatch, loadGlb } satisfies ArmorLibraryIO, loadGlb, fetchJson, loadSwatch }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('ArmorLibrary', () => {
  it('charge chaque fichier une fois par session, l’index aussi', async () => {
    const { io, loadGlb, fetchJson } = fakeIO()
    const lib = new ArmorLibrary('/base', io)
    const [a, b] = await Promise.all([lib.file('piece-x.glb'), lib.file('piece-x.glb')])
    expect(a).toBe(b)
    await lib.index()
    await lib.index()
    expect(loadGlb).toHaveBeenCalledTimes(1)
    expect(loadGlb.mock.calls[0][0]).toBe('/base/piece-x.glb')
    expect(fetchJson).toHaveBeenCalledTimes(1)
  })

  it('un fichier en échec rend null, journalisé une fois, sans nouvel essai', async () => {
    const { io, loadGlb } = fakeIO(new Set(['piece-x.glb']))
    const lib = new ArmorLibrary('/base', io)
    expect(await lib.file('piece-x.glb')).toBeNull()
    expect(await lib.file('piece-x.glb')).toBeNull()
    expect(loadGlb).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it('index d’un autre schéma : null', async () => {
    const lib = new ArmorLibrary('/base', { ...fakeIO().io, fetchJson: async () => ({ ...index(), schema: 3 }) })
    expect(await lib.index()).toBeNull()
  })

  it('revêtements et dégradés lus une fois ; absents : null, journalisés une fois', async () => {
    const { io, fetchJson, loadSwatch } = fakeIO(new Set(['swatch-deadbeef.png']))
    const lib = new ArmorLibrary('/base', io)
    expect(await lib.coatings()).toEqual(table())
    expect(await lib.coating('2c5251bc')).toEqual(coatingFile())
    await lib.coatings()
    await lib.coating('2c5251bc')
    expect(fetchJson).toHaveBeenCalledTimes(2)
    expect(await lib.coating('00000000')).toBeNull()
    expect(await lib.swatch('c5e192fb')).toBe(0)
    expect(await lib.swatch('0badf00d')).toBe(1)
    expect(await lib.swatch('c5e192fb')).toBe(0)
    expect(lib.gradients.layer('0badf00d')).toBe(1)
    expect(await lib.swatch('deadbeef')).toBeNull()
    expect(loadSwatch).toHaveBeenCalledTimes(3)
    expect(console.warn).toHaveBeenCalledTimes(2)
  })

  it('dispose libère chaque géométrie une fois, et une scène arrivée après', async () => {
    let release: (o: THREE.Object3D) => void = () => {}
    const late = new Promise<THREE.Object3D>((r) => (release = r))
    const lib = new ArmorLibrary('/base', { ...fakeIO().io, loadGlb: (url) => (url.endsWith('late.glb') ? late : Promise.resolve(pieceScene())) })
    const early = (await lib.file('a.glb')) as THREE.Object3D
    const pending = lib.file('late.glb')
    // Le téléchargement est en vol quand la bibliothèque est libérée.
    await settle()
    const geometries: THREE.BufferGeometry[] = []
    early.traverse((o) => o instanceof THREE.Mesh && geometries.push(o.geometry))
    const spy = vi.spyOn(geometries[0], 'dispose')
    lib.dispose()
    expect(spy).toHaveBeenCalledTimes(1)
    const lateScene = pieceScene()
    const lateSpy = vi.fn()
    lateScene.traverse((o) => o instanceof THREE.Mesh && o.geometry.addEventListener('dispose', lateSpy))
    release(lateScene)
    expect(await pending).toBeNull()
    expect(lateSpy).toHaveBeenCalledTimes(1)
  })

  it('borne les téléchargements simultanés', async () => {
    let active = 0
    let peak = 0
    const lib = new ArmorLibrary('/base', {
      ...fakeIO().io,
      loadGlb: async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 1))
        active--
        return new THREE.Group()
      },
    })
    await Promise.all(Array.from({ length: 20 }, (_, i) => lib.file(`f${i}.glb`)))
    expect(peak).toBeLessThanOrEqual(6)
    expect(peak).toBeGreaterThan(1)
  })
})

describe('SpartanArmory', () => {
  const players: ReplaySpartan[] = [
    { xuid: '1', status: 'armor', manifest: manifest('h1') },
    { xuid: '2', status: 'armor', manifest: manifest('h1') },
    { xuid: '3', status: 'default', reason: 'private' },
  ]

  it('habit nul tant qu’il se charge, puis prêt ; même géométrie, même tenue ; armure par défaut sans manifeste', async () => {
    const { io, loadGlb } = fakeIO()
    const armory = new SpartanArmory(new ArmorLibrary('/b', io), players)
    expect(armory.dress('1')).toBeNull()
    expect(armory.dress('2')).toBeNull()
    expect(armory.dress('3')).toBeNull()
    await settle()
    const o = armory.dress('1')?.outfit
    expect(o?.skinned).toHaveLength(2)
    expect(o?.rigid.map((r) => [r.key, r.bone])).toEqual([['cccccccc', 'b_head']])
    expect(o?.issues).toEqual([])
    expect(armory.dress('2')?.outfit).toBe(o)
    expect(armory.dress('2')).not.toBe(armory.dress('1'))
    expect(armory.dress('3')).toBeNull()
    expect(loadGlb).toHaveBeenCalledTimes(3)
    // Une tenue rapportée une fois ; la peinture de chaque joueur une fois (sans revêtement : repli nommé).
    expect(console.info).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledTimes(2)
  })

  it('peint les matériaux peints de la tenue de son revêtement, chargé avec ses dégradés', async () => {
    const { io, loadSwatch } = fakeIO(new Set(), { 'piece-aaaaaaaa-11111111.glb': paintedPiece })
    const m = { ...manifest('h2'), coating: { path: 'c', style_id: 743592380, style_key: '2c5251bc' } }
    const armory = new SpartanArmory(new ArmorLibrary('/b', io), [{ xuid: '1', status: 'armor', manifest: m }])
    armory.dress('1')
    await settle()
    const dress = armory.dress('1')
    expect(dress?.coat.size).toBe(1)
    const [paint] = [...(dress?.coat.values() ?? [])]
    // Zone de base : allumée, couche 0 (le seul dégradé chargé), couleur haute du revêtement.
    expect(Array.from(paint.paint.data.slice(0, 2))).toEqual([1, 0])
    expect(paint.gradients.value).toBeInstanceOf(THREE.DataArrayTexture)
    expect(Array.from(paint.paint.data.slice(4, 7))).toEqual([expect.closeTo(0.2, 6), expect.closeTo(0.3, 6), expect.closeTo(0.4, 6)])
    expect(loadSwatch).toHaveBeenCalledTimes(1)
    expect(console.info).toHaveBeenCalledTimes(2)
  })

  it('pièce non chargée : son repli (armure par défaut de la région) est posé, l’écart nommé', async () => {
    const { io } = fakeIO(new Set(['piece-aaaaaaaa-11111111.glb']))
    const armory = new SpartanArmory(new ArmorLibrary('/b', io), players)
    armory.dress('1')
    await settle()
    const o = armory.dress('1')?.outfit
    expect(o?.skinned).toHaveLength(2)
    expect(o?.issues).toEqual([{ kind: 'piece_load_failed', what: 'aaaaaaaa-11111111', detail: 'repli aaaaaaaa-13d24f1f (default)' }])
    expect(console.warn).toHaveBeenCalled()
  })

  it('pièce aux os différents de l’index : refusée et nommée, le repli la remplace', async () => {
    const { io } = fakeIO(new Set(), { 'piece-aaaaaaaa-11111111.glb': () => pieceScene(['x', 'y', 'z']) })
    const armory = new SpartanArmory(new ArmorLibrary('/b', io), players)
    armory.dress('1')
    await settle()
    expect(armory.dress('1')?.outfit.issues.map((i) => i.kind)).toEqual(['piece_bones_mismatch', 'piece_load_failed'])
  })
})

describe('SpartanArmory armes', () => {
  /** Un modèle d'arme : un maillage peint dont la liste de style n'est pas dans la table d'armure. */
  function weaponScene(): THREE.Object3D {
    const root = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    root.add(mesh)
    mesh.material.userData = {
      armorMaps: { asg: null, mask0: null, mask1: null },
      style: { stylelist: 'f00dface', region: '0b7e328b', intentions: ['229d91fa'], layers: 1, texel_density: [1, 1], offset: [0, 0] },
    }
    return root
  }

  const joueursArmes: ReplaySpartan[] = [
    { xuid: '1', status: 'armor', manifest: manifest('h1'), weapon_coatings: [{ model_key: '11111111', style_key: '2c5251bc' }] },
  ]

  it('peindreArme : coatArme nulle en attente, le coat posé et en cache ensuite', async () => {
    const { io } = fakeIO(new Set(), {}, { 'coatings.json': tableArmes, 'coating-2c5251bc.json': coatingArmes })
    const armory = new SpartanArmory(new ArmorLibrary('/b', io), joueursArmes, undefined, '/armes', io)
    const scene = weaponScene()
    const p = armory.peindreArme('1', '11111111', scene)
    expect(armory.coatArme('1', '11111111', scene)).toBeNull()
    const coat = await p
    expect(coat?.size).toBe(1)
    expect(armory.coatArme('1', '11111111', scene)).toBe(coat)
    expect(armory.peindreArme('1', '11111111', scene)).toBe(p)
    // La peinture rapportée une fois à la console.
    expect(console.info).toHaveBeenCalledTimes(1)
  })

  it('peindreArme : without a coating for the weapon (no core), the default style of each list, cached', async () => {
    const { io } = fakeIO(new Set(), {}, { 'coatings.json': tableArmes })
    const armory = new SpartanArmory(new ArmorLibrary('/b', io), [{ xuid: '1', status: 'armor', manifest: manifest() }], undefined, '/armes', io)
    const scene = weaponScene()
    const coat = await armory.peindreArme('1', '11111111', scene)
    expect(coat?.size).toBe(1)
    expect(Array.from([...coat!.values()][0].paint.data.slice(0, 2))).toEqual([1, -1])
    expect(armory.coatArme('1', '11111111', scene)).toBe(coat)
  })

  it('peindreArme : sans bibliothèque des armes, null', async () => {
    const { io } = fakeIO()
    const armory = new SpartanArmory(new ArmorLibrary('/b', io), joueursArmes)
    expect(await armory.peindreArme('1', '11111111', weaponScene())).toBeNull()
  })

  it('coatArme : le coat ne couvre plus tous les matériaux peints du modèle, null', async () => {
    const { io } = fakeIO()
    const armory = new SpartanArmory(new ArmorLibrary('/b', io), joueursArmes, undefined, '/armes', io)
    const scene = weaponScene()
    const coat = await armory.peindreArme('1', '11111111', scene)
    const extra = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    extra.material.userData = {
      armorMaps: { asg: null, mask0: null, mask1: null },
      style: { stylelist: 'f00dface', region: '0b7e328b', intentions: ['229d91fa'], layers: 1, texel_density: [1, 1], offset: [0, 0] },
    }
    scene.add(extra)
    expect(coat).not.toBeNull()
    expect(armory.coatArme('1', '11111111', scene)).toBeNull()
  })

  /** Le revêtement d'arme `2c5251bc` : la liste `f00dface` prend le style `036e9dd8` de la table. */
  function coatingArmes(): CoatingFile {
    return { style: '2c5251bc', lists: { f00dface: '036e9dd8' }, styles: {} }
  }

  /** La table de la bibliothèque des armes : la liste `f00dface` a pour défaut `036e9dd8`, sans dégradé. */
  function tableArmes(): CoatingTable {
    return {
      schema: 1, globals: {}, default_styles: { f00dface: '036e9dd8' },
      styles: { '036e9dd8': { grime_amount: 0, scratch_amount: 0, regions: { '0b7e328b': { '229d91fa': SWATCH } } } },
      visors: { patterns: {}, colors: {} },
    }
  }

  it('peindreBras : l’arme du rig prend son revêtement, les bras celui du joueur', async () => {
    const { io, loadSwatch } = fakeIO(new Set(), { 'piece-aaaaaaaa-11111111.glb': paintedPiece }, { 'coatings.json': tableArmes })
    const m = { ...manifest('h4'), coating: { path: 'c', style_id: 1, style_key: '2c5251bc' } }
    const armory = new SpartanArmory(new ArmorLibrary('/b', io), [
      { xuid: '1', status: 'armor', manifest: m, weapon_coatings: [{ model_key: '22222222', style_key: '00000000' }] },
    ], undefined, '/armes', io)
    armory.dress('1')
    await settle()
    const habit = armory.dress('1')
    if (!habit) throw new Error('habit absent')
    const bras = [...habit.coat.keys()][0]
    const arme = (weaponScene().children[0] as THREE.Mesh).material as THREE.Material
    const paint = await armory.peindreBras('1', habit, [bras, arme], '22222222')
    expect(paint).not.toBeNull()
    expect(paint!.has(bras)).toBe(true)
    // L’arme a le revêtement demandé, absent de la bibliothèque : style par défaut, sans dégradé.
    expect(paint!.has(arme)).toBe(true)
    expect(Array.from(paint!.get(arme)!.paint.data.slice(0, 2))).toEqual([1, -1])
    // Les bras ont le revêtement du joueur, dégradé chargé.
    expect(Array.from(paint!.get(bras)!.paint.data.slice(0, 2))).toEqual([1, 0])
    expect(loadSwatch).toHaveBeenCalledTimes(1)
  })

  it('peindreBras : without an entry for the rig weapon, it wears the default style of each list', async () => {
    const { io } = fakeIO(new Set(), { 'piece-aaaaaaaa-11111111.glb': paintedPiece }, { 'coatings.json': tableArmes })
    const armory = new SpartanArmory(new ArmorLibrary('/b', io), joueursArmes, undefined, '/armes', io)
    armory.dress('1')
    await settle()
    const habit = armory.dress('1')
    if (!habit) throw new Error('habit absent')
    const bras = [...habit.coat.keys()][0]
    const arme = (weaponScene().children[0] as THREE.Mesh).material as THREE.Material
    const paint = await armory.peindreBras('1', habit, [bras, arme], '99999999')
    expect(paint).not.toBeNull()
    expect(Array.from(paint!.get(arme)!.paint.data.slice(0, 2))).toEqual([1, -1])
  })
})

describe('dressSpartan', () => {
  it('remplace l’armure par défaut, lie chaque pièce au squelette de la copie, pose l’accessoire à son os', async () => {
    const { io } = fakeIO()
    const armory = new SpartanArmory(new ArmorLibrary('/b', io), [{ xuid: '1', status: 'armor', manifest: manifest() }])
    armory.dress('1')
    await settle()
    const outfit = armory.dress('1')?.outfit
    if (!outfit) throw new Error('tenue absente')
    const { root, skeleton } = skeletonRoot()
    const legacy = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    root.add(legacy)
    legacy.bind(skeleton)

    expect(dressSpartan(root, skeleton, outfit)).toBe(true)
    expect(legacy.parent).toBeNull()
    const skinned: THREE.SkinnedMesh[] = []
    root.traverse((o) => o instanceof THREE.SkinnedMesh && skinned.push(o))
    expect(skinned).toHaveLength(2)
    expect(skinned.every((s) => s.skeleton === skeleton)).toBe(true)
    // Géométrie partagée avec la bibliothèque, jamais recopiée.
    expect(skinned.map((s) => s.geometry)).toEqual(outfit.skinned.map((s) => s.geometry))
    const head = skeleton.bones[2]
    root.updateMatrixWorld(true)
    const rigid = head.children[0].children[0].children[0] as THREE.Mesh
    expect(rigid.geometry).toBe(outfit.rigid[0].meshes[0].mesh.geometry)
    // Tête à 0,3 (os en chaîne), instance à +0,2, maillage à +0,5 en z dans son GLB.
    expect(rigid.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([0, expect.closeTo(0.5, 6), expect.closeTo(0.5, 6)])
  })

  it('squelette d’autres os : refusé, la copie garde son armure', async () => {
    const { io } = fakeIO()
    const armory = new SpartanArmory(new ArmorLibrary('/b', io), [{ xuid: '1', status: 'armor', manifest: manifest() }])
    armory.dress('1')
    await settle()
    const { root, skeleton } = skeletonRoot(['a', 'b', 'c'])
    const legacy = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    root.add(legacy)
    const outfit = armory.dress('1')?.outfit
    if (!outfit) throw new Error('tenue absente')
    expect(dressSpartan(root, skeleton, outfit)).toBe(false)
    expect(legacy.parent).toBe(root)
  })
})
