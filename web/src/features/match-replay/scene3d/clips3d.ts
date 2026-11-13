/**
 * clips3d.ts — LES ANIMATIONS DU JEU DU SPARTAN, lues dans son GLB (`spartan.glb`, une animation glTF
 * par nom du jeu, `posture:classe[:type]:action`, cf. `meshproto.AnimationsSpartan`).
 *
 * Chaque animation est écrite SUR PLACE à sa cadence : une piste par os et par propriété (rotation,
 * translation), soit une seule clé (os fixe), soit une clé par image de l'animation. Le déplacement
 * de racine par image (axes glTF = repère du modèle) n'est pas sur le squelette : il est dans les
 * extras de l'animation (`levelupAnimation.rootMotion`), que GLTFLoader ne recopie pas dans
 * `AnimationClip.userData` : on le lit dans le JSON du GLB. Il donne la longueur de la foulée d'un
 * cycle, d'où le temps d'un clip de locomotion se tire de la distance parcourue.
 *
 * Le catalogue d'une source du Spartan se range à côté d'elle (`registerSpartanClips`) : toute copie
 * de cette source (`spartan3d`, la sonde des bouches) le retrouve sans autre chemin.
 */
import type * as THREE from 'three'

/** La clé des extras d'une animation (`himap.CleAnimationGLB`). */
const EXTRAS_KEY = 'levelupAnimation'
/** La cadence par défaut des anciens GLB. */
export const CLIP_FPS = 30

/** Une piste d'un clip : un os, une propriété, ses valeurs (1 clé, ou une par image). */
export interface ClipTrack {
  bone: string
  /** 4 : rotation (quaternion x, y, z, w), 3 : translation. */
  size: 3 | 4
  values: Float32Array
  /** 1 (os fixe) ou le nombre d'images du clip. */
  keys: number
}

/** Une animation du jeu prête à échantillonner. */
export interface SpartanClip {
  name: string
  /** Nombre d'images. */
  frames: number
  /** Cadence du clip (images/s). */
  frameRate: number
  /** Durée d'un cycle bouclé (s) : `frames / frameRate` (la dernière image revient à la première). */
  cycle: number
  /** Durée jouée une fois (s) : `(frames - 1) / frameRate`. */
  once: number
  /** Distance au sol parcourue par un cycle (u), 0 pour un clip sur place. */
  stride: number
  /**
   * La phase (fraction du cycle, [0, 1)) où le pied gauche mène le plus loin dans le sens du
   * déplacement : le repère commun qui accorde les clips de locomotion mêlés. 0 pour un clip sur
   * place ; mesurée sur le squelette par `measureSyncPhases` (`clipSample3d`).
   */
  sync: number
  /** Le sens du déplacement d'un cycle (x, z du repère du modèle, unitaire), [0, 0] sur place. */
  dir: readonly [number, number]
  tracks: ClipTrack[]
}

export class SpartanClips {
  private readonly byName = new Map<string, SpartanClip>()

  readonly weaponClips?: WeaponClips

  constructor(clips: readonly SpartanClip[], weaponClips?: WeaponClips) {
    this.weaponClips = weaponClips
    for (const c of clips) this.byName.set(c.name, c)
  }

  /** get : le clip `name`, undefined quand le GLB ne le porte pas. */
  get(name: string): SpartanClip | undefined {
    return this.byName.get(name)
  }

  /** names : les noms des clips, dans l'ordre du GLB. */
  names(): string[] {
    return [...this.byName.keys()]
  }

  /** bones : les os que les clips animent, chacun une fois. */
  bones(): string[] {
    const out = new Set<string>()
    for (const c of this.byName.values()) for (const t of c.tracks) out.add(t.bone)
    return [...out]
  }
}

/** Les noms de clips par arme et par classe publiés dans les extras du GLB. */
export interface WeaponClips {
  weapons: { weapon: string; class: string; reload?: string }[]
  classes: { class: string; reload?: string }[]
}

/** L'animation telle que le JSON du GLB la décrit (nom, extras). */
export interface GltfAnimationJson {
  name?: string
  extras?: Record<string, unknown>
}

/**
 * clipsOf : le catalogue des animations `animations` (celles de GLTFLoader) dont `json` est la liste
 * du GLB dans le même ordre. Une piste qui n'a ni une clé ni une clé par image, ou qui ne porte ni
 * rotation ni translation, est écartée (journalisée) : l'échantillonneur lit par image.
 */
export function clipsOf(animations: readonly THREE.AnimationClip[], json: readonly GltfAnimationJson[], weaponClips?: WeaponClips): SpartanClips {
  const out: SpartanClip[] = []
  animations.forEach((a, i) => {
    const extras = json[i]?.name === a.name ? (json[i].extras?.[EXTRAS_KEY] as AnimationExtras | undefined) : undefined
    const frames = extras?.frameCount ?? 0
    if (frames < 1) {
      console.warn('rejeu 3D : animation sans nombre d’images, écartée', a.name)
      return
    }
    const frameRate = extras?.frameRate && extras.frameRate > 0 ? extras.frameRate : CLIP_FPS
    const travel = travelOf(extras?.rootMotion ?? [])
    out.push({
      name: a.name,
      frames,
      frameRate,
      cycle: frames / frameRate,
      once: (frames - 1) / frameRate,
      stride: travel.stride,
      sync: 0,
      dir: travel.dir,
      tracks: tracksOf(a, frames),
    })
  })
  return new SpartanClips(out, weaponClips)
}

interface AnimationExtras {
  frameCount?: number
  frameRate?: number
  rootMotion?: readonly (readonly number[])[]
}

/** En deçà (u par cycle), un clip est sur place : ses pas ne se règlent pas sur la distance. */
const STILL_STRIDE = 0.05

/**
 * travelOf : la distance au sol d'un cycle (somme des déplacements horizontaux par image, u) et
 * son sens (unitaire, [0, 0] pour un clip sur place).
 */
function travelOf(rootMotion: readonly (readonly number[])[]): { stride: number; dir: [number, number] } {
  let x = 0
  let z = 0
  for (const d of rootMotion) {
    x += d[0] ?? 0
    z += d[2] ?? 0
  }
  const stride = Math.hypot(x, z)
  return stride < STILL_STRIDE ? { stride: 0, dir: [0, 0] } : { stride, dir: [x / stride, z / stride] }
}

const PROPERTY_SIZE: Readonly<Record<string, 3 | 4>> = { quaternion: 4, position: 3 }

/**
 * tracksOf : les pistes lisibles de `a`. Une échelle unité (les os d'aide des épaules et des
 * avant-bras en portent une, constante, dans chaque clip) est le repos : écartée sans bruit.
 * Les autres pistes écartées sont journalisées en une ligne par clip.
 */
function tracksOf(a: THREE.AnimationClip, frames: number): ClipTrack[] {
  const out: ClipTrack[] = []
  const dropped: string[] = []
  for (const t of a.tracks) {
    const dot = t.name.lastIndexOf('.')
    const property = t.name.slice(dot + 1)
    if (property === 'scale' && isUnit(t.values)) continue
    const size = PROPERTY_SIZE[property]
    const keys = t.times.length
    if (!size || (keys !== 1 && keys !== frames)) {
      dropped.push(`${t.name} (${keys})`)
      continue
    }
    out.push({ bone: t.name.slice(0, dot), size, values: Float32Array.from(t.values), keys })
  }
  if (dropped.length > 0) console.warn('rejeu 3D : pistes d’animation écartées', a.name, dropped.join(', '))
  return out
}

/** UNIT_SCALE_EPS : l'écart à 1 sous lequel une échelle cuite en flottants vaut l'unité. */
const UNIT_SCALE_EPS = 1e-4

function isUnit(values: ArrayLike<number>): boolean {
  for (let i = 0; i < values.length; i++) if (Math.abs(values[i] - 1) > UNIT_SCALE_EPS) return false
  return true
}

const registry = new WeakMap<THREE.Object3D, SpartanClips>()

/** registerSpartanClips range le catalogue `clips` de la source du Spartan `source`. */
export function registerSpartanClips(source: THREE.Object3D, clips: SpartanClips): void {
  registry.set(source, clips)
}

/** spartanClipsOf : le catalogue rangé pour `source`, null sans animation. */
export function spartanClipsOf(source: THREE.Object3D): SpartanClips | null {
  return registry.get(source) ?? null
}
