// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shroud3d.ts — THE SHROUD SCREEN'S BUBBLE DRAWN: a luminous blue sphere covered with hexagonal
 * cells, brightening to a cyan-white rim at its silhouette (`shroud3d_logic` gives its place,
 * radius and the constants of its game material).
 *
 * WHAT IS THE GAME'S. The colors are the material's (`layers/shroudInk.ts`: body = its emissive
 * color, rim = its fresnel color, cell border = its lightest blue), passed in by the layer: no
 * color is written here. The hexagon lattice reproduces the material's hexagon mask texture
 * (bitm 0x215a8ad8, its red channel: the cell border) with that texture's repeats, so the cells
 * have the game's count and border width; the rim follows the material's fresnel constants.
 *
 * WHAT IS NOT READ. The material has more layers (scrolling cloud, wisp, sparkle and scanline
 * textures, an intersection glow where the bubble meets the ground) whose animation and mixing
 * live in its compiled shader, not in readable constants: they are not drawn rather than guessed.
 *
 * TWO FACES, TWO RULES. The outer face (front faces) is slightly translucent, so players inside
 * show as faint silhouettes (`SHROUD_OUTER_OPACITY`, matched to an in-game reference); the inner
 * face (back faces) is opaque and depth-writing: from outside it hides the world behind the
 * bubble, and a camera inside sees only the wall around it.
 */
import * as THREE from 'three'

import {
  SHROUD_FRESNEL,
  SHROUD_HEX_BORDER,
  SHROUD_HEX_CELLS,
  SHROUD_HEX_TILING,
  SHROUD_OUTER_OPACITY,
  type ShroudBubble,
} from './shroud3d_logic'

/** Most bubbles up at once (each shroud screen lasts 7.5 s; beyond, a bubble is skipped). */
const CAPACITY = 8

/** Sphere tessellation: enough segments that the 20 cells around stay round at close range. */
const SEGMENTS_AROUND = 64
const SEGMENTS_DOWN = 32

/** The bubble's three inks, as the layer resolves them. */
export interface ShroudColors {
  body: THREE.Color
  rim: THREE.Color
  cell: THREE.Color
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewPos;
varying float vInside;
void main() {
  vUv = uv;
  // The camera sits at the view-space origin: it is inside the bubble when nearer its center than its radius.
  vec3 center = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vInside = step(length(center), length((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz));
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vNormalView = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`

const FRAGMENT = /* glsl */ `
uniform vec3 uBody;
uniform vec3 uRim;
uniform vec3 uCell;
uniform vec2 uTiling;
uniform vec2 uCells;
uniform vec2 uBorder;
uniform vec3 uFresnel;
uniform float uOpacity;
uniform float uOuter;
varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewPos;
varying float vInside;

// Rows of a pointy-top hexagon lattice whose columns are one unit apart.
const float ROW_PITCH = 0.8660254;

// Distance from a point to the nearest edge of its hexagonal cell, in column pitches (0 on the
// edge, 0.5 at the center across the flat sides).
float hexEdge(vec2 p) {
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 q = abs(g);
  return 0.5 - max(dot(q, normalize(r)), q.x);
}

void main() {
  vec2 p = vUv * uTiling * uCells;
  p.y *= ROW_PITCH;
  float e = hexEdge(p);
  float aa = fwidth(e);
  float border = smoothstep(uBorder.x - aa, uBorder.x + aa, e) * (1.0 - smoothstep(uBorder.y - aa, uBorder.y + aa, e));
  // Seen from outside, the inner wall shows only through the outer face: its cells would draw a
  // second, ghost lattice, so they are drawn only for a camera inside. (three draws a back-side
  // material by flipping the front face, so gl_FrontFacing cannot tell the two faces apart.)
  border *= max(uOuter, vInside);
  float facing = abs(dot(normalize(vNormalView), normalize(-vViewPos)));
  float rim = pow(clamp((1.0 - facing - uFresnel.x) / (uFresnel.y - uFresnel.x), 0.0, 1.0), uFresnel.z);
  vec3 col = mix(mix(uBody, uCell, border), uRim, rim);
  gl_FragColor = vec4(col, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** The uniforms one bubble's two faces share. */
function bubbleUniforms(): Record<string, THREE.IUniform> {
  return {
    uBody: { value: new THREE.Color() },
    uRim: { value: new THREE.Color() },
    uCell: { value: new THREE.Color() },
    uTiling: { value: new THREE.Vector2(...SHROUD_HEX_TILING) },
    uCells: { value: new THREE.Vector2(...SHROUD_HEX_CELLS) },
    uBorder: { value: new THREE.Vector2(SHROUD_HEX_BORDER.from, SHROUD_HEX_BORDER.to) },
    uFresnel: { value: new THREE.Vector3(SHROUD_FRESNEL.min, SHROUD_FRESNEL.max, SHROUD_FRESNEL.exponent) },
  }
}

/** One face of the bubble: the outer face translucent, the inner face opaque. */
function faceMaterial(uniforms: Record<string, THREE.IUniform>, outer: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { ...uniforms, uOpacity: { value: outer ? SHROUD_OUTER_OPACITY : 1 }, uOuter: { value: outer ? 1 : 0 } },
    side: outer ? THREE.FrontSide : THREE.BackSide,
    depthWrite: true,
    depthTest: true,
    transparent: outer,
  })
}

type Face = THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>

export class Shroud3d {
  private readonly parent: THREE.Object3D
  private readonly geometry = new THREE.SphereGeometry(1, SEGMENTS_AROUND, SEGMENTS_DOWN)
  private readonly bubbles: THREE.Group[] = []
  private n = 0

  constructor(parent: THREE.Object3D) {
    this.parent = parent
  }

  begin(): void {
    this.n = 0
  }

  end(): void {
    for (let i = this.n; i < this.bubbles.length; i++) this.bubbles[i].visible = false
  }

  dispose(): void {
    for (const g of this.bubbles) {
      for (const f of g.children as Face[]) f.material.dispose()
      this.parent.remove(g)
    }
    this.bubbles.length = 0
    this.geometry.dispose()
  }

  /** count — the bubbles drawn since `begin` (tests). */
  get count(): number {
    return this.n
  }

  /** bubble — one bubble centered on `center` (three axes) at its state, in its three inks. */
  bubble(center: THREE.Vector3, b: ShroudBubble, colors: ShroudColors): void {
    if (this.n >= CAPACITY || !(b.radius > 0)) return
    const g = this.bubbles[this.n] ?? this.add()
    this.n++
    g.visible = true
    g.position.copy(center)
    g.scale.setScalar(b.radius)
    const u = (g.children[0] as Face).material.uniforms
    ;(u.uBody.value as THREE.Color).copy(colors.body)
    ;(u.uRim.value as THREE.Color).copy(colors.rim)
    ;(u.uCell.value as THREE.Color).copy(colors.cell)
  }

  private add(): THREE.Group {
    const uniforms = bubbleUniforms()
    const g = new THREE.Group()
    g.add(new THREE.Mesh(this.geometry, faceMaterial(uniforms, false)), new THREE.Mesh(this.geometry, faceMaterial(uniforms, true)))
    this.bubbles.push(g)
    this.parent.add(g)
    return g
  }
}
