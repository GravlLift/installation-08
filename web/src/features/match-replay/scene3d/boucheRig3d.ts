/**
 * boucheRig3d.ts — LA BOUCHE DU RIG DE 1RE PERSONNE (bras + arme animés), une fois par rig.
 *
 * Les tirs de 1re personne partent du canon que la caméra dessine : le rig animé, posé par
 * `BrasPremierePersonne3d.placer`. Son point de bouche et l'axe de son canon se mesurent UNE FOIS,
 * à la pose idle (l'image où le rig se repose), dans le repère du PORTEUR (l'espace des enfants de
 * `porteur`, avant la tenue et avant la caméra). `boucheRigCamera` le transforme ensuite en repère
 * CAMÉRA exactement comme `appliquerTenueRig` + `placer` le font pour une caméra à l'origine immobile
 * : aucun calcul ne se répète par tir ni par image, et l'effet d'un tir reste le même en rebobinant.
 *
 * Les maillages du rig dont aucun matériau n'est un bras (`estMateriauBras` faux) sont l'arme : la
 * bouche est le devant de leurs sommets, sur une tranche de ~3 cm le long du canon (la même idée que
 * `muzzleOfModel`). Les pièces de bras posées ensuite (`actualiserPieces`) sont des maillages de bras,
 * elles en sont écartées.
 */
import * as THREE from 'three'

import { ROTATION_RIG_CAMERA } from './premierePersonne3d'
import type { ViewGrip } from './viewGrip3d'

// La tranche avant du canon dont le centre des sommets fait la bouche (u, ~3 cm, comme MUZZLE_SLICE).
const BOUCHE_TRANCHE = 0.01
// Le nombre maximal de sommets lus par maillage (pas d'échantillonnage) : la mesure est une fois.
const BOUCHE_PAS_MAX = 5000

// Bacs à sable partagés : aucun sommet n'est stocké, tout se passe dans ces vecteurs.
const BAC_SOMMET = new THREE.Vector3()
const BAC_RELA = new THREE.Matrix4()
const BAC_MAILLAGE = new THREE.Matrix4()
const BAC_AXE = new THREE.Vector3()
// L'axe du canon dans le repère du rig quand l'index ne le donne pas : l'avant de la caméra
// (0,0,-1) ramené dans le repère du rig (l'inverse de ROTATION_RIG_CAMERA).
const AXE_PAR_DEFAUT = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().copy(ROTATION_RIG_CAMERA).invert())
const BAC_DEPLACEMENT = new THREE.Vector3()
// L'axe de visée du rig (repère caméra, -Z vers l'avant) : le roulis de la tenue y tourne autour.
const AXE_AVANT = new THREE.Vector3(0, 0, -1)
const BAC_ROULIS = new THREE.Quaternion()

/**
 * boucheRig : la bouche et l'axe du canon d'un rig, dans le repère du PORTEUR (les enfants de
 * `porteur`, dont `root`), mesurés sur les maillages d'ARMES (aucun matériau de bras) à la pose
 * courante du rig (l'idle, où le rig a fini de charger).
 * - `root` : la scène du rig (`entree.root`), enfant de `porteur` ; ses matrices monde doivent être
 *   celles de la pose (`updateMatrixWorld` est appelé ici).
 * - `isArm` : un matériau de bras ; un maillage dont un seul matériau est un bras est un bras.
 * - `axeRig` : l'axe du canon dans le repère du RIG (`rig.idleWeapon.forward`), normalisé ; null :
 *   l'axe qui pointe loin de l'œil une fois le rig posé (l'inverse de ROTATION_RIG_CAMERA sur -Z).
 * - `out` : `{ bouche, axe }` remplis dans le repère du porteur. Faux si aucun maillage d'arme.
 */
export function boucheRig(
  root: THREE.Object3D,
  porteur: THREE.Object3D,
  isArm: (materiau: THREE.Material) => boolean,
  axeRig: THREE.Vector3 | null,
  out: { bouche: THREE.Vector3; axe: THREE.Vector3 },
): boolean {
  root.updateMatrixWorld(true)
  porteur.updateMatrixWorld(true)
  const versPorteur = BAC_RELA.copy(porteur.matrixWorld).invert()
  const axe = BAC_AXE.copy(axeRig ?? AXE_PAR_DEFAUT).normalize()
  let front = -Infinity
  const somme = new THREE.Vector3()
  // Premier tour : le plus avant le long du canon ; deuxième tour : la tranche de ce front.
  let n = 0
  for (const passe of [0, 1]) {
    if (passe === 1 && front === -Infinity) return false
    somme.set(0, 0, 0)
    n = 0
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const materiaux = Array.isArray(o.material) ? o.material : [o.material]
      if (materiaux.some(isArm)) return
      // Sommet local du maillage -> monde -> repère du porteur.
      const rel = BAC_MAILLAGE.multiplyMatrices(versPorteur, o.matrixWorld)
      const pos = (o.geometry as THREE.BufferGeometry).getAttribute('position')
      const pas = Math.max(1, Math.ceil(pos.count / BOUCHE_PAS_MAX))
      for (let i = 0; i < pos.count; i += pas) {
        const v = BAC_SOMMET
        if (o instanceof THREE.SkinnedMesh) o.getVertexPosition(i, v)
        else v.fromBufferAttribute(pos, i)
        v.applyMatrix4(rel)
        const t = v.dot(axe)
        if (passe === 0) {
          if (t > front) front = t
        } else if (t >= front - BOUCHE_TRANCHE) {
          somme.add(v)
          n++
        }
      }
    })
  }
  if (n === 0) return false
  out.bouche.copy(somme).divideScalar(n)
  // La bouche est au DEVANT du canon : le point de la tranche est poussé sur son plan frontal.
  out.bouche.addScaledVector(axe, front - out.bouche.dot(axe))
  out.axe.copy(axe)
  return true
}

/**
 * boucheRigCamera : la bouche d'un rig (repère du porteur, `st`) en repère CAMÉRA (x à droite, y en
 * haut, -z vers l'avant), composée exactement comme `appliquerTenueRig` + `placer` le font pour une
 * caméra à l'origine immobile : le point tourné de `ROTATION_RIG_CAMERA`, plus le roulis de la tenue
 * autour du canon (comme `appliquerTenueRig`), plus la translation de la tenue (x, y, -z).
 * `out` est rempli, sans allocation par appel.
 */
export function boucheRigCamera(st: { bouche: THREE.Vector3; axe: THREE.Vector3 }, tenue: ViewGrip, out: THREE.Vector3): THREE.Vector3 {
  out.copy(st.bouche).applyQuaternion(ROTATION_RIG_CAMERA)
  if (tenue.roll) out.applyQuaternion(BAC_ROULIS.setFromAxisAngle(AXE_AVANT, tenue.roll))
  if (tenue.x || tenue.y || tenue.z) out.add(BAC_DEPLACEMENT.set(tenue.x, tenue.y, -tenue.z))
  return out
}

/**
 * La bouche et l'axe du canon dans le repère LOCAL de l'objet qui porte la bouche : le maillage pour
 * un maillage simple, l'os dont la tranche avant cumule le plus de poids de peau pour un
 * `SkinnedMesh`. C'est le point et l'axe qui suivent le rig à mesure qu'il est animé et posé :
 * `boucheMondeRig` les ramène en monde à l'image rendue.
 */
export interface BoucheLocale {
  porteurLocal: THREE.Object3D
  point: THREE.Vector3
  axe: THREE.Vector3
}

/**
 * boucheRigLocale : la bouche et l'axe du canon d'un rig, exprimés dans le repère LOCAL de l'objet
 * qui porte la bouche (maillage, ou l'os porteur dominant d'un `SkinnedMesh`), à la pose courante.
 * Les maillages d'arme sont ceux dont aucun matériau n'est un bras (`isArm`) ; sans maillage d'arme,
 * faux. Mesurée une fois au chargement, comme `boucheRig` : `out` est rempli, sans contrainte
 * d'allocation (la mesure est un chargement, pas une image).
 */
export function boucheRigLocale(
  root: THREE.Object3D,
  porteur: THREE.Object3D,
  isArm: (materiau: THREE.Material) => boolean,
  axeRig: THREE.Vector3 | null,
  out: BoucheLocale,
): boolean {
  root.updateMatrixWorld(true)
  porteur.updateMatrixWorld(true)
  const versPorteur = BAC_RELA.copy(porteur.matrixWorld).invert()
  const axe = BAC_AXE.copy(axeRig ?? AXE_PAR_DEFAUT).normalize()
  const estArme = (o: THREE.Mesh) => (Array.isArray(o.material) ? o.material : [o.material]).every((m) => !isArm(m))
  const sommetLocal = (o: THREE.Mesh, i: number, v: THREE.Vector3, rel: THREE.Matrix4): THREE.Vector3 => {
    if (o instanceof THREE.SkinnedMesh) o.getVertexPosition(i, v)
    else v.fromBufferAttribute((o.geometry as THREE.BufferGeometry).getAttribute('position'), i)
    return v.applyMatrix4(rel)
  }
  // Premier tour : le plus avant le long du canon (repère du porteur).
  let front = -Infinity
  const v = BAC_SOMMET
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !estArme(o)) return
    const rel = BAC_MAILLAGE.multiplyMatrices(versPorteur, o.matrixWorld)
    const pos = (o.geometry as THREE.BufferGeometry).getAttribute('position')
    const pas = Math.max(1, Math.ceil(pos.count / BOUCHE_PAS_MAX))
    for (let i = 0; i < pos.count; i += pas) {
      if (sommetLocal(o, i, v, rel).dot(axe) > front) front = v.dot(axe)
    }
  })
  if (front === -Infinity) return false
  // Deuxième tour : la tranche avant — l'objet porteur est celui dont la tranche cumule le plus de
  // poids (nombre de sommets pour un maillage, somme des poids de peau pour un os).
  const poids = new Map<THREE.Object3D, number>()
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !estArme(o)) return
    const rel = BAC_MAILLAGE.multiplyMatrices(versPorteur, o.matrixWorld)
    const pos = (o.geometry as THREE.BufferGeometry).getAttribute('position')
    const pas = Math.max(1, Math.ceil(pos.count / BOUCHE_PAS_MAX))
    if (o instanceof THREE.SkinnedMesh) {
      const os = o.geometry.getAttribute('skinIndex') as THREE.BufferAttribute
      const w = o.geometry.getAttribute('skinWeight') as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i += pas) {
        if (sommetLocal(o, i, v, rel).dot(axe) < front - BOUCHE_TRANCHE) continue
        for (let k = 0; k < 4; k++) {
          const osPorteur = o.skeleton.bones[os.getX(i + k)]
          if (osPorteur) poids.set(osPorteur, (poids.get(osPorteur) ?? 0) + w.getX(i + k))
        }
      }
    } else {
      let n = 0
      for (let i = 0; i < pos.count; i += pas) if (sommetLocal(o, i, v, rel).dot(axe) >= front - BOUCHE_TRANCHE) n++
      if (n > 0) poids.set(o, (poids.get(o) ?? 0) + n)
    }
  })
  let porteurLocal: THREE.Object3D | null = null
  let poidsMax = 0
  for (const [p, w] of poids) if (w > poidsMax) { poidsMax = w; porteurLocal = p }
  if (!porteurLocal) return false
  // Le centre de la tranche qui appartient à ce porteur, repoussé sur son plan frontal.
  const centre = new THREE.Vector3()
  let n = 0
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !estArme(o)) return
    const porte = o === porteurLocal || (o instanceof THREE.SkinnedMesh && (o.skeleton.bones as THREE.Object3D[]).includes(porteurLocal))
    if (!porte) return
    const rel = BAC_MAILLAGE.multiplyMatrices(versPorteur, o.matrixWorld)
    const pos = (o.geometry as THREE.BufferGeometry).getAttribute('position')
    const pas = Math.max(1, Math.ceil(pos.count / BOUCHE_PAS_MAX))
    for (let i = 0; i < pos.count; i += pas) if (sommetLocal(o, i, v, rel).dot(axe) >= front - BOUCHE_TRANCHE) { centre.add(v); n++ }
  })
  if (n === 0) return false
  centre.divideScalar(n)
  centre.addScaledVector(axe, front - centre.dot(axe))
  // Repasse le point et l'axe dans le repère local du porteur (l'inverse de son passage au porteur).
  // `versPorteur` vit dans BAC_RELA : le produit se fait dans un autre bac.
  const matLocal = BAC_MAILLAGE.multiplyMatrices(versPorteur, porteurLocal.matrixWorld).invert()
  out.porteurLocal = porteurLocal
  out.point.copy(centre).applyMatrix4(matLocal)
  out.axe.copy(axe).transformDirection(matLocal)
  return true
}

/**
 * boucheMondeRig : la bouche (`point`, repère local du porteur `porteurLocal`) et l'axe du canon
 * (`axe`, idem) en espace MONDE, lus à l'image rendue : la matrice monde du porteur est rafraîchie
 * sur sa chaîne (`updateWorldMatrix`). Aucun tir ni image n'alloue : `outPos` et `outAxe` sont
 * remplis.
 */
export function boucheMondeRig(
  porteurLocal: THREE.Object3D,
  point: THREE.Vector3,
  axe: THREE.Vector3,
  outPos: THREE.Vector3,
  outAxe: THREE.Vector3,
): void {
  porteurLocal.updateWorldMatrix(true, false)
  outPos.copy(point).applyMatrix4(porteurLocal.matrixWorld)
  outAxe.copy(axe).transformDirection(porteurLocal.matrixWorld)
}
