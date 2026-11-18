// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import type { Dress } from './armory3d'
import { verticalFovOf, viewmodelScale } from '../model/fovLogic'
import { FirstPersonArms3d, isArmMaterial, isPaintedMaterial, samePaint, paintArmMaterial } from './firstPersonArms3d'
import { LoadGate } from './loadGate3d'
import type { FirstPersonFrameEvents } from './firstPersonActions3d'
import type { FirstPersonRig } from './firstPersonRig3d'

// A rig download that never settles: a rig left mid-load stays in-flight, which the gate test needs.
const { fetchMesh } = vi.hoisted(() => ({ fetchMesh: vi.fn(() => new Promise<void>(() => {})) }))
vi.mock('./meshFetch', () => ({ fetchMesh }))

describe('isArmMaterial', () => {
  it('recognizes the raw surface without picking up the weapon\'s materials', () => {
    const arm = new THREE.MeshStandardMaterial()
    arm.userData.surfaceBrute = { asg: 0 }
    expect(isArmMaterial(arm)).toBe(true)
    const weapon = new THREE.MeshStandardMaterial()
    expect(isArmMaterial(weapon)).toBe(false)
    arm.map = new THREE.Texture()
    expect(isArmMaterial(arm)).toBe(false)
    expect(isArmMaterial(new THREE.MeshBasicMaterial())).toBe(false)
  })

  it('a raw rig weapon material (rigWeapon) is painted but is not an arm', () => {
    const weapon = new THREE.MeshStandardMaterial()
    weapon.userData.surfaceBrute = { asg: 0 }
    weapon.userData.rigWeapon = true
    expect(isPaintedMaterial(weapon)).toBe(true)
    expect(isArmMaterial(weapon)).toBe(false)
    const arm = new THREE.MeshStandardMaterial()
    arm.userData.surfaceBrute = { asg: 0 }
    expect(isPaintedMaterial(arm)).toBe(true)
    expect(isArmMaterial(arm)).toBe(true)
  })
})


describe('counter-scaling the holder to the camera field', () => {
  it('keeps the projection tuned at 55° and does not scale depth', () => {
    // The arm catalog is unreachable in tests: silence the fallback warning.
    const silence = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scene = new THREE.Scene()
    const arms = new FirstPersonArms3d(scene, '/first-person')
    const holder = scene.children[0]
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    arms.place(camera)
    expect(holder.scale.x).toBe(1)
    expect(holder.scale.y).toBe(1)
    expect(holder.scale.z).toBe(1)
    const large = verticalFovOf(120)
    camera.fov = large
    arms.place(camera)
    const scale = viewmodelScale(large, 55)
    expect(holder.scale.x).toBeCloseTo(scale, 6)
    expect(holder.scale.y).toBeCloseTo(scale, 6)
    expect(holder.scale.z).toBe(1)
    arms.dispose()
    silence.mockRestore()
  })
})

describe('loadedRoots', () => {
  it('returns the roots of loaded rigs, empty with no rig loaded', () => {
    // The arm catalog is unreachable in tests: silence the fallback warning.
    const silence = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scene = new THREE.Scene()
    const arms = new FirstPersonArms3d(scene, '/first-person')
    expect(arms.loadedRoots()).toEqual([])
    arms.dispose()
    silence.mockRestore()
  })

  it('prepares every loaded rig and waits for each one\'s pieces before painting', () => {
    const silence = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const arms = new FirstPersonArms3d(new THREE.Scene(), '/first-person')
    const internal = arms as unknown as {
      entries: Map<string, { root: THREE.Object3D } | null>
      dressing: { refresh: (f: string, r: THREE.Object3D) => void; busy: (f: string) => boolean }
      paint: { refresh: (f: string, r: THREE.Object3D) => void }
    }
    const a = new THREE.Group(), b = new THREE.Group()
    internal.entries.set('a', { root: a })
    internal.entries.set('b', { root: b })
    const dress = vi.spyOn(internal.dressing, 'refresh').mockImplementation(() => {})
    vi.spyOn(internal.dressing, 'busy').mockImplementation((f) => f === 'b')
    const paint = vi.spyOn(internal.paint, 'refresh').mockImplementation(() => {})
    arms.prepareRig()
    expect(dress).toHaveBeenCalledTimes(2)
    expect(paint).toHaveBeenCalledOnce()
    expect(paint).toHaveBeenCalledWith('a', a)
    internal.entries.clear()
    arms.dispose()
    silence.mockRestore()
  })
})

describe("show: the rig shows exactly as it is, never falling back to the static model while painting is pending", () => {
  /** A null frame: `show` only reads the camera and the rig. */
  const events = {
    reloads: [], strikes: [], shots: [], grenades: [], weaponSwitches: [], sprints: [],
    slides: [], crouches: [], jumps: [], climbs: [], usages: [], frame: 0, fps: 30,
    reloadValid: () => false,
  } as unknown as FirstPersonFrameEvents

  /** The loaded rig: a root with an arm material and a playable idle clip. */
  function setupLoadedRig(file: string, arms: FirstPersonArms3d): THREE.Group {
    const material = new THREE.MeshStandardMaterial()
    material.userData.surfaceBrute = {}
    const root = new THREE.Group()
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), material))
    const clip = {
      name: 'idle', action: 'idle', variant: 0, type: 'base', overlay: false,
      frameCount: 60, frameRate: 30, durationSeconds: 2,
    }
    const rig = { file, bones: 1, triangles: 1, bytes: 1, clips: [clip], actions: [{ action: 'idle', variant: 0, clip: 'idle' }], missingActions: [] } as unknown as FirstPersonRig
    const idle = { time: 0, weight: 1 }
    const internal = arms as unknown as {
      entries: Map<string, unknown>
      weapons: Map<string, unknown>
      weaponFiles: Map<string, string>
      dressing: { refresh: (f: string, r: THREE.Object3D) => void; busy: (f?: string) => boolean }
      paint: { refresh: (f: string, r: THREE.Object3D) => void; busy: (f?: string) => boolean }
      xuid: string | null
      armory: { pending: (x: string) => boolean; regions: (x: string) => unknown; dress: (x: string) => unknown } | null
    }
    internal.entries.set(file, { root, materials: [material], mixer: { update: () => {} }, rig, actions: new Map([[clip.name, idle]]), actionList: [idle], clip })
    internal.weapons.set('weapon', rig)
    internal.weaponFiles.set(file, 'weapon')
    return root
  }

  function armsScene(): { arms: FirstPersonArms3d; internal: { dressing: { busy: (f?: string) => boolean }; paint: { busy: (f?: string) => boolean }; xuid: string | null; armory: { pending: (x: string) => boolean; regions: (x: string) => unknown; dress: (x: string) => unknown } | null } } {
    const silence = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const arms = new FirstPersonArms3d(new THREE.Scene(), '/first-person')
    const internal = arms as unknown as ReturnType<typeof armsScene>['internal']
    ;(arms as unknown as { dispose: () => void }).dispose = () => { silence.mockRestore() }
    return { arms, internal }
  }

  it('shows the rig (true) while painting is in progress, with the coating applied', () => {
    const { arms, internal } = armsScene()
    const root = setupLoadedRig('a.glb', arms)
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    internal.paint.busy = () => true
    expect(arms.show(camera, 'weapon', events, null)).toBe(true)
    expect(root.visible).toBe(true)
  })

  it('shows the rig (true) while pieces are in progress, with the default embedded arms', () => {
    const { arms, internal } = armsScene()
    const root = setupLoadedRig('a.glb', arms)
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    internal.dressing.busy = () => true
    expect(arms.show(camera, 'weapon', events, null)).toBe(true)
    expect(root.visible).toBe(true)
  })

  it('shows the rig (true) with no armor loaded, without waiting on the armory', () => {
    const { arms, internal } = armsScene()
    setupLoadedRig('a.glb', arms)
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    internal.xuid = '1'
    internal.armory = { pending: () => true, regions: () => null, dress: () => null }
    expect(arms.show(camera, 'weapon', events, null)).toBe(true)
  })
})

describe('gate: first-person rig loading', () => {
  const events = {
    reloads: [], strikes: [], shots: [], grenades: [], weaponSwitches: [], sprints: [],
    slides: [], crouches: [], jumps: [], climbs: [], usages: [], frame: 0, fps: 30,
    reloadValid: () => false,
  } as unknown as FirstPersonFrameEvents

  function armsWithWeapon(gate: LoadGate): { arms: FirstPersonArms3d; internal: { weapons: Map<string, unknown>; weaponFiles: Map<string, string>; indexReady: boolean } } {
    const arms = new FirstPersonArms3d(new THREE.Scene(), '/first-person', gate)
    const clip = {
      name: 'idle', action: 'idle', variant: 0, type: 'base', overlay: false,
      frameCount: 60, frameRate: 30, durationSeconds: 2,
    }
    const rig = { file: 'a.glb', bones: 1, triangles: 1, bytes: 1, clips: [clip], actions: [{ action: 'idle', variant: 0, clip: 'idle' }], missingActions: [] } as unknown as FirstPersonRig
    const internal = arms as unknown as { weapons: Map<string, unknown>; weaponFiles: Map<string, string>; indexReady: boolean }
    internal.weapons.set('weapon', rig)
    internal.weaponFiles.set('a.glb', 'weapon')
    internal.indexReady = true
    return { arms, internal }
  }

  it('does not start the preload until it is armed (the gate idle)', () => {
    const silence = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const gate = new LoadGate()
    const { arms } = armsWithWeapon(gate)
    fetchMesh.mockClear()
    // Recording the preload starts no download...
    arms.preload(['weapon'])
    expect(fetchMesh).not.toHaveBeenCalled()
    // ...until the gate-idle trigger arms it.
    arms.armPreload()
    expect(fetchMesh).toHaveBeenCalledTimes(1)
    arms.dispose()
    silence.mockRestore()
  })

  it('shows a rig gated, even if the preload only recorded it', () => {
    const silence = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const gate = new LoadGate()
    const { arms } = armsWithWeapon(gate)
    arms.preload(['weapon'])
    // The constructor already tracks the bras.json index load, so measure the rig's delta.
    const base = gate.pending
    // Showing the rig loads it, gated.
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    expect(arms.show(camera, 'weapon', events, null)).toBe(false)
    expect(gate.pending - base).toBe(1)
    arms.dispose()
    silence.mockRestore()
  })
})

describe('arm painting', () => {
  it('keeps the fallback with no outfit, style, or masks, and excludes weapons', () => {
    const arm = new THREE.MeshStandardMaterial()
    const outfit = {} as Dress
    arm.userData.surfaceBrute = {}
    expect(paintArmMaterial(arm, outfit)).toBe(false)
    arm.userData.style = {}
    expect(paintArmMaterial(arm, outfit)).toBe(false)
    arm.userData.armorMaps = {}
    expect(paintArmMaterial(arm, null)).toBe(false)
    expect(paintArmMaterial(arm, outfit)).toBe(true)
    arm.map = new THREE.Texture()
    expect(paintArmMaterial(arm, outfit)).toBe(false)
  })

  it('identifies the cache by file and outfit identity', () => {
    const outfit = {} as Dress
    expect(samePaint('a', 'a', outfit, outfit)).toBe(true)
    expect(samePaint('a', 'b', outfit, outfit)).toBe(false)
    expect(samePaint('a', 'a', outfit, {} as Dress)).toBe(false)
    expect(samePaint('a', 'a', null, outfit)).toBe(false)
  })
})
