/**
 * bodyShell3d.ts — LA COQUE D'ÉNERGIE DU SPARTAN : bouclier qui encaisse, qui rompt, qui se
 * recharge, surbouclier qui tient, contour tremblant du camouflage, dessinés sur sa propre géométrie.
 *
 * La coque double chaque maillage à peau de la copie du joueur (même géométrie, même squelette :
 * elle suit la pose sans calcul de plus), avec un matériau additif PAR JOUEUR. Elle se dessine
 * par-dessus l'armure (même profondeur, décalée vers la caméra), ne cache rien, et n'est posée dans
 * la scène que quand un effet est allumé.
 *
 * Le bouclier parle la couleur du camp (celle du contour d'équipe, `outline3d`) :
 *  - un coup encaissé inonde tout le corps, plus fort au bord (reflet rasant), à la mesure de la
 *    baisse ; un tir soutenu le tient allumé ;
 *  - la rupture est un éclair bref puis des cellules qui crépitent et s'éteignent ;
 *  - la recharge est une bande claire qui remonte le corps une fois, au début de la remontée.
 * Le surbouclier garde sa coque propre (son encre, pâlie de blanc) par-dessus.
 *
 * Toutes les intensités viennent de `BodyFxState`, fonction de l'image : la coque ne garde rien.
 * Les couleurs viennent des encres du thème (aucune valeur écrite ici).
 */
import * as THREE from 'three'

import type { Allegiance } from '@/lib/replay/filmAllegiance'

import type { EquipFx } from './equip3d'
import type { ShieldFx } from './shields3d'

/** Ce que la coque montre à une image. */
export interface BodyFxState {
  shield: ShieldFx
  /** Camouflage et surbouclier (`equip3d`). */
  equip: EquipFx
  /** Le temps du rejeu (s) : le crépitement et le surbouclier bougent avec lui. */
  phase: number
  /** Allié ou adverse vu du joueur de la page (le contour et la coque en prennent la couleur). */
  ally: Allegiance
  /** La couleur du camp (réglages de l'utilisateur), l'encre neutre sans camp. */
  teamColor: THREE.Color
  /** L'encre du surbouclier (vert pâli de blanc). */
  overshieldColor: THREE.Color
  /** L'encre du reflet du camouflage. */
  camoColor: THREE.Color
}

export interface BodyShell {
  meshes: THREE.SkinnedMesh[]
  material: THREE.ShaderMaterial
}

/** La montée de la bande de recharge, des pieds à la tête (s). */
export const RECHARGE_SWEEP_SECONDS = 0.6

const VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying vec3 vView;
varying vec3 vRest;
void main() {
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vView = mvPosition.xyz;
  vRest = position;
}`

const FRAGMENT = /* glsl */ `
uniform vec3 uTeam;
uniform float uHit;
uniform float uBreak;
uniform float uBreakAge;
uniform float uRecharge;
uniform float uRechargeAge;
uniform vec2 uSpan;
uniform float uPhase;
uniform vec3 uOvershieldColor;
uniform float uOvershield;
uniform vec3 uCamoColor;
uniform float uCamo;
varying vec3 vView;
varying vec3 vRest;

// La trame : des hexagones de ~6 cm sur le cylindre du corps (angle autour de l'axe, hauteur).
const float HEX = 0.022;
float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, vec2(0.5, 0.8660254)), p.x);
}
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
void main() {
  vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
  float rim = 1.0 - abs(dot(n, normalize(-vView)));
  rim *= rim;
  float around = atan(vRest.z, vRest.x) * 0.12;
  vec2 uv = vec2(around, vRest.y) / HEX;
  vec2 r = vec2(1.0, 1.7320508);
  vec2 a = mod(uv, r) - 0.5 * r;
  vec2 b = mod(uv - 0.5 * r, r) - 0.5 * r;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  float line = 1.0 - smoothstep(0.0, 0.07, 0.5 - hexDist(gv));
  float cell = hash(floor((uv - gv) * 2.0 + 0.5));

  // Le coup : tout le corps à la couleur du camp, plus fort au bord.
  float hit = uHit * (0.3 + 1.6 * rim);
  // La rupture : un éclair d'un instant, puis des cellules qui crépitent et s'éteignent une à une.
  float flash = max(0.0, 1.0 - uBreakAge / 0.06);
  float crackle = step(cell, uBreak) * (0.4 + 0.6 * line) * (0.5 + 0.5 * sin(uPhase * 90.0 + cell * 40.0));
  float pop = uBreak * (2.5 * flash * (0.6 + rim) + 1.4 * crackle);
  // La recharge : une bande claire qui remonte le corps.
  float h = (vRest.y - uSpan.x) / max(1e-4, uSpan.y - uSpan.x);
  float d = (h - (uRechargeAge / ${RECHARGE_SWEEP_SECONDS.toFixed(2)}) * 1.2 + 0.1) / 0.08;
  float charge = uRecharge * exp(-d * d) * (0.5 + 1.2 * rim);
  vec3 col = uTeam * (hit + pop + charge);
  // Le surbouclier : une coque continue, plus vive au bord, que la trame respire à peine.
  float breathe = 0.85 + 0.15 * sin(uPhase * 3.0 + vRest.y * 20.0);
  col += uOvershieldColor * uOvershield * (0.14 + 0.55 * rim) * (0.7 + 0.3 * line) * breathe;
  // Le camouflage : seul le contour du corps reste, en ondes qui glissent comme un air qui tremble.
  float wave = 0.5 + 0.5 * sin(vRest.y * 70.0 + around * 50.0 - uPhase * 5.0);
  col += uCamoColor * uCamo * rim * (0.12 + 0.3 * wave);
  gl_FragColor = vec4(col, 1.0);
}`

/**
 * makeShell double les maillages à peau de `root` (une copie de Spartan) d'une coque d'énergie.
 * Les maillages de la coque portent `userData.noOutline` : le contour d'équipe ne les trace pas.
 */
export function makeShell(root: THREE.Object3D): BodyShell {
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uTeam: { value: new THREE.Color() },
      uHit: { value: 0 },
      uBreak: { value: 0 },
      uBreakAge: { value: 0 },
      uRecharge: { value: 0 },
      uRechargeAge: { value: 0 },
      uSpan: { value: new THREE.Vector2(0, 1) },
      uPhase: { value: 0 },
      uOvershieldColor: { value: new THREE.Color() },
      uOvershield: { value: 0 },
      uCamoColor: { value: new THREE.Color() },
      uCamo: { value: 0 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
  })
  const sources: THREE.SkinnedMesh[] = []
  root.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) sources.push(o)
  })
  ;(material.uniforms.uSpan.value as THREE.Vector2).copy(restSpan(sources))
  const meshes = sources.map((src) => {
    const shell = new THREE.SkinnedMesh(src.geometry, material)
    shell.position.copy(src.position)
    shell.quaternion.copy(src.quaternion)
    shell.scale.copy(src.scale)
    shell.castShadow = false
    shell.receiveShadow = false
    shell.visible = false
    shell.userData.noOutline = true
    src.parent?.add(shell)
    shell.bind(src.skeleton, src.bindMatrix)
    return shell
  })
  return { meshes, material }
}

/** restSpan : la hauteur de repos des pieds à la tête (bas, haut) des maillages `sources`. */
function restSpan(sources: readonly THREE.SkinnedMesh[]): THREE.Vector2 {
  const box = new THREE.Box3()
  for (const s of sources) {
    if (!s.geometry.boundingBox) s.geometry.computeBoundingBox()
    if (s.geometry.boundingBox) box.union(s.geometry.boundingBox)
  }
  return box.isEmpty() ? new THREE.Vector2(0, 1) : new THREE.Vector2(box.min.y, box.max.y)
}

/** releaseShell retire la coque et libère son matériau (la géométrie est celle de la source). */
export function releaseShell(shell: BodyShell): void {
  for (const m of shell.meshes) m.removeFromParent()
  shell.material.dispose()
}

/** shellLit : un effet de la coque est allumé (sinon elle ne se pose pas dans la scène). */
export function shellLit(fx: BodyFxState): boolean {
  const s = fx.shield
  const sweeping = s.recharge > 0 && s.rechargeAge < RECHARGE_SWEEP_SECONDS
  return s.hit > 0 || s.broke > 0 || sweeping || fx.equip.camo > 0 || fx.equip.overshield > 0
}

/** showShell pose les intensités de l'image `fx` sur la coque, ou l'éteint (null, ou rien d'allumé). */
export function showShell(shell: BodyShell, fx: BodyFxState | null): void {
  const on = fx !== null && shellLit(fx)
  for (const m of shell.meshes) m.visible = on
  if (!on || !fx) return
  const u = shell.material.uniforms
  ;(u.uTeam.value as THREE.Color).copy(fx.teamColor)
  u.uHit.value = fx.shield.hit
  u.uBreak.value = fx.shield.broke
  u.uBreakAge.value = Math.max(0, fx.shield.breakAge)
  const sweeping = fx.shield.recharge > 0 && fx.shield.rechargeAge < RECHARGE_SWEEP_SECONDS
  u.uRecharge.value = sweeping ? 1 : 0
  u.uRechargeAge.value = Math.max(0, fx.shield.rechargeAge)
  u.uPhase.value = fx.phase
  ;(u.uOvershieldColor.value as THREE.Color).copy(fx.overshieldColor)
  u.uOvershield.value = fx.equip.overshield
  ;(u.uCamoColor.value as THREE.Color).copy(fx.camoColor)
  u.uCamo.value = fx.equip.camo
}
