/**
 * deaths3d.ts — LES MORTS DANS LA SCÈNE 3D : une croix au sol là où la victime est tombée, le tueur
 * et l'arme du kill au-dessus, et, au premier instant, le trait du tueur vers sa victime.
 *
 * Les kills sont ceux du fil, recalés une fois par la page ; la croix tient la même durée que celle
 * de la 2D. Les positions passent par le même résolveur que la 2D (`buildCarrierPosAt`) : un joueur
 * tué à bord tombe sur son véhicule. Le trait n'est tiré que si les deux positions sont relues
 * (jamais un axe inventé), seulement pendant la durée d'un tir, et seulement quand le tiroir allume
 * les lignes de tir (`aids3d.shotLines`) : le jeu ne le montre pas.
 *
 * L'étiquette se lit comme le fil : « tueur › victime · arme ». L'arme est celle que la base donne au
 * kill (`weaponLabel`), vide pour la mêlée et les grenades. Un tueur inconnu laisse la croix seule.
 * Croix et étiquette sont un repère d'analyse (`aids3d.deathMarkers`, éteint) : le jeu ne les pose
 * pas sur la carte. L'interrupteur des morts du tiroir 2D (`show.kills`) les coiffe tous deux.
 *
 * Le corps de la victime (`corpses3d`) tombe à la fin de sa vie en corps inerte poussé par ce qui l'a
 * tué (cuisson par mort, `ragdollBakery3d` ; par les clips de mort du jeu, `fall3d`, tant qu'elle
 * n'est pas prête), et reste où il a fini aussi longtemps que la croix ; il est du monde, pas du tiroir :
 * masquer les morts n'efface que la croix, le trait et l'étiquette.
 */
import * as THREE from 'three'

import { msToFrames } from '@/lib/replay/replayLogic'

import { familyOf } from '../layers/shotEffects'
import { buildCarrierPosAt } from '../model/carrierPosition'
import type { ReplayKill } from '../model/killFeedLogic'
import { InstancePool, LabelPool, SegmentPool, firstFrom } from './actionKit'
import type { ActionContext, ActionLayer3d } from './actionScene3d'
import { BODY_CENTER, TAG_HEIGHT } from './body3d'
import { Corpses3d, type Corpse } from './corpses3d'
import { bodyPosition } from './deathCamera3d'
import { fallKindOf, type FallKind } from './fall3d'
import { FRAME_BUDGET_MS, RagdollBakery, type BakeryStats } from './ragdollBakery3d'
import { aimDirThree, toThree } from './tracks3d'

const CROSS_ARM = new THREE.Vector3(0.5, 0.03, 0.08)
const CROSS_LIFT = 0.03
const LINK_RADIUS = 0.01
const LABEL_LIFT = TAG_HEIGHT * 0.6
const TURN = [new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 4)]

export interface Death3d {
  frame: number
  killer: string
  victim: string
  /** Pieds de la victime (axes three). */
  at: THREE.Vector3
  /** Pieds du tueur, seulement quand les deux positions sont relues. */
  from: THREE.Vector3 | null
  weapon: string
  /**
   * Le corps : l'image où la victime n'est plus en vie (début de la chute) et sa chute ; null quand
   * la vie qui finit n'est pas relue près du kill (jamais un corps à côté d'un joueur vivant).
   */
  body: { start: number; fall: Corpse } | null
}

/** Le retard au plus entre le kill du fil et la fin de la vie de sa victime (s). */
const DEATH_LAG_SECONDS = 1
/** Le pas de la recherche de cette fin (images). */
const DEATH_LAG_STEP = 0.25
/** En deçà (u), tueur et victime sont confondus : l'impulsion ne se lit pas entre eux. */
const MIN_PUSH = 0.05

export class Deaths3dLayer implements ActionLayer3d {
  readonly labels: LabelPool
  private readonly crosses: InstancePool
  private readonly links: SegmentPool
  private readonly corpses: Corpses3d
  private readonly bakery: RagdollBakery
  private source: readonly ReplayKill[] | null = null
  private deaths: Death3d[] = []
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()
  private readonly ctx: ActionContext

  constructor(ctx: ActionContext) {
    this.ctx = ctx
    this.labels = new LabelPool(ctx.root)
    this.crosses = new InstancePool(ctx.root, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), 128)
    this.links = new SegmentPool(ctx.root, new THREE.MeshBasicMaterial({ toneMapped: false }), 64)
    this.corpses = new Corpses3d(ctx.root, ctx.probeAt, ctx.baked ?? null)
    this.bakery = new RagdollBakery(ctx)
  }

  update(frame: number): void {
    const inputs = this.ctx.inputs()
    this.labels.begin()
    this.crosses.begin()
    this.links.begin()
    this.corpses.begin(this.ctx.spartanModel())
    this.syncDeaths()
    const hold = Math.max(1, inputs.deathHoldFrames)
    const fps = Math.max(1, inputs.framesPerSecond)
    for (let i = firstFrom(this.deaths, (d) => d.frame, frame - hold); i < this.deaths.length; i++) {
      const d = this.deaths[i]
      if (d.frame > frame) break
      if (inputs.show.kills) this.draw(d, frame - d.frame, inputs.shotHoldFrames)
      if (d.body && d.body.start <= frame) this.drawBody(d, d.body, (frame - d.body.start) / fps)
    }
    this.labels.end()
    this.crosses.end()
    this.links.end()
    this.corpses.end()
    this.bakery.pump(frame, hold, performance.now() + FRAME_BUDGET_MS)
  }

  /** settle bakes, to completion, the bodies visible at `frame` (the video export, `ActionScene3d.settle`). */
  settle(frame: number): void {
    this.syncDeaths()
    this.bakery.bakeVisible(frame, Math.max(1, this.ctx.inputs().deathHoldFrames))
  }

  /** syncDeaths rebuilds the deaths when the page's kill list changed. */
  private syncDeaths(): void {
    const kills = this.ctx.inputs().kills
    if (kills === this.source) return
    this.source = kills
    this.deaths = buildDeaths3d(this.ctx, kills)
    this.bakery.setDeaths(this.deaths)
  }

  /** Prépare une copie de chaque victime possible avec la teinte du calque. */
  prepareCorpses(): THREE.Object3D[] {
    this.corpses.begin(this.ctx.spartanModel())
    return this.ctx.tracks.players.flatMap((p) => {
      const { key, tint } = this.corpseStyle(p.xuid)
      const root = this.corpses.prepare(key, tint, this.ctx.dressOf(p.xuid))
      return root ? [root] : []
    })
  }

  private corpseStyle(xuid: string): { key: string; tint: THREE.Color } {
    const inputs = this.ctx.inputs()
    const css = inputs.colorOfXuid(xuid) ?? inputs.inks.shot
    return { key: `${css}|${xuid}`, tint: this.ctx.ink.of(css) }
  }

  /** ragdollStats : les mesures des cuissons de corps inertes faites (`ragdollBakery3d`). */
  ragdollStats(): BakeryStats {
    return this.bakery.stats()
  }

  /**
   * corpseFeet : les pieds du corps inerte de la victime `xuid` à l'image `frame` (axes three), écrits
   * dans `out` ; null sans corps à cette image. Sert la caméra de mort (`deathCamera3d`).
   */
  corpseFeet(xuid: string, frame: number, out: THREE.Vector3): THREE.Vector3 | null {
    const d = this.currentBody(xuid, frame)
    if (!d || !d.body) return null
    bodyPosition(d.body.fall, (frame - d.body.start) / Math.max(1, this.ctx.inputs().framesPerSecond), this.bakery.get(d), out)
    return out
  }

  /**
   * currentBody : la mort de `xuid` dont le corps est le plus récent à démarrer avant `frame`, null
   * sans corps. Entre deux morts le joueur est en vie, donc le corps le plus récent est le courant.
   */
  private currentBody(xuid: string, frame: number): Death3d | null {
    let best: Death3d | null = null
    let bestStart = -Infinity
    for (const d of this.deaths) {
      if (d.victim !== xuid || !d.body || d.body.start > frame) continue
      if (d.body.start > bestStart) { best = d; bestStart = d.body.start }
    }
    return best
  }

  dispose(): void {
    this.labels.dispose()
    this.crosses.dispose()
    this.links.dispose()
    this.corpses.dispose()
    this.bakery.dispose()
  }

  private drawBody(d: Death3d, body: NonNullable<Death3d['body']>, t: number): void {
    const { key, tint } = this.corpseStyle(d.victim)
    this.corpses.add(body.fall, t, tint, key, this.ctx.dressOf(d.victim), this.bakery.get(d))
  }

  private draw(d: Death3d, age: number, linkFrames: number): void {
    const inputs = this.ctx.inputs()
    const css = inputs.colorOfXuid(d.killer) ?? inputs.inks.shot
    const color = this.ctx.ink.of(css)
    if (inputs.aids.shotLines && d.from && age <= linkFrames) {
      this.links.add(this.b.copy(d.from).setY(d.from.y + BODY_CENTER), this.a.copy(d.at).setY(d.at.y + BODY_CENTER), LINK_RADIUS, color)
    }
    if (!inputs.aids.deathMarkers) return
    const ground = this.a.copy(d.at).setY(d.at.y + CROSS_LIFT)
    for (const q of TURN) this.crosses.add(ground, q, CROSS_ARM, color)
    const text = deathText(inputs.nameOfXuid(d.killer), inputs.nameOfXuid(d.victim), d.weapon)
    if (text) this.labels.add(this.a.copy(d.at).setY(d.at.y + LABEL_LIFT), text, css)
  }
}

/**
 * deathText : l'étiquette d'une mort, lue comme une ligne du fil — « tueur › victime · arme ». Sans
 * tueur nommé, rien : la croix seule. Sans victime nommée, le tueur et l'arme.
 */
export function deathText(killer: string | null, victim: string | null, weapon: string): string | null {
  if (!killer) return null
  const who = victim ? `${killer} › ${victim}` : killer
  return weapon ? `${who} · ${weapon}` : who
}

/** buildDeaths3d : les morts localisées, triées par image, pieds posés sur la carte. */
export function buildDeaths3d(ctx: ActionContext, kills: readonly ReplayKill[]): Death3d[] {
  const { doc } = ctx
  const posOf = buildCarrierPosAt(doc)
  const seated = ctx.inputs().seatedOfXuid
  const out: Death3d[] = []
  for (const k of kills) {
    if (!k.victimXuid) continue
    const frame = deathFrame(ctx, k.victimXuid, Math.round(msToFrames(k.replayMs, doc)))
    const at = feetAt(ctx, posOf(k.victimXuid, frame), k.victimXuid, frame)
    if (!at) continue
    const from = seated(k.xuid, frame) ? feetAt(ctx, posOf(k.xuid, frame), k.xuid, frame) : null
    const kind = fallKindOf(k, familyOf(k.weaponKey ? ctx.doc.killEffects?.[k.weaponKey] : undefined))
    const body = bodyOf(ctx, k.victimXuid, frame, at, from, kind)
    out.push({ frame, killer: k.xuid, victim: k.victimXuid, at, from, weapon: k.weaponLabel, body })
  }
  return out.sort((p, q) => p.frame - q.frame)
}

/**
 * deathFrame : l'image de la mort d'une victime dont le fil annonce le kill à `killFrame`. Le fil
 * suit la fin de la vie de peu : la mort se pose sur cette fin quand elle précède le kill de moins
 * de `DEATH_LAG_SECONDS`, pour que le corps vivant laisse place au corps inerte sans image vide.
 */
function deathFrame(ctx: ActionContext, victim: string, killFrame: number): number {
  if (ctx.tracks.sample(victim, killFrame)) return killFrame
  const end = ctx.tracks.lifeEndBefore(victim, killFrame)
  const lag = DEATH_LAG_SECONDS * Math.max(1, ctx.inputs().framesPerSecond)
  return end !== null && killFrame - end <= lag ? end : killFrame
}

/**
 * bodyOf : le corps de la victime d'un kill à l'image `frame`. La chute part de la fin de sa vie
 * (cherchée jusqu'à `DEATH_LAG_SECONDS` après le kill), dans la direction du tueur vers elle quand
 * les deux positions sont relues, vers son dos sinon.
 */
function bodyOf(
  ctx: ActionContext,
  victim: string,
  frame: number,
  at: THREE.Vector3,
  from: THREE.Vector3 | null,
  kind: FallKind,
): Death3d['body'] {
  const lag = DEATH_LAG_SECONDS * Math.max(1, ctx.inputs().framesPerSecond)
  let start = frame
  while (ctx.tracks.sample(victim, start)) {
    start += DEATH_LAG_STEP
    if (start > frame + lag) return null
  }
  const last = ctx.tracks.lastLifeBefore(victim, start)
  if (!last) return null
  const dir = from ? new THREE.Vector3(at.x - from.x, 0, at.z - from.z) : new THREE.Vector3()
  if (dir.length() < MIN_PUSH) {
    const [x, , z] = aimDirThree(last.h, 0)
    dir.set(-x, 0, -z)
  }
  start = ctx.tracks.life(victim, start - DEATH_LAG_STEP)?.t1 ?? start
  return { start, fall: { at, dir: dir.normalize(), h: last.h, kind } }
}

/** feetAt : un point (x, y) du rejeu posé à la hauteur des pieds du joueur, ou sur le sol à défaut. */
function feetAt(ctx: ActionContext, xy: { x: number; y: number } | null, xuid: string, frame: number): THREE.Vector3 | null {
  if (!xy) return null
  const [x, , z] = toThree(xy.x, xy.y, 0)
  const alive = ctx.playerFeet(xuid, frame)
  const fallen = alive ? null : ctx.tracks.lastLifeBefore(xuid, frame + 1)
  const y = alive?.y ?? (fallen ? fallen.z - ctx.originAboveFloor : ctx.ground.floorY(xy.x, xy.y, null))
  return y === null ? null : new THREE.Vector3(x, y, z)
}
