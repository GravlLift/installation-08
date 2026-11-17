// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayScene3dArmes.test.ts — les bras en 1re personne de la scène : la pose ne replie JAMAIS sur
 * le modèle statique tant que le rig est chargé (la peinture ou l'habillage en cours se posent à
 * leur arrivée, `rigVisible` dit à la scène de ne pas dessiner le modèle), et le suivi d'un
 * joueur prépare ses pièces et sa peinture une fois par suivi.
 */
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

import { BrasPremierePersonne3d } from './brasPremierePersonne3d'

/** Un rig minimal, prêt à montrer (mêmes entrées que la pose réelle). */
function rigArme(bras: BrasPremierePersonne3d, fichier: string, cle: string): THREE.Group {
  const materiau = new THREE.MeshStandardMaterial()
  materiau.userData.surfaceBrute = {}
  const racine = new THREE.Group()
  racine.add(new THREE.Mesh(new THREE.BoxGeometry(), materiau))
  const clip = { name: 'idle', action: 'idle', variant: 0, type: 'base', overlay: false, frameCount: 60, frameRate: 30, durationSeconds: 2 }
  const rig = { file: fichier, bones: 1, triangles: 1, bytes: 1, clips: [clip], actions: [{ action: 'idle', variant: 0, clip: 'idle' }], missingActions: [] } as never
  const interne = bras as unknown as {
    entrees: Map<string, unknown>
    armes: Map<string, unknown>
    fichiersArmes: Map<string, string>
  }
  const idle = { time: 0, weight: 1 }
  interne.entrees.set(fichier, { root: racine, materiaux: [materiau], mixer: { update: () => {} }, rig, actions: new Map([[clip.name, idle]]), listeActions: [idle], clip })
  interne.armes.set(cle, rig)
  interne.fichiersArmes.set(fichier, cle)
  return racine
}

/** L'image nulle : aucun événement de la vie (le poseur ne lit que les tableaux et l'heure). */
const imageNulle = {
  rechargements: [], coups: [], tirs: [], grenades: [], changements: [], sprints: [],
  slides: [], accroupis: [], sauts: [], escalades: [], usages: [], frame: 0, fps: 30,
  rechargementValide: () => false,
} as never

/** La pose des bras à une image, telle que la scène la fait : cacher, montrer, modèle statique sinon. */
function poserArmes(bras: BrasPremierePersonne3d, camera: THREE.PerspectiveCamera, cle: string | null, tenue: { model: unknown } | null) {
  bras.cacher()
  const rigVisible = bras.montrer(camera, cle, imageNulle, null, 0)
  const modelArme = rigVisible ? null : tenue?.model ?? null
  return { rigVisible, modelArme }
}

describe('replayScene3d : la pose des bras en 1re personne', () => {
  const joueurs = () => vi.spyOn(console, 'warn').mockImplementation(() => {})

  it('ne replie pas sur le modèle statique pendant que la peinture de l’arme est en cours', () => {
    const t = joueurs()
    const bras = new BrasPremierePersonne3d(new THREE.Scene(), '/premiere-personne')
    const racine = rigArme(bras, 'a.glb', 'arme')
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    const interne = bras as unknown as { peinture: { enCours: (f?: string) => boolean } }
    interne.peinture.enCours = () => true
    const { rigVisible, modelArme } = poserArmes(bras, camera, 'arme', { model: new THREE.Group() })
    expect(rigVisible).toBe(true)
    expect(modelArme).toBeNull()
    expect(racine.visible).toBe(true)
    bras.dispose()
    t.mockRestore()
  })

  it('garde les bras visibles à une bascule d’arme non peinte', () => {
    const t = joueurs()
    const bras = new BrasPremierePersonne3d(new THREE.Scene(), '/premiere-personne')
    rigArme(bras, 'a.glb', 'arme')
    const b = rigArme(bras, 'b.glb', 'autre')
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    expect(bras.montrer(camera, 'arme', imageNulle, null, 0)).toBe(true)
    const { rigVisible, modelArme } = poserArmes(bras, camera, 'autre', { model: new THREE.Group() })
    expect(rigVisible).toBe(true)
    expect(modelArme).toBeNull()
    expect(b.visible).toBe(true)
    bras.dispose()
    t.mockRestore()
  })

  it('prépare une fois par suivi les pièces et la peinture de chaque rig chargé du joueur', () => {
    const t = joueurs()
    const bras = new BrasPremierePersonne3d(new THREE.Scene(), '/premiere-personne')
    rigArme(bras, 'a.glb', 'arme')
    rigArme(bras, 'b.glb', 'autre')
    const preparer = vi.spyOn(bras, 'preparerJoueur')
    expect(bras.cleRigDe('a.glb')).toBe('arme')
    expect(bras.cleRigDe('b.glb')).toBe('autre')
    bras.preparerJoueur('1')
    bras.preparerJoueur('1')
    expect(preparer).toHaveBeenCalledTimes(2)
    bras.dispose()
    t.mockRestore()
  })
})
