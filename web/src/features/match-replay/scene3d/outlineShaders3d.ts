// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * outlineShaders3d.ts — LES NUANCEURS DU CONTOUR D'ÉQUIPE (`outline3d`).
 *
 * Le contour est en rayons X : il traverse la carte, comme dans le théâtre du jeu. Aucun des deux
 * nuanceurs ne lit la profondeur de la scène ; un joueur caché par un mur est tracé tout de même.
 *
 * Le masque est une cible à demi-résolution, lue en filtrage linéaire : chaque texel couvert porte
 * (allié, adverse, éclat, profondeur du joueur), un texel vide (0, 0, 0, 0). Lu entre les texels, il
 * donne une couverture douce (allié + adverse) dont la ligne de niveau 0,5 est le bord de la
 * silhouette, et des moyennes pondérées par la couverture (éclat / couverture, profondeur /
 * couverture). La ligne se mesure depuis ce bord au demi-pixel près : elle sort lisse, pas en
 * escalier, et garde son épaisseur à l'écran.
 */

/** La couleur de l'éclat tire vers le blanc, d'autant au plus fort. */
const FLARE_WHITE = 0.45
/** Directions et anneaux échantillonnés autour d'un pixel (le pas suit l'épaisseur au plus fort). */
const DIRS = 12
const RINGS = 5

export const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

export const SUBJECT_VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying float vDepth;
void main() {
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vDepth = -mvPosition.z;
}`

/** Le joueur au masque : son camp, son éclat, sa profondeur ; le masque le garde, même caché. */
export const SUBJECT_FRAGMENT = /* glsl */ `
uniform vec3 uSide;
varying float vDepth;
void main() {
  gl_FragColor = vec4(uSide, vDepth);
}`

/**
 * La ligne, à pleine résolution, par-dessus l'image (en rayons X, un mur devant ne l'arrête pas).
 * Hors de la silhouette : dans chaque direction, le premier échantillon couvert donne le bord
 * (interpolé entre lui et le précédent) et la portée du joueur (épaisseur + éclat) ; la direction
 * la plus couvrante l'emporte. Dans la silhouette, le bord intérieur de la ligne s'efface sur
 * `uSoft` : il couvre l'escalier du corps sans le mordre.
 */
export const LINE_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tMask;
uniform vec2 uTexel;
uniform float uBase;
uniform float uFlare;
uniform float uSoft;
uniform float uMaskPx;
uniform vec3 uAlly;
uniform vec3 uEnemy;
varying vec2 vUv;
vec3 inkOf(vec4 q) {
  float c = q.r + q.g;
  vec3 ink = q.r >= q.g ? uAlly : uEnemy;
  return mix(ink, vec3(1.0), ${FLARE_WHITE.toFixed(2)} * q.b / c);
}
void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  gl_FragColor = base;
  vec4 here = texture2D(tMask, vUv);
  float c0 = here.r + here.g;
  if (c0 >= 0.5) {
    // La couverture monte de 0 à 1 sur un texel du masque (uMaskPx pixels).
    float inside = (c0 - 0.5) * uMaskPx;
    float a = clamp(1.0 - inside / uSoft, 0.0, 1.0);
    if (a > 0.0) gl_FragColor = vec4(mix(base.rgb, inkOf(here), a), base.a);
    return;
  }
  float step = (uBase + uFlare) / float(${RINGS});
  float best = 0.0;
  vec4 hit = vec4(0.0);
  for (int i = 0; i < ${DIRS}; i++) {
    float t = float(i) * ${((2 * Math.PI) / DIRS).toFixed(6)};
    vec2 dir = vec2(cos(t), sin(t)) * uTexel;
    float prev = c0;
    for (int k = 1; k <= ${RINGS}; k++) {
      float d = float(k) * step;
      vec4 q = texture2D(tMask, vUv + dir * d);
      float c = q.r + q.g;
      if (c < 0.5) {
        prev = c;
        continue;
      }
      float edge = d - step * (c - 0.5) / max(c - prev, 1e-3);
      float reach = uBase + uFlare * q.b / c;
      float a = clamp((reach - edge) / uSoft + 0.5, 0.0, 1.0);
      if (a > best) {
        best = a;
        hit = q;
      }
      break;
    }
  }
  if (best <= 0.0) return;
  gl_FragColor = vec4(mix(base.rgb, inkOf(hit), best), base.a);
}`
