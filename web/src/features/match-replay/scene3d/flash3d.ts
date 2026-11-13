/**
 * flash3d.ts — LES ÉCLAIRS BREFS DE L'ACTION : leur lumière (un jeu fixe de lumières ponctuelles)
 * et leur courbe dans le temps.
 *
 * Une lumière ponctuelle de three éclaire la carte et les Spartans (matériaux standard : la lumière
 * cuite ne remplace que l'indirect). Le nombre de lumières entre dans les programmes compilés :
 * changer ce nombre recompile toute la carte (plusieurs secondes sur Recharge). Le jeu est donc FIXE,
 * posé avec l'éclairage de la scène avant la première compilation ; à chaque image les calques
 * demandent des éclairs (`add`) entre `begin` et `end`, les plus forts prennent les places, les
 * autres places restent éteintes. Aucune ombre : une carte d'ombre par éclair coûterait une passe.
 *
 * Chaque éclair est une fonction de son âge (secondes depuis le tir ou la détonation) : la même
 * image rend la même lumière, en avant comme en arrière.
 */
import * as THREE from 'three'

/** Les places du jeu : quelques éclairs à la fois suffisent, au-delà les plus faibles s'effacent. */
export const FLASH_POOL = 4
// Au plus tant de demandes par image (une rafale de tous les joueurs reste en dessous).
const MAX_REQUESTS = 128
// Décroissance de la lumière avec la distance (physique : 2).
const DECAY = 2

interface Request {
  position: THREE.Vector3
  color: THREE.Color
  intensity: number
  distance: number
}

export class FlashLights {
  private readonly lights: THREE.PointLight[] = []
  private readonly requests: Request[] = []
  private readonly order: Request[] = []
  private n = 0

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < FLASH_POOL; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 1, DECAY)
      light.castShadow = false
      this.lights.push(light)
      scene.add(light)
    }
    for (let i = 0; i < MAX_REQUESTS; i++) {
      this.requests.push({ position: new THREE.Vector3(), color: new THREE.Color(), intensity: 0, distance: 1 })
    }
  }

  begin(): void {
    this.n = 0
  }

  /** add demande un éclair ; au-delà de `MAX_REQUESTS` par image, la demande est ignorée. */
  add(position: THREE.Vector3, color: THREE.Color, intensity: number, distance: number): void {
    if (intensity <= 0 || this.n >= MAX_REQUESTS) return
    const r = this.requests[this.n++]
    r.position.copy(position)
    r.color.copy(color)
    r.intensity = intensity
    r.distance = distance
  }

  /** end donne les places aux éclairs les plus forts de l'image ; les autres places s'éteignent. */
  end(): void {
    this.order.length = 0
    for (let i = 0; i < this.n; i++) this.order.push(this.requests[i])
    this.order.sort((a, b) => b.intensity - a.intensity)
    this.lights.forEach((light, i) => {
      const r = this.order[i]
      light.intensity = r ? r.intensity : 0
      if (!r) return
      light.position.copy(r.position)
      light.color.copy(r.color)
      light.distance = r.distance
    })
  }

  /** lit : les places allumées à la dernière image (tests, mesure). */
  lit(): number {
    return this.lights.filter((l) => l.intensity > 0).length
  }

  dispose(): void {
    for (const light of this.lights) {
      light.removeFromParent()
      light.dispose()
    }
  }
}

/**
 * flashCurve : la force d'un éclair (0..1) `age` secondes après son départ, sur `seconds` : pleine
 * au départ, éteinte au bout, décroissance en carré (un éclat, pas un fondu). 0 avant et après.
 */
export function flashCurve(age: number, seconds: number): number {
  if (age < 0 || age >= seconds) return 0
  const u = 1 - age / seconds
  return u * u
}

/**
 * petalGeometry : un pétale d'éclair de bouche, losange plat dans le plan XY, du canon (origine) à
 * la pointe (+Y, longueur 1), plus large au tiers ; le cœur est blanc, les bords noirs (en mélange
 * additif, le noir ne peint rien : le pétale s'estompe vers ses bords).
 */
export function petalGeometry(): THREE.BufferGeometry {
  const core = [1, 1, 1]
  const edge = [0, 0, 0]
  // Deux triangles par moitié : centre (0, 0.3) blanc, quatre sommets noirs.
  const c = [0, 0.3, 0]
  const tail = [0, 0, 0]
  const tip = [0, 1, 0]
  const left = [-0.5, 0.3, 0]
  const right = [0.5, 0.3, 0]
  const tris = [[c, tail, right], [c, right, tip], [c, tip, left], [c, left, tail]]
  const pos: number[] = []
  const col: number[] = []
  for (const t of tris) {
    t.forEach((v, i) => {
      pos.push(...v)
      col.push(...(i === 0 ? core : edge))
    })
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return g
}
