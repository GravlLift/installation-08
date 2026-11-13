import { frameToMs, trackWindow } from '@/lib/replay/replayLogic'
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'
import { LOADOUT_SRC_BIRTH, currentLifeOf, loadoutAt, type LoadoutReading } from '@/lib/replay/rosterLogic'
import { inventoryAt, type InventoryReading } from './inventoryReading'
import { covers } from './replaySpans'

/** L'emplacement d'arme en main d'une vie au fil du film : instants triés et emplacement (0 ou 1). */
export interface SuiviMain {
  ms: number[]
  w: number[]
}

/**
 * suivreMain date l'arme en main par vie, plus finement que l'image-clé de l'inventaire : chaque
 * bascule du sélecteur (`drawnWeapons`) et chaque lecture de chargeur tir par tir (un chargeur qui
 * bouge est celui de l'arme en main) affirment l'emplacement à leur instant.
 */
export function suivreMain(doc: ReplayDocumentReady): Map<number, SuiviMain> {
  const faits = new Map<number, { ms: number; w: number }[]>()
  const noter = (slot: number, ms: number, w: number) => {
    const liste = faits.get(slot) ?? []
    liste.push({ ms, w })
    faits.set(slot, liste)
  }
  for (const d of doc.drawnWeapons) if (d.d != null) noter(d.slot, frameToMs(d.t, doc), d.d)
  for (const l of doc.ammoReads) if (l.src === 'delta' && l.mag != null && (l.w === 0 || l.w === 1)) noter(l.slot, l.ms, l.w)
  const suivis = new Map<number, SuiviMain>()
  for (const [slot, liste] of faits) {
    liste.sort((a, b) => a.ms - b.ms)
    suivis.set(slot, { ms: liste.map((f) => f.ms), w: liste.map((f) => f.w) })
  }
  return suivis
}

const suivis = new WeakMap<ReplayDocumentReady, Map<number, SuiviMain>>()

/**
 * L'arme tenue, départagée par les lectures datées et bornée à la vie courante. Avant la première
 * lecture datée de la vie, l'emplacement vient de `avantPremiereLecture`.
 *
 * UNE LECTURE D'INVENTAIRE À VENIR NE SITUE PAS LA MAIN : une lecture datée passée de la vie
 * (sélecteur, chargeur) la prime, et sans celle-ci l'emplacement emprunté au futur n'est admis
 * que s'il porte une arme de la dotation de naissance — le joueur l'a dès le spawn, jamais une
 * prise qui arrive plus tard dans la vie.
 */
export function armeEnMain(doc: ReplayDocumentReady, slot: number, frame: number): { id: string; slotArme: number } | null {
  const life = currentLifeOf(doc, slot, frame)
  if (!life || doc.skullCarries.some((c) => c.xuid === life.xuid && covers(c, frame))) return null
  const lo = loadoutAt(doc, slot, frame)
  if (!lo) return null
  const inv = inventoryAt(doc, slot, frame)
  let suivi = suivis.get(doc)
  if (!suivi) { suivi = suivreMain(doc); suivis.set(doc, suivi) }
  const events = suivi.get(slot)
  const ms = frameToMs(frame, doc)
  const vie = trackWindow(life)
  const start = frameToMs(vie.start, doc)
  let debut = 0, fin = events?.ms.length ?? 0
  while (debut < fin) {
    const milieu = Math.floor((debut + fin) / 2)
    if (events!.ms[milieu] <= ms) debut = milieu + 1
    else fin = milieu
  }
  const index = debut - 1
  const eventMs = index >= 0 && events!.ms[index] >= start ? events!.ms[index] : -Infinity
  const invMs = inv ? frameToMs(inv.empty ? frame - inv.empty.age : inv.state.t, doc) : -Infinity
  const invFutur = inv != null && inv.age < 0
  let d: number | undefined
  if (invFutur) {
    // Lecture d'inventaire à venir : une lecture datée passée de la vie la prime ; sans elle,
    // seul un emplacement de la dotation de naissance est emprunté au futur.
    d = eventMs !== -Infinity ? events!.w[index] : inv && !inv.empty && dansLaDotation(lo, inv) ? inv.state.d : undefined
  } else {
    d = eventMs >= invMs && eventMs !== -Infinity ? events!.w[index] : inv && !inv.empty ? inv.state.d : undefined
  }
  if (d === 0 || d === 1) {
    const id = armeDeLEmplacement(doc, slot, frame, lo, d)
    if (id) return { id, slotArme: d }
  }
  // Une lecture passée de la vie qui ne situe pas la main la laisse vide.
  if (eventMs !== -Infinity || (inv && inv.age >= 0)) return null
  const suivante = events && debut < events.ms.length && events.ms[debut] <= frameToMs(vie.end, doc)
    ? { ms: events.ms[debut], w: events.w[debut] }
    : null
  const k = avantPremiereLecture(doc, { slot, frame, naissance: vie.start }, lo, suivante)
  if (k === undefined) return null
  const id = armeDeLEmplacement(doc, slot, frame, lo, k)
  return id ? { id, slotArme: k } : null
}

/**
 * L'arme de l'emplacement `d` dans la rangée lue, ou à défaut la prise datée la plus récente de
 * cet emplacement depuis le relevé de la rangée.
 */
function armeDeLEmplacement(doc: ReplayDocumentReady, slot: number, frame: number, lo: LoadoutReading, d: number): string | undefined {
  const id = lo.weapons[d]
  if (id) return id
  const changes = doc.weaponChanges.filter((c) => c.slot === slot && c.k === d && c.t > frame - lo.age && c.t <= frame).sort((a, b) => b.t - a.t)
  const w = changes[0]?.w
  if (!w) return undefined
  return /^[0-9a-f]{8}$/i.test(w) ? `0x${w.toUpperCase()}` : w
}

/** Un changement d'arme du slot est-il daté entre l'image `de` et l'instant `aMs`, bornes comprises ? */
function changementEntre(doc: ReplayDocumentReady, slot: number, de: number, aMs: number): boolean {
  return doc.weaponChanges.some((c) => c.slot === slot && c.t >= de && frameToMs(c.t, doc) <= aMs)
}

/**
 * dansLaDotation — l'emplacement désigné par une lecture d'inventaire À VENIR porte-t-il une arme
 * de la dotation de naissance ? C'est l'emprunt du futur que la main accepte : une arme que le
 * joueur a dès le spawn, jamais une prise qui arrive plus tard dans la vie. La rangée de naissance
 * est seule admissible : un relevé raffiné par une prise a perdu sa provenance `birth`.
 */
function dansLaDotation(lo: LoadoutReading, inv: InventoryReading): boolean {
  const d = inv.state.d
  return (d === 0 || d === 1) && lo.src === LOADOUT_SRC_BIRTH && lo.weapons[d] != null
}

/**
 * avantPremiereLecture : l'emplacement en main d'une vie qu'aucune lecture datée (sélecteur,
 * chargeur, inventaire) n'a encore situé à `frame`. Un joueur ne quitte son arme qu'au prix d'un
 * événement, d'où deux preuves seulement, dans cet ordre :
 *   1. la première lecture datée À VENIR de la même vie (`suivante`), quand aucun changement
 *      d'arme du slot n'est daté entre la naissance et elle : la main tient depuis la naissance
 *      l'emplacement que cette lecture affirme ;
 *   2. l'arme UNIQUE de la rangée, quand aucun changement d'arme n'est daté entre la naissance et
 *      l'image (ou le relevé de la rangée, s'il est à venir) : une seule arme portée est en main.
 * Sans l'une ou l'autre, la main reste vide : aucune arme que le document ne situe pas.
 */
function avantPremiereLecture(
  doc: ReplayDocumentReady,
  vie: { slot: number; frame: number; naissance: number },
  lo: LoadoutReading,
  suivante: { ms: number; w: number } | null,
): number | undefined {
  if (suivante && (suivante.w === 0 || suivante.w === 1) && !changementEntre(doc, vie.slot, vie.naissance, suivante.ms)) {
    return suivante.w
  }
  const portees = lo.weapons.filter(Boolean)
  if (portees.length !== 1) return undefined
  const releve = frameToMs(Math.max(vie.frame, vie.frame - lo.age), doc)
  const k = lo.weapons.indexOf(portees[0])
  return (k === 0 || k === 1) && !changementEntre(doc, vie.slot, vie.naissance, releve) ? k : undefined
}

/** L'emplacement d'arme des objets portés (crâne), à côté des deux armes de la rangée. */
const EMPLACEMENT_OBJET = 2

/**
 * craneEnMain : le crâne d'Oddball que la vie `slot` porte à `frame`, sous son identifiant d'arme ;
 * null hors portage. L'identifiant vient de la prise la plus récente de l'emplacement d'objet par
 * cette vie, à défaut d'une prise quelconque du match (le portage est daté par le score, sa prise
 * peut le suivre de quelques images).
 */
export function craneEnMain(doc: ReplayDocumentReady, slot: number, frame: number): { id: string; slotArme: number } | null {
  const life = currentLifeOf(doc, slot, frame)
  if (!life || !doc.skullCarries.some((c) => c.xuid === life.xuid && covers(c, frame))) return null
  let propre: string | undefined, autre: string | undefined
  let quand = -Infinity
  for (const c of doc.weaponChanges) {
    if (c.k !== EMPLACEMENT_OBJET || c.kind !== 'taken' || !c.w) continue
    autre ??= c.w
    if (c.slot === slot && c.t <= frame && c.t > quand) { propre = c.w; quand = c.t }
  }
  const w = propre ?? autre
  if (!w) return null
  return { id: /^[0-9a-f]{8}$/i.test(w) ? `0x${w.toUpperCase()}` : w, slotArme: EMPLACEMENT_OBJET }
}

