// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** GLB lamps, distributed on a shadowless world grid by clusteredLights. */
import * as THREE from 'three'

export interface PlacedLight {
  kind: 'omni' | 'spot'
  /** three's coordinate frame. */
  position: THREE.Vector3
  direction: THREE.Vector3
  color: THREE.Color
  energy: number
  range: number
  /** Full cone angles, in degrees. */
  cone: [number, number]
}

interface LightExtras {
  type?: string
  position?: number[]
  direction?: number[]
  color?: number[]
  energy?: number
  range?: number
  cone?: number[]
}

const halo = (v: number[]) => new THREE.Vector3(v[0], v[2], -v[1])

/** readPlacedLights reads the lamps published in the scene's extras; [] with no lamps. */
export function readPlacedLights(extras: unknown): PlacedLight[] {
  const list = (extras as { levelupLights?: LightExtras[] } | null)?.levelupLights
  if (!Array.isArray(list)) return []
  const out: PlacedLight[] = []
  for (const l of list) {
    if ((l.type !== 'omni' && l.type !== 'spot') || !l.position || !l.color || !(l.range! > 0) || !(l.energy! > 0)) continue
    out.push({
      kind: l.type,
      position: halo(l.position),
      direction: halo(l.direction ?? [0, 0, -1]).normalize(),
      color: new THREE.Color(l.color[0], l.color[1], l.color[2]),
      energy: l.energy!,
      range: l.range!,
      cone: [l.cone?.[0] ?? 0, l.cone?.[1] ?? 90],
    })
  }
  return out
}
