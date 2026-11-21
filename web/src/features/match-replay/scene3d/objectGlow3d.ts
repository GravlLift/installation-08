// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * objectGlow3d.ts — LIGHTS WHOSE COLOR A PLACED OBJECT DRIVES.
 *
 * Some game materials take their light's color from an object input instead of a constant: the
 * build keeps that mapping in the material's extras (`emissionObject`: the input's StringID and
 * the mapping's raw bytes, himap `emissif_fonctions.go`). The material's own still color is the
 * mapping's first color, so a surface whose object does not drive the input keeps it.
 *
 * The equipment pad is one: its device (`mach` 58f5b4af, model `mode` ec6cf1a4) exports input
 * 4a2c3a6a from a function with no import and a default of 1 (pinned by
 * `internal/weapons/pad_device_gamefiles_test.go`), and its lit materials map that input from
 * orange / dark red at 0 to blue at 1. A placed pad is found by the variant layer's object table
 * (`levelupObjects`, boxes in game axes), as `markerObjects3d` finds its marker objects.
 */
import * as THREE from 'three'

/** One object-driven color mapping, as the build writes it. */
export interface ObjectGlowSpec {
  entree: number
  /** The mapping's bytes: base64 (Go's []byte in JSON) or a plain byte list. */
  donnees: string | number[]
}

/**
 * The inputs a placed object's type sets, by Forge object type (unsigned) then input StringID.
 * The equipment pad (Forge type e42158df) places the pad device whose function exports 4a2c3a6a
 * with no import and a default of 1: the input never moves, so the pad stays at its mapping's end.
 */
export const OBJECT_INPUTS: ReadonlyMap<number, ReadonlyMap<number, number>> = new Map([
  [0xe42158df, new Map([[0x4a2c3a6a, 1]])],
])

function bytesOf(d: string | number[]): Uint8Array | null {
  if (Array.isArray(d)) return Uint8Array.from(d)
  if (typeof d !== 'string') return null
  try {
    const s = atob(d)
    const out = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/** linear: an ARGB word's color as linear RGB (the build stores its still colors linear). */
function linear(argb: number): [number, number, number] {
  const c = new THREE.Color().setHex(argb & 0xffffff, THREE.SRGBColorSpace)
  return [c.r, c.g, c.b]
}

/**
 * colorMapping decodes a color mapping into a function of its input (0..1) giving linear RGB;
 * null for a mapping it does not read. Byte 2 is the color count; the header words at +4, +8,
 * +12 and +16 are ARGB colors. A three-color mapping uses slots 0, 1 and 3 (slot 3 is always the
 * end color; slot 2 is unset, alpha 0, in both pad materials) at inputs 0, 0.5 and 1. Other counts
 * are not read yet: their surfaces keep their still color.
 * Between the stops the colors are interpolated linearly in linear RGB (an inference: only the
 * end stops are drawn today, the pad's input is 1).
 */
export function colorMapping(spec: ObjectGlowSpec): ((input: number) => [number, number, number]) | null {
  const b = bytesOf(spec.donnees)
  if (!b || b.length < 20 || b[0] !== 0 || b[2] !== 3) return null
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const word = (o: number) => view.getUint32(o, true)
  const stops = [word(4), word(8), word(16)].map(linear)
  return (input) => {
    const x = Math.min(Math.max(input, 0), 1) * 2
    const i = Math.min(Math.floor(x), 1)
    const t = x - i
    const [a, c] = [stops[i], stops[i + 1]]
    return [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t]
  }
}

/** readObjectGlow: a material's object-driven color mappings, null without any. */
export function readObjectGlow(extras: { emissionObject?: unknown } | undefined): ObjectGlowSpec[] | null {
  const list = extras?.emissionObject
  if (!Array.isArray(list)) return null
  const specs = list.filter((s): s is ObjectGlowSpec => !!s && typeof s === 'object' && typeof (s as ObjectGlowSpec).entree === 'number')
  return specs.length > 0 ? specs : null
}

interface PlacedObject {
  type: number
  min: [number, number, number]
  max: [number, number, number]
}

// A surface's center is inside its object's box, within the publication's rounding.
const BOX_SLACK = 0.05

/**
 * objectInputsAt: the inputs the placed object holding a surface sets, the surface given by its
 * world box center in three axes; null when no driving object holds it.
 */
export function objectInputsAt(objects: unknown, center: THREE.Vector3): ReadonlyMap<number, number> | null {
  if (!Array.isArray(objects)) return null
  // three axes (x, y up, z) to game axes (x, -z, y up).
  const [x, y, z] = [center.x, -center.z, center.y]
  for (const o of objects as PlacedObject[]) {
    const inputs = OBJECT_INPUTS.get(o.type >>> 0)
    if (!inputs || !Array.isArray(o.min) || !Array.isArray(o.max)) continue
    if (x < o.min[0] - BOX_SLACK || x > o.max[0] + BOX_SLACK) continue
    if (y < o.min[1] - BOX_SLACK || y > o.max[1] + BOX_SLACK) continue
    if (z < o.min[2] - BOX_SLACK || z > o.max[2] + BOX_SLACK) continue
    return inputs
  }
  return null
}

/**
 * drivenColor: the light color a material takes under `inputs`, null when none of its mappings
 * is driven there (it keeps its still color).
 */
export function drivenColor(specs: readonly ObjectGlowSpec[], inputs: ReadonlyMap<number, number>): [number, number, number] | null {
  for (const s of specs) {
    const v = inputs.get(s.entree >>> 0)
    if (v === undefined) continue
    const f = colorMapping(s)
    if (f) return f(v)
  }
  return null
}

/**
 * objectDrivenSources returns a function giving a surface the source material it is placed from:
 * the GLB's own, or, when a placed object drives its light's color, a copy with that color (one
 * copy per source and color, so every pad shares one).
 */
export function objectDrivenSources(scene: THREE.Object3D): (mesh: THREE.Mesh, source: THREE.MeshStandardMaterial) => THREE.MeshStandardMaterial {
  const objects = scene.userData?.levelupObjects
  if (!Array.isArray(objects) || objects.length === 0) return (_mesh, source) => source
  let updated = false
  const copies = new Map<string, THREE.MeshStandardMaterial>()
  const box = new THREE.Box3()
  const center = new THREE.Vector3()
  return (mesh, source) => {
    const specs = readObjectGlow(source.userData)
    if (!specs) return source
    if (!updated) {
      scene.updateMatrixWorld(true)
      updated = true
    }
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld).getCenter(center)
    const inputs = objectInputsAt(objects, center)
    const color = inputs && drivenColor(specs, inputs)
    if (!color) return source
    const key = `${source.uuid}|${color.map((v) => v.toFixed(5)).join(',')}`
    let copy = copies.get(key)
    if (!copy) {
      copy = source.clone()
      copy.emissive.setRGB(color[0], color[1], color[2], THREE.LinearSRGBColorSpace)
      copies.set(key, copy)
    }
    return copy
  }
}
