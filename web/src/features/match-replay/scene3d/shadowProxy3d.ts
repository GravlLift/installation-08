/**
 * shadowProxy3d.ts — LES OMBRES PORTÉES DE LA CARTE EN QUELQUES APPELS DE DESSIN.
 *
 * La passe d'ombre redessine chaque surface qui porte une ombre : un appel par surface, plus d'un
 * millier sur une carte. Or ces surfaces partagent leur tampon de sommets et n'ont pas de
 * transformation propre : leurs index mis bout à bout font UN maillage par tampon et par face
 * dessinée. `buildShadowProxies` construit ces maillages, leur confie l'ombre portée et la retire
 * aux surfaces d'origine, qui continuent de se dessiner et de recevoir l'ombre comme avant.
 *
 * Un maillage d'ombre n'existe que pour la passe d'ombre : au dessin de la scène (et de toute passe
 * qui passe par `onBeforeRender` : normales de l'occlusion ambiante, sondes), sa plage de dessin
 * est vide. Il ne répond à aucun lancer de rayon.
 */
import * as THREE from 'three'

export interface ShadowProxies {
  /** Les maillages d'ombre, déjà enfants de la racine donnée. */
  meshes: THREE.Mesh[]
  /** Le nombre de surfaces dont l'ombre est maintenant portée par un maillage d'ombre. */
  merged: number
  /** Libère les index et matériaux des maillages d'ombre (pas les sommets, qui sont aux surfaces). */
  dispose(): void
}

/** mergeable : une surface simple, indexée, opaque sans découpe, qui porte une ombre. */
function mergeable(mesh: THREE.Mesh): mesh is THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  if (!mesh.castShadow || !mesh.visible) return false
  if (mesh instanceof THREE.SkinnedMesh || mesh instanceof THREE.InstancedMesh) return false
  const material = mesh.material
  if (Array.isArray(material) || material.alphaTest > 0 || material.transparent) return false
  return mesh.geometry.index !== null && mesh.geometry.getAttribute('position') !== undefined
}

/** La face que la passe d'ombre dessine pour un matériau (la règle de three sans `shadowSide`). */
function shadowSideOf(material: THREE.Material): THREE.Side {
  if (material.shadowSide !== null) return material.shadowSide
  return material.side === THREE.FrontSide ? THREE.BackSide : material.side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide
}

/**
 * buildShadowProxies regroupe les surfaces de `meshes` qui portent une ombre par tampon de sommets,
 * transformation monde et face d'ombre, et pose un maillage d'ombre par groupe sous `root`. Les
 * surfaces regroupées perdent `castShadow` ; les autres (découpes, translucides) le gardent.
 */
export function buildShadowProxies(root: THREE.Object3D, meshes: readonly THREE.Mesh[]): ShadowProxies {
  root.updateMatrixWorld(true)
  const groups = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]>()
  const ids = new Map<object, number>()
  const idOf = (o: object) => ids.get(o) ?? (ids.set(o, ids.size), ids.size - 1)
  for (const mesh of meshes) {
    if (!mergeable(mesh)) continue
    const position = mesh.geometry.getAttribute('position')
    const buffer = position instanceof THREE.InterleavedBufferAttribute ? position.data : position
    const key = `${idOf(buffer)}|${shadowSideOf(mesh.material)}|${mesh.matrixWorld.elements.map((v) => v.toFixed(5)).join(',')}`
    const group = groups.get(key)
    if (group) group.push(mesh)
    else groups.set(key, [mesh])
  }
  const toRoot = root.matrixWorld.clone().invert()
  const proxies: THREE.Mesh[] = []
  let merged = 0
  for (const group of groups.values()) {
    if (group.length < 2) continue
    let count = 0
    for (const mesh of group) count += (mesh.geometry.index as THREE.BufferAttribute).count
    const index = new Uint32Array(count)
    let offset = 0
    for (const mesh of group) {
      const source = mesh.geometry.index as THREE.BufferAttribute
      for (let i = 0; i < source.count; i++) index[offset + i] = source.getX(i)
      offset += source.count
      mesh.castShadow = false
    }
    merged += group.length
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', group[0].geometry.getAttribute('position'))
    geometry.setIndex(new THREE.BufferAttribute(index, 1))
    // `shadowSide` fixe la face dessinée dans la passe d'ombre : la même que pour les surfaces d'origine.
    const material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, shadowSide: shadowSideOf(group[0].material) })
    const proxy = new THREE.Mesh(geometry, material)
    proxy.name = 'ombre-carte'
    proxy.castShadow = true
    proxy.frustumCulled = false
    proxy.matrixAutoUpdate = false
    proxy.matrix.multiplyMatrices(toRoot, group[0].matrixWorld)
    proxy.raycast = () => {}
    proxy.onBeforeRender = () => geometry.setDrawRange(0, 0)
    proxy.onAfterRender = () => geometry.setDrawRange(0, Infinity)
    root.add(proxy)
    proxies.push(proxy)
  }
  return {
    meshes: proxies,
    merged,
    dispose() {
      for (const proxy of proxies) {
        proxy.removeFromParent()
        // Seul l'index est à ce maillage : libérer la géométrie entière libérerait les sommets partagés.
        proxy.geometry.deleteAttribute('position')
        proxy.geometry.dispose()
        ;(proxy.material as THREE.Material).dispose()
      }
    },
  }
}
