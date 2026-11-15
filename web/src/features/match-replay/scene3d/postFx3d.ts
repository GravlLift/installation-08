/**
 * postFx3d.ts — LE COMPOSITEUR DE LA SCÈNE 3D : rendu de la scène dans une cible qui garde sa
 * profondeur, masque du contour d'équipe (`outline3d`), occlusion ambiante, passage aux couleurs de
 * l'écran, anticrénelage (SMAA), puis la ligne du contour.
 *
 * Occlusion ambiante en espace écran (GTAO) : l'assombrissement des coins et des recoins que
 * l'éclairage du jeu porte. Elle réutilise la profondeur du passage principal au lieu de
 * re-rendre la scène en matériau de normales : les normales en sont reconstruites, facettes comme
 * dans le GLB sans normales de sommet. Rayon en unités monde (0,6 u ~ 1,8 m), débruitage sur 6 px.
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'

import { Outline3d } from './outline3d'

export interface PostFx3d {
  composer: EffectComposer
  gtao: GTAOPass
  grade: ShaderPass
  output: OutputPass
  smaa: SMAAPass
  outline: Outline3d
  /** What each pass drew at the last frames since `resetCosts` (`renderer.info`), for the playback meter. */
  costs: Record<PassName, PassCost>
  resetCosts(): void
  dispose(): void
}

/** The composer's passes, in order, as the playback meter names them. */
export const PASS_NAMES = ['scene', 'outlineMask', 'ao', 'output', 'grade', 'smaa', 'outlineLine'] as const
export type PassName = (typeof PASS_NAMES)[number]
export interface PassCost { calls: number; triangles: number }

/**
 * Gain par canal (rouge, vert, bleu) en espace écran : appliqué après la sortie, il refroidit
 * l'image pour la ramener à celle du jeu (mesurée sur les enregistrements). La ligne du contour
 * passe après, elle garde sa couleur exacte.
 */
export const GRADE_GAIN = [0.93, 1.02, 1.07]

/** Passe de teinte : multiplie la couleur d'écran par `GRADE_GAIN`. */
const shaderGrade = {
  name: 'Grade',
  uniforms: {
    tDiffuse: { value: null },
    uGain: { value: new THREE.Vector3(...GRADE_GAIN) },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; uniform vec3 uGain; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(c.rgb * uGain, c.a); }',
}

/** buildPostFx pose les passes de la scène `scene` vue par `camera`. */
export function buildPostFx(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): PostFx3d {
  // La profondeur de la scène reste lisible après son rendu : l'occlusion ambiante s'y compare.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) })
  const composer = new EffectComposer(renderer, target)
  const scenePass = new RenderPass(scene, camera)
  composer.addPass(scenePass)
  const outline = new Outline3d(camera)
  composer.addPass(outline.maskPass)
  const gtao = new GtaoScenePass(scene, camera)
  gtao.updateGtaoMaterial({ radius: 0.6, thickness: 1, distanceFallOff: 1, scale: 1 })
  gtao.updatePdMaterial({ radius: 6 })
  composer.addPass(gtao)
  const output = new OutputPass()
  // Un quad plein écran n'a rien à tester ni à écrire en profondeur : celle de la scène doit arriver
  // intacte à l'occlusion ambiante (la cible où il écrit peut être celle de la scène).
  output.material.depthTest = false
  output.material.depthWrite = false
  composer.addPass(output)
  // Teinte de l'image, entre la sortie et l'anticrénelage : le contour, après, garde sa couleur.
  const grade = new ShaderPass(shaderGrade)
  // Même règle que la sortie : le quad plein écran n'a rien à tester ni à écrire en profondeur,
  // la profondeur de la scène doit arriver intacte à l'occlusion ambiante.
  grade.material.depthTest = false
  grade.material.depthWrite = false
  composer.addPass(grade)
  // Anticrénelage de l'image aux couleurs de l'écran, avant la ligne du contour (qui doit rester
  // la dernière passe : elle écrit par-dessus l'image).
  // Même règle que la sortie : selon les passes actives, sa cible est celle de la scène, dont la
  // profondeur ne doit pas être réécrite par le quad plein écran.
  const smaa = new SMAAPass(1, 1) as SMAAPass & { materialBlend: THREE.ShaderMaterial }
  smaa.materialBlend.depthTest = false
  smaa.materialBlend.depthWrite = false
  composer.addPass(smaa)
  composer.addPass(outline.linePass)
  const costs = meterPasses(renderer, [scenePass, outline.maskPass, gtao, output, grade, smaa, outline.linePass])
  return {
    composer,
    gtao,
    grade,
    output,
    smaa,
    outline,
    costs,
    resetCosts() {
      for (const name of PASS_NAMES) costs[name].calls = costs[name].triangles = 0
    },
    dispose() {
      outline.dispose()
      gtao.dispose()
      grade.dispose()
      composer.dispose()
    },
  }
}

/**
 * meterPasses wraps each pass's `render` to add what it drew (`renderer.info`, which the scene
 * resets once per frame) to its entry; the passes are in `PASS_NAMES` order.
 */
function meterPasses(renderer: THREE.WebGLRenderer, passes: readonly { render: (...args: never[]) => void }[]): Record<PassName, PassCost> {
  const costs = Object.fromEntries(PASS_NAMES.map((n) => [n, { calls: 0, triangles: 0 }])) as Record<PassName, PassCost>
  passes.forEach((pass, i) => {
    const cost = costs[PASS_NAMES[i]]
    const render = pass.render.bind(pass) as (...args: unknown[]) => void
    pass.render = ((...args: unknown[]) => {
      const info = renderer.info.render
      const calls = info.calls
      const triangles = info.triangles
      render(...args)
      cost.calls += info.calls - calls
      cost.triangles += info.triangles - triangles
    }) as never
  })
  return costs
}

/**
 * GtaoScenePass — une passe GTAO qui réutilise la profondeur du passage principal au lieu de
 * re-rendre la scène en matériau de normales : à chaque image on lui tend la profondeur de la
 * cible que le rendu de la scène vient d'écrire (le compositeur échange ses cibles entre les
 * passes), et les normales en sont reconstruites. La cible et le matériau de normales du GTAO,
 * posés pour ce re-rendu, n'ont plus de rôle.
 */
class GtaoScenePass extends GTAOPass {
  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    super(scene, camera, 1, 1)
    const interne = this as unknown as { normalRenderTarget: THREE.WebGLRenderTarget }
    interne.normalRenderTarget.dispose()
    this.normalMaterial.dispose()
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    const depth = readBuffer.depthTexture
    if (depth) this.setGBuffer(depth, undefined)
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive)
  }
}
