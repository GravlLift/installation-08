import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'

import { buildPostFx, GRADE_GAIN } from './postFx3d'
import type { Outline3d } from './outline3d'

/** Renderer factice : le compositeur n'en lit que le ratio de pixels (la cible est fournie). */
function rendererFactice(): THREE.WebGLRenderer {
  return { getPixelRatio: () => 1 } as unknown as THREE.WebGLRenderer
}

describe('buildPostFx — la chaîne du compositeur', () => {
  it("la teinte suit la sortie, précède le SMAA, et la ligne du contour reste en dernier", () => {
    const fx = buildPostFx(rendererFactice(), new THREE.Scene(), new THREE.PerspectiveCamera())
    try {
      const passes = fx.composer.passes
      const iSortie = passes.indexOf(passes.find((p) => p.constructor.name === 'OutputPass')!)
      const iTeinte = passes.indexOf(fx.grade)
      const iSmaa = passes.indexOf(passes.find((p) => (p as SMAAPass).materialBlend !== undefined)!)
      expect(iSortie).toBeGreaterThanOrEqual(0)
      expect(iTeinte).toBe(iSortie + 1)
      expect(iSmaa).toBe(iTeinte + 1)
      expect(passes[passes.length - 1]).toBe((fx.outline as Outline3d).linePass)
    } finally {
      fx.dispose()
    }
  })

  it("la teinte n'a ni test ni écriture en profondeur ; son gain est celui de la teinte", () => {
    const fx = buildPostFx(rendererFactice(), new THREE.Scene(), new THREE.PerspectiveCamera())
    try {
      expect(fx.grade.material.depthTest).toBe(false)
      expect(fx.grade.material.depthWrite).toBe(false)
      const gain = fx.grade.uniforms.uGain.value as THREE.Vector3
      expect(gain.toArray()).toEqual(GRADE_GAIN)
    } finally {
      fx.dispose()
    }
  })
})
