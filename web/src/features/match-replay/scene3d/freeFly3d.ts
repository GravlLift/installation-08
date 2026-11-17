// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * freeFly3d.ts — LE VOL DE LA CAMÉRA LIBRE au clavier. Les touches se lisent à leur PLACE sur le
 * clavier (`KeyboardEvent.code`) : W A S D en QWERTY, Z Q S D en AZERTY. Avant / arrière suivent
 * la visée (on vole, on ne marche pas), gauche / droite glissent à l'horizontale, E monte et Q
 * (A en AZERTY) descend, Maj accélère. La caméra et le point visé de l'orbite glissent ensemble :
 * la souris garde la rotation autour de lui et la molette le rapprochement.
 *
 * Aucune de ces touches n'est prise par le lecteur (`useReplayShortcuts` : espace, J K L, F, M, R,
 * flèches, zoom).
 */
import * as THREE from 'three'

/** Vitesse en unités du jeu par seconde (1 u ~ 3 m), et son multiplicateur sous Maj. */
const SPEED = 4
const BOOST = 3
// Au-delà, l'image a sauté (onglet caché, chargement) : on ne rattrape pas le temps perdu.
const MAX_STEP_S = 0.1

/** Axe du déplacement par touche : [avant, droite, haut]. */
const AXES: Readonly<Record<string, readonly [number, number, number]>> = {
  KeyW: [1, 0, 0],
  KeyS: [-1, 0, 0],
  KeyD: [0, 1, 0],
  KeyA: [0, -1, 0],
  KeyE: [0, 0, 1],
  KeyQ: [0, 0, -1],
}

/** flyDelta rend le déplacement d'un pas de `dt` secondes pour les touches tenues, null sans touche. */
export function flyDelta(held: ReadonlySet<string>, forward: THREE.Vector3, dt: number, boost: boolean): THREE.Vector3 | null {
  let f = 0
  let r = 0
  let u = 0
  for (const code of held) {
    const a = AXES[code]
    if (!a) continue
    f += a[0]
    r += a[1]
    u += a[2]
  }
  if (f === 0 && r === 0 && u === 0) return null
  const ahead = forward.clone().normalize()
  const right = new THREE.Vector3().crossVectors(ahead, THREE.Object3D.DEFAULT_UP)
  if (right.lengthSq() > 1e-9) right.normalize()
  const move = ahead.multiplyScalar(f).addScaledVector(right, r).addScaledVector(THREE.Object3D.DEFAULT_UP, u)
  if (move.lengthSq() < 1e-12) return null
  return move.normalize().multiplyScalar(SPEED * (boost ? BOOST : 1) * Math.min(dt, MAX_STEP_S))
}

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)
}

/** FreeFly tient l'état du clavier ; `step` déplace la caméra libre à chaque image. */
export class FreeFly {
  private readonly held = new Set<string>()
  private shift = false
  private last = 0

  private readonly onDown = (e: KeyboardEvent) => {
    this.shift = e.shiftKey
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || !AXES[e.code]) return
    this.held.add(e.code)
  }

  private readonly onUp = (e: KeyboardEvent) => {
    this.shift = e.shiftKey
    this.held.delete(e.code)
  }

  // Une touche relâchée hors de la fenêtre ne remonte jamais : on lâche tout.
  private readonly onBlur = () => this.held.clear()

  constructor() {
    window.addEventListener('keydown', this.onDown)
    window.addEventListener('keyup', this.onUp)
    window.addEventListener('blur', this.onBlur)
  }

  /** step glisse `camera` et `target` ensemble selon les touches tenues depuis l'image précédente. */
  step(camera: THREE.Camera, target: THREE.Vector3, nowMs: number): void {
    const dt = this.last === 0 ? 0 : (nowMs - this.last) / 1000
    this.last = nowMs
    const d = flyDelta(this.held, camera.getWorldDirection(new THREE.Vector3()), dt, this.shift)
    if (!d) return
    camera.position.add(d)
    target.add(d)
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown)
    window.removeEventListener('keyup', this.onUp)
    window.removeEventListener('blur', this.onBlur)
  }
}
