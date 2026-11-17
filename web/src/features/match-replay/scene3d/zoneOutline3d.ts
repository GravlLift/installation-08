// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'

/** A logical zone's flat outline, with no filled surface or volume. */
export function zoneOutlineGeometry(family: 'box' | 'cylinder'): THREE.BufferGeometry {
  if (family === 'cylinder') return new THREE.RingGeometry(0.96, 1, 64).rotateX(-Math.PI / 2)
  const shape = new THREE.Shape().moveTo(-0.5, -0.5).lineTo(0.5, -0.5).lineTo(0.5, 0.5).lineTo(-0.5, 0.5).lineTo(-0.5, -0.5)
  const hole = new THREE.Path().moveTo(-0.48, -0.48).lineTo(-0.48, 0.48).lineTo(0.48, 0.48).lineTo(0.48, -0.48).lineTo(-0.48, -0.48)
  shape.holes.push(hole)
  return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2)
}

/** A wall open around the perimeter, with no ceiling or floor. */
export function zoneWallGeometry(family: 'box' | 'cylinder'): THREE.BufferGeometry {
  if (family === 'cylinder') return new THREE.CylinderGeometry(1, 1, 1, 64, 1, true).translate(0, 0.5, 0)
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const index = geometry.getIndex()!
  geometry.setIndex([...Array.from({ length: 12 }, (_, i) => index.getX(i)), ...Array.from({ length: 12 }, (_, i) => index.getX(i + 24))])
  geometry.clearGroups()
  return geometry.translate(0, 0.5, 0)
}
