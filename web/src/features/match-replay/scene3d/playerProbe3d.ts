// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * playerProbe3d.ts — PLAYERS' ENVIRONMENT PROBE: a player's armor carries the map's closest probe
 * to their position, like the surface they are standing on (`lighting.assignProbes`) — reflections
 * off, `envMap` null, like the map.
 *
 * The assignment repeats every frame, with no write when the probe is already carried: a change
 * between two probes of the same kind does not recompile the material; only the probe <-> no-probe
 * toggle does (`needsUpdate`).
 */
import * as THREE from 'three'

import { ENV_INTENSITY } from './lighting'

/**
 * assignPlayerProbe gives `material` probe `probe` (null: reflections off), without rewriting a
 * material that already carries it.
 */
export function assignPlayerProbe(material: THREE.Material, probe: THREE.Texture | null): void {
  if (!(material instanceof THREE.MeshStandardMaterial)) return
  if (material.envMap === probe) return
  const toggled = material.envMap === null ? probe !== null : probe === null
  material.envMap = probe
  if (probe) material.envMapIntensity = ENV_INTENSITY
  if (toggled) material.needsUpdate = true
}

/** assignPlayerProbes: `assignPlayerProbe` on every material of `materials`. */
export function assignPlayerProbes(materials: readonly THREE.Material[], probe: THREE.Texture | null): void {
  for (const material of materials) assignPlayerProbe(material, probe)
}
