/** Lampes du GLB, distribuées en grille mondiale sans ombre par clusteredLights. */
import * as THREE from 'three'

export interface PlacedLight {
  kind: 'omni' | 'spot'
  /** Repère three. */
  position: THREE.Vector3
  direction: THREE.Vector3
  color: THREE.Color
  energy: number
  range: number
  /** Cônes entiers, en degrés. */
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

/** readPlacedLights lit les lampes publiées dans les extras de la scène ; [] sans lampes. */
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
