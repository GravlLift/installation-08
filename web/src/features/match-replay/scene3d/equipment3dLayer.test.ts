/**
 * The equipment layer draws each effect in use at the frames the document dates, and nothing
 * outside them: the thruster exhaust, the drop wall standing then dissolving, the shroud screen's
 * bubble and the grapple hook, counted as instances in the scene on a hand-built document. The
 * repulsor draws nothing (its use is an arm animation). In first person, no exhaust in the viewer's
 * face and the cable leaves the viewer's left hand.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { testReplayDoc } from '../test/testDoc'
import type { Action3dInputs } from './action3dInputs'
import type { ActionContext } from './actionScene3d'
import { AIDS3D_DEFAULT } from './aids3d'
import { WALL_PANEL_COUNT } from './dropWall3d_logic'
import { Equipment3dLayer } from './equipment3d'
import { SHROUD_BUBBLE_RADIUS_U } from './shroud3d_logic'

const doc = testReplayDoc({
  frameCount: 1000,
  frameIntervalMs: 100,
  // A life that runs along +Y over its first 20 s, then stands.
  tracks: [
    {
      slot: 3,
      team: 0,
      startFrame: 0,
      endFrame: 999,
      points: [
        { t: 0, x: 0, y: 0 },
        { t: 200, x: 0, y: 20 },
        { t: 999, x: 0, y: 20 },
      ],
    },
  ],
  abilityLabels: {
    '6': { fr: 'Répulseur', en: 'Repulsor', family: 'repulsor' },
    '8': { fr: 'Écran occultant', en: 'Shroud screen', family: 'shroud_screen' },
  },
  abilityImpulses: [{ t: 100, slot: 3, family: 'thruster' }],
  equipmentPlacements: [
    { family: 'wall', id: '0x528fce46', origin: 'deployed', owner: 3, t0: 300, t1: 301, x: 0, y: 20, z: 0, h: 90, lifeEnd: 340 },
  ],
  carriedEquipment: [
    { slot: 3, r: 6, t0: 0, uses: [500] },
    { slot: 3, r: 8, t0: 0, uses: [800], tracked: [{ t0: 800, land: 805, x: 0, y: 20, z: 0, effect: { t0: 806, t1: 880, x: 0, y: 20, z: 0.5 } }] },
  ],
  grappleLines: [{ slot: 3, t0: 700, t1: 720, ax: 5, ay: 25, az: 1 }],
})

/** Ink names only: the stub ink cache below resolves every one to the same three color. */
const inks = {
  grapple: 'ink-grapple',
  wall: 'ink-wall',
  rift: { rim: 'ink-rift-rim', core: 'ink-rift-core' },
  shroud: { core: 'ink-shroud-core', glow: 'ink-shroud-glow' },
  fx: { core: 'ink-fx-core', tint: {} },
  floor: { edge: 'ink-floor-edge' },
}

/** The first-person viewer's left hand in the stub scene (three axes). */
const FP_HAND = new THREE.Vector3(100, 1, 100)

function layer(firstPerson = false): { layer: Equipment3dLayer; root: THREE.Group } {
  const root = new THREE.Group()
  const color = new THREE.Color(1, 0, 0)
  const inputs = { show: { placements: true }, aids: AIDS3D_DEFAULT, inks, colorOfSlot: () => 'ink-team' } as unknown as Action3dInputs
  const ctx = {
    doc,
    root,
    originAboveFloor: 0.3,
    ground: { floorY: () => 0 },
    ink: { of: () => color },
    inputs: () => inputs,
    slotState: (slot: number) => (slot === 3 ? { x: 0, y: 20, z: 0.3, h: 90, p: 0, crouch: false, dropOeil: 0, slot } : null),
    firstPersonSlot: () => (firstPerson ? 3 : null),
    firstPersonLeftHand: (out: THREE.Vector3) => out.copy(FP_HAND),
  } as unknown as ActionContext
  return { layer: new Equipment3dLayer(ctx), root }
}

/** The instances the layer has posed at the last update, all pools together, and the visible plain meshes (the bubbles). */
function instances(root: THREE.Group): number {
  let n = 0
  root.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) n += o.count
    else if (o instanceof THREE.Mesh && o.visible) n += 1
  })
  return n
}

/** The positions of every posed instance (three axes). */
function positions(root: THREE.Group): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  const m = new THREE.Matrix4()
  root.traverse((o) => {
    if (!(o instanceof THREE.InstancedMesh)) return
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m)
      out.push(new THREE.Vector3().setFromMatrixPosition(m))
    }
  })
  return out
}

describe('Equipment3dLayer — each effect at its dated frames', () => {
  const { layer: l, root } = layer()
  const at = (frame: number) => {
    l.update(frame)
    return instances(root)
  }

  it('draws nothing between the effects', () => {
    expect(at(50)).toBe(0)
    expect(at(400)).toBe(0)
  })

  it('the thruster exhaust: a flame and its core, during the dash only', () => {
    expect(at(102)).toBe(2)
    expect(at(106)).toBe(0)
  })

  it('the drop wall: its panels and their top edges, standing then dissolving, then gone', () => {
    expect(at(299)).toBe(0)
    expect(at(320)).toBe(2 * WALL_PANEL_COUNT)
    expect(at(341.5)).toBe(2 * WALL_PANEL_COUNT)
    expect(at(344)).toBe(0)
  })

  it('the repulsor: nothing in the world at its activation', () => {
    expect(at(502)).toBe(0)
  })

  it('the shroud screen: one opaque bubble from its birth to its deletion, centered on it', () => {
    expect(at(805)).toBe(0)
    expect(at(850)).toBe(1)
    let bubble: THREE.Mesh | null = null
    root.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && o.visible) bubble = o
    })
    const b = bubble as unknown as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
    expect(b.position.toArray()).toEqual([0, 0.5, -20])
    expect(b.scale.x).toBeCloseTo(SHROUD_BUBBLE_RADIUS_U)
    expect(b.material.depthWrite).toBe(true)
    expect(b.material.transparent).toBe(false)
    expect(b.material.side).toBe(THREE.DoubleSide)
    expect(at(881)).toBe(0)
  })

  it('the grapple: the wire and the hook, during the pull', () => {
    expect(at(699)).toBe(0)
    expect(at(710)).toBe(2)
    expect(at(721)).toBe(0)
  })

  it('seeking back gives the same picture', () => {
    const forward = at(320)
    at(710)
    expect(at(320)).toBe(forward)
  })
})

describe('Equipment3dLayer — in the carrier\'s own first-person view', () => {
  const { layer: l, root } = layer(true)
  const at = (frame: number) => {
    l.update(frame)
    return instances(root)
  }

  it('draws no thruster exhaust in the viewer\'s face', () => {
    expect(at(102)).toBe(0)
  })

  it('the cable leaves the viewer\'s left hand', () => {
    at(715)
    // The wire is one segment posed at its middle; attached, it runs from the hand to the anchor.
    const anchor = new THREE.Vector3(5, 1, -25)
    const mid = FP_HAND.clone().add(anchor).multiplyScalar(0.5)
    expect(positions(root).some((p) => p.distanceTo(mid) < 1e-6)).toBe(true)
  })
})
