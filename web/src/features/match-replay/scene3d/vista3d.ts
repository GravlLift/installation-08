/**
 * vista3d.ts — L'HORIZON DE LA CARTE : le lointain que le bâtisseur de maillage monde garde
 * pour la vue (les montagnes de la carte, posées du côté des structures, au-delà du cadre de
 * jeu), les matériaux sans brume qui le dessinent, et l'extrémité lointaine de la caméra qui
 * doit l'atteindre.
 *
 * La scène porte une brume (60 à 220 unités) : sans elle, la carte se fond dans le ciel ; avec
 * elle, tout au-delà de 220 unités est effacé. Le lointain se dessine donc d'un matériau dont
 * la brume est désactivée, un clone par matériau source (les textures sont partagées). Les
 * surfaces elles-mêmes ne bougent pas : rayons au sol, sondes, ombres et inspecteur les
 * tiennent comme avant. La caméra (bornée à 700 unités par défaut) est allongée jusqu'au
 * plus loin des surfaces gardées.
 */
import * as THREE from 'three'

// Le rayon minimal du lointain, en unités du monde : une carte sans aire de jeu mesurable
// garde son horizon à partir de cette distance.
export const VISTA_MIN = 300
// Marge de la caméra au-delà du point le plus lointain gardé : le joueur se tient hors du
// centre de l'aire, et la distance au sommet se compte du point de vue, pas du centre.
const MARGE_CAMERA = 200

/** Le lointain préparé : son extrémité lointaine et la libération de ses matériaux. */
export interface Vista {
  /** La plus grande distance du centre à la géométrie gardée du lointain ; 0 sans lointain. */
  loin: number
  /** Libère les matériaux clonés pour le lointain (pas leurs textures, tenues par la carte). */
  dispose(): void
}

/**
 * cameraFarOf donne l'extrémité lointaine de la caméra : son actuelle, allongée jusqu'au
 * point le plus lointain du lointain (+ marge), sans jamais la réduire.
 */
export function cameraFarOf(current: number, loin: number): number {
  return loin > 0 ? Math.max(current, loin + MARGE_CAMERA) : current
}

/**
 * preparerVista dessine le lointain : chaque surface visible dont la boîte est entière
 * au-delà de `rayon` du centre de l'aire de jeu (`centre`, projection au sol) reçoit un
 * clone de son matériau dont la brume est désactivée ; les surfaces proches gardent leur
 * matériau de départ. Rend l'extrémité lointaine du lointain et sa libération.
 */
export function preparerVista(surfaces: readonly THREE.Mesh[], centre: THREE.Vector3, rayon: number): Vista {
  const sansBrume = new Map<THREE.Material, THREE.Material>()
  const propres: THREE.Material[] = []
  let loin = 0
  const point = new THREE.Vector3()
  for (const surface of surfaces) {
    if (!surface.visible) continue
    const box = surface.geometry.boundingBox
    if (!box || box.isEmpty()) continue
    surface.updateMatrixWorld(true)
    const monde = box.clone().applyMatrix4(surface.matrixWorld)
    // Distance du centre à la boîte, au niveau du sol : la même règle que le bâtisseur de
    // maillage (boîte entière au-delà du rayon du cadre, rien de coupé par moitié).
    monde.clampPoint(point.copy(centre))
    if (centre.distanceTo(point) <= rayon) continue
    const source = surface.material as THREE.Material
    let copie = sansBrume.get(source)
    if (!copie) {
      copie = source.clone()
      copie.fog = false
      sansBrume.set(source, copie)
      propres.push(copie)
    }
    surface.material = copie
    monde.getLongestPoint(point)
    loin = Math.max(loin, centre.distanceTo(point))
  }
  return {
    loin,
    dispose() {
      for (const m of propres) m.dispose()
      sansBrume.clear()
    },
  }
}
