import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'

// Couverture neutre quand le monde ne publie pas de mesure exploitable.
const COUVERTURE_NEUTRE = 0.48
const VITESSE_NUAGES = 0.0008
const DISTANCE_CIEL = 400
// Le modèle d'atmosphère sort des valeurs faites pour une exposition basse : ce facteur
// propre au ciel le ramène sous l'exposition de la scène, sans toucher à celle-ci.
const EXPOSITION_CIEL = '0.3'
// Luminance des nuages éclairés, dans la même échelle que le ciel exposé.
const ECLAT_NUAGES = '0.95'
// Teinte du ciel sans lumière directe (bleu nuit, pas une couleur d'interface), plus claire vers l'horizon.
const CIEL_NUIT = 'vec3(0.006, 0.009, 0.02)'
// Intensité de soleil déclarée par les cartes de plein jour sur lesquelles la lumière directe
// de la vue a été réglée : à cette valeur ou au-dessus, le soleil de la vue garde toute sa force.
const SOLEIL_REFERENCE = 8

/** Facteur de lumière directe : intensité du jeu ramenée à celle d'une carte de plein jour. */
export function intensiteSoleil(extras: unknown): number {
  const data = extras as { levelupSun?: { intensity?: unknown }; ciel?: { sunIntensity?: unknown } } | null
  const valeur = data?.levelupSun?.intensity ?? data?.ciel?.sunIntensity
  return typeof valeur === 'number' && Number.isFinite(valeur) && valeur >= 0 ? Math.min(valeur / SOLEIL_REFERENCE, 1) : 1
}

/** Lit la presence du ciel et la texture glTF optionnelle. */
export function lireCiel(extras: unknown): { texture: number | null; color: [number, number, number] | null } | null {
  if (!extras || typeof extras !== 'object') return null
  const ciel = (extras as { ciel?: unknown }).ciel
  if (!ciel || typeof ciel !== 'object' || Array.isArray(ciel)) return null
  const texture = (ciel as { cloudTexture?: unknown }).cloudTexture
  const color = (extras as { levelupSun?: { color?: unknown } }).levelupSun?.color
  return { texture: typeof texture === 'number' && Number.isSafeInteger(texture) && texture >= 0 ? texture : null,
    color: Array.isArray(color) && color.length === 3 && color.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0) ? color as [number, number, number] : null }
}

/**
 * Le ciel suit l'œil et ne participe ni aux ombres ni aux sondes de la carte. `jour` est le
 * facteur de lumière directe de la carte (0 à 1) : la luminance du ciel et des nuages le suit,
 * sans lumière directe il tend vers un bleu nuit.
 */
export function creerCiel(sun: { azimuth: number; elevation: number }, texture: THREE.Texture | null, color: [number, number, number] | null, jour: number): Sky {
  const ciel = new Sky()
  ciel.scale.setScalar(DISTANCE_CIEL)
  ciel.frustumCulled = false
  ciel.renderOrder = -1000
  ciel.material.depthTest = false
  ciel.material.depthWrite = false
  ciel.material.fog = false
  const az = THREE.MathUtils.degToRad(sun.azimuth)
  const el = THREE.MathUtils.degToRad(sun.elevation)
  ciel.material.uniforms.sunPosition.value.set(Math.cos(el) * Math.cos(az), Math.sin(el), -Math.cos(el) * Math.sin(az)).multiplyScalar(450000)
  ciel.material.uniforms.turbidity.value = 3
  ciel.material.uniforms.rayleigh.value = 2
  ciel.material.uniforms.sunColor = { value: new THREE.Vector3(...(color ?? [1, 1, 1])) }
  ciel.material.fragmentShader = ciel.material.fragmentShader.replace('void main() {', 'uniform vec3 sunColor;\nvoid main() {')
    .replace('( vSunE * 19000.0 * Fex ) * sundisk', '( vSunE * 19000.0 * Fex ) * sunColor * sundisk')
    .replace('gl_FragColor = vec4( retColor, 1.0 );', `retColor *= ${EXPOSITION_CIEL};\ngl_FragColor = vec4( mix(${CIEL_NUIT} * (1.6 - direction.y), retColor, jour), 1.0 );`)
  ciel.material.uniforms.jour = { value: THREE.MathUtils.clamp(jour, 0, 1) }
  ciel.material.fragmentShader = ciel.material.fragmentShader.replace('void main() {', 'uniform float jour;\nvoid main() {')
  if (texture) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.colorSpace = THREE.NoColorSpace
    texture.needsUpdate = true
    ciel.material.uniforms.cloudMask = { value: texture }
    ciel.material.uniforms.cloudTime = { value: 0 }
    ciel.material.uniforms.cloudCoverage = { value: COUVERTURE_NEUTRE }
    ciel.material.fragmentShader = ciel.material.fragmentShader.replace('void main() {', 'uniform sampler2D cloudMask;\nuniform float cloudTime;\nuniform float cloudCoverage;\nvoid main() {')
      .replace('gl_FragColor = vec4( mix(${CIEL_NUIT} * (1.6 - direction.y), retColor, jour), 1.0 );', `
        vec2 cloudUV = direction.xz / max(direction.y + 0.45, 0.3) * 1.4 + vec2(cloudTime, cloudTime * 0.3);
        float mask = 1.0 - texture2D(cloudMask, cloudUV).r;        float clouds = smoothstep(1.0 - cloudCoverage - 0.22, 1.0 - cloudCoverage + 0.22, mask);
        clouds *= smoothstep(0.02, 0.28, direction.y);
        float sunlight = 0.7 + 0.3 * max(dot(direction, vSunDirection), 0.0);
        retColor = mix(retColor, vec3(${ECLAT_NUAGES}) * sunlight, clouds * 0.88);
        gl_FragColor = vec4( mix(${CIEL_NUIT} * (1.6 - direction.y), retColor, jour), 1.0 );`)
  }
  ciel.onBeforeRender = (_renderer, _scene, camera) => {
    ciel.position.copy(camera.position)
    ciel.updateMatrixWorld()
    const seconds = (ciel.userData.cloudClockS as number | null | undefined) ?? performance.now() * 0.001
    if (texture) ciel.material.uniforms.cloudTime.value = seconds * VITESSE_NUAGES
  }
  return ciel
}

/**
 * setCloudClock drives the clouds from `seconds` of match time (the video export, which renders
 * off real time), or hands them back to the wall clock (`null`).
 */
export function setCloudClock(ciel: THREE.Object3D, seconds: number | null): void {
  ciel.userData.cloudClockS = seconds
}
