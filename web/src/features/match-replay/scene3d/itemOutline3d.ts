// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * itemOutline3d.ts — THE PICKUP OUTLINE ON A PAD ITEM. Every weapon names its outline type, and
 * they all name the same look (`ostd` 229d13f3 and its copies 2c8e2be6, 844486ce, c9934466): root
 * +0x24 color (0.575, 0.761, 0.848), +0x3c outline weight 2, +0x38 intensity 4, +0x30 opacity 4.
 * No equipment tag names an outline type; the game draws the same blue line around the
 * equipment on its pads (Jordan's captures of 2026-11-21), so the pad items all take it.
 *
 * A SILHOUETTE, not every edge: each mesh is drawn again (back faces), first pushed away from the
 * camera by the whole item's bounding radius, so the item's own surface always wins the depth
 * test and only the hull's rim outside the item's silhouette shows, then widened along its
 * screen-space normal by the outline weight (pixels on a 1080-line screen). What stands in front
 * of the item hides its outline (the type's occlusion mode 1, "draw where visible").
 * Not drawn: the outline's distance fade and its inline.
 */
import * as THREE from 'three'

/** The outline's color (`ostd` 229d13f3 root +0x24, display RGB). */
export const PICKUP_OUTLINE_COLOR: readonly [number, number, number] = [0.575, 0.761, 0.848]
/** The outline's weight (`ostd` 229d13f3 root +0x3c), in pixels of a 1080-line screen. */
export const PICKUP_OUTLINE_WEIGHT = 2
const REFERENCE_LINES = 1080

const size = new THREE.Vector2()
const uniforms = {
  uColor: { value: new THREE.Color().setRGB(PICKUP_OUTLINE_COLOR[0], PICKUP_OUTLINE_COLOR[1], PICKUP_OUTLINE_COLOR[2], THREE.SRGBColorSpace) },
  uWidth: { value: PICKUP_OUTLINE_WEIGHT },
  uViewport: { value: new THREE.Vector2(1920, 1080) },
  uPush: { value: 0 },
}

const VERTEX = /* glsl */ `
uniform float uWidth;
uniform vec2 uViewport;
uniform float uPush;
void main() {
  vec4 view = viewMatrix * modelMatrix * vec4(position, 1.0);
  view.xyz += normalize(view.xyz) * uPush;
  vec4 clip = projectionMatrix * view;
  vec3 n = normalize(normalMatrix * normal);
  vec2 dir = (projectionMatrix * vec4(n, 0.0)).xy;
  float len = length(dir);
  if (len > 1e-6) {
    float px = uWidth * uViewport.y / ${REFERENCE_LINES.toFixed(1)};
    clip.xy += dir / len * px * 2.0 / uViewport * clip.w;
  }
  gl_Position = clip;
}`

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
void main() {
  gl_FragColor = vec4(uColor, 1.0);
  #include <colorspace_fragment>
}`

/** Per source model: the radius of its bounds' sphere, in its own frame. */
const radii = new WeakMap<THREE.Object3D, number>()

function radiusOf(source: THREE.Object3D): number {
  let r = radii.get(source)
  if (r === undefined) {
    source.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(source).applyMatrix4(source.matrixWorld.clone().invert())
    r = box.isEmpty() ? 0 : box.getBoundingSphere(new THREE.Sphere()).radius
    radii.set(source, r)
  }
  return r
}

/** The world radius of the posed item a hull belongs to: its pool copy's scale times its bounds. */
function pushOf(object: THREE.Object3D): number {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) {
    const source = o.userData.source as THREE.Object3D | undefined
    if (source) return radiusOf(source) * Math.max(o.scale.x, o.scale.y, o.scale.z)
    if (o.userData.pickupOutline) return radiusOf(o) * Math.max(o.scale.x, o.scale.y, o.scale.z)
  }
  return 0
}

let material: THREE.ShaderMaterial | null = null

/** outlineMaterial: the one hull material every outlined item shares (its push set per draw). */
function outlineMaterial(): THREE.ShaderMaterial {
  if (material) return material
  const m = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms, side: THREE.BackSide, toneMapped: false })
  m.onBeforeRender = (renderer, _scene, _camera, _geometry, object) => {
    renderer.getDrawingBufferSize(size)
    uniforms.uViewport.value.copy(size)
    uniforms.uPush.value = pushOf(object)
    m.uniformsNeedUpdate = true
  }
  material = m
  return m
}

/** addPickupOutline gives every mesh of `model` its outline hull (once; a second call is a no-op). */
export function addPickupOutline(model: THREE.Object3D): void {
  if (model.userData.pickupOutline) return
  model.userData.pickupOutline = true
  const meshes: THREE.Mesh[] = []
  model.traverse((o) => {
    if (o instanceof THREE.Mesh && !(o instanceof THREE.SkinnedMesh) && o.geometry.getAttribute('normal')) meshes.push(o)
  })
  for (const m of meshes) {
    const hull = new THREE.Mesh(m.geometry, outlineMaterial())
    hull.castShadow = false
    hull.receiveShadow = false
    hull.userData.pickupOutlineHull = true
    m.add(hull)
  }
}
