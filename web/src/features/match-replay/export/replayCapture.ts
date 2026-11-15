/**
 * replayCapture.ts — CE QUI SORT DU REJEU : le nom du fichier, le téléchargement, et l'image
 * du canvas.
 *
 * POURQUOI UN MODULE À PART, et pas trois lignes dans le composant. Les trois opérations
 * ci-dessous sont les seules du chantier de capture qui ne dépendent NI de React, NI de
 * l'état de lecture : nommer, remettre un blob au navigateur, et lire les pixels d'une toile.
 * Les isoler les rend testables sans monter un composant — et le seuil de taille du canvas
 * (`max-lines` eslint, R5) interdit de toute façon d'y loger la moindre logique.
 *
 * # LE NOM DIT L'INSTANT DU MATCH, PAS L'HEURE DE L'ORDINATEUR
 *
 * Un rejeu se relit à plusieurs, et le fichier voyage : `replay-<match>-12m34s.png` se replace
 * tout seul dans la partie, là où un horodatage local ne dit rien à personne d'autre. C'est
 * pour cela que l'horodatage n'est qu'un REPLI — il n'apparaît que quand le match ou son
 * instant manquent, et il vaut alors mieux qu'un nom qui MENTIRAIT sur l'instant capturé
 * (« 0m00s » se lirait « coup d'envoi »).
 *
 * L'HORLOGE DU REPLI EST UN PARAMÈTRE, jamais un `Date.now()` enfoui : une fonction de nommage
 * qui lit l'heure du système n'est pas testable, et ce module existe justement pour l'être.
 */

/** Les caractères qu'un nom de fichier garde ; tout le reste devient un tiret. */
const FILENAME_SAFE = /[^A-Za-z0-9._-]+/g

/**
 * buildCaptureFilename rend le nom du fichier téléchargé (décision 8 du plan).
 *
 * Nominal : `replay-<matchId>-<XmYYs>.<ext>`, où `XmYYs` est le temps de MATCH de l'instant
 * capturé (le début de l'enregistrement, pour une vidéo). Avec une SECONDE borne (export de
 * plage) : `replay-<matchId>-<debut>-<fin>.<ext>`. Repli, quand le match n'est pas identifiable
 * OU que son instant est inconnu : `replay-<AAAAMMJJ-HHMMSS>.<ext>`.
 */
export function buildCaptureFilename(
  matchId: string | null,
  matchMs: number | null,
  ext: string,
  now: Date,
  /**
   * LA SECONDE BORNE, pour un EXPORT DE PLAGE : le nom devient
   * `replay-<match>-4m10s-6m30s.mp4`. Absente pour une capture d'image ou un enregistrement,
   * qui n'ont qu'un instant. SANS ELLE, deux exports de plages differentes qui partagent leur
   * fin porteraient le MEME nom et s'ecraseraient dans le dossier de telechargements.
   */
  endMs?: number | null,
): string {
  const id = (matchId ?? '').trim().replace(FILENAME_SAFE, '-')
  if (id === '' || matchMs === null || !Number.isFinite(matchMs)) {
    return `replay-${stampOf(now)}.${ext}`
  }
  const span =
    endMs !== null && endMs !== undefined && Number.isFinite(endMs)
      ? `${matchClock(matchMs)}-${matchClock(endMs)}`
      : matchClock(matchMs)
  return `replay-${id}-${span}.${ext}`
}

/** `XmYYs` : les minutes sans zéro de tête, les secondes toujours sur deux chiffres. */
function matchClock(ms: number): string {
  const total = Math.max(Math.floor(ms / 1000), 0)
  const sec = total % 60
  return `${Math.floor(total / 60)}m${sec < 10 ? '0' : ''}${sec}s`
}

/** `AAAAMMJJ-HHMMSS` en heure LOCALE : le repli sert à l'utilisateur, pas à une machine. */
function stampOf(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
  return `${date}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}

/**
 * DÉLAI AVANT DE RELÂCHER L'URL D'OBJET, en millisecondes.
 *
 * CE N'EST PAS UN CONFORT, C'EST LA CONDITION POUR QUE LE FICHIER ARRIVE. Un clic sur une
 * ancre `download` ne COPIE pas le blob : il demande au navigateur d'aller LIRE l'URL, et
 * cette lecture est asynchrone. Révoquer l'URL au retour du clic — ce que faisait ce module
 * jusqu'au 2026-08-28 — coupe la source sous le téléchargement qui vient de démarrer. Une
 * image PNG de quelques centaines de kilo-octets y survivait (elle tenait dans le premier
 * souffle) ; un CLIP VIDÉO de plusieurs dizaines de méga-octets, non — le fichier n'arrivait
 * jamais, sans la moindre erreur pour le dire.
 *
 * UNE SECONDE, ET PAS ZÉRO : le tick suivant suffirait à sortir du clic, mais pas à garantir
 * que la lecture du blob est engagée sur une machine chargée. Une seconde est invisible pour
 * l'utilisateur (le fichier est déjà en cours de dépôt) et large pour le navigateur. Ce n'est
 * PAS une fuite : la révocation a bien lieu, elle attend simplement son tour.
 */
const URL_RELEASE_MS = 1000

/**
 * holdDownload garde un blob prêt à descendre dans le dossier de téléchargements : l'URL
 * d'objet est créée MAINTENANT, le clic part plus tard, à la main.
 *
 * POURQUOI UN TOUT AUTRE GESTE QUE `triggerDownload`. Un clic sur une ancre `download`
 * déposé par le CODE, des minutes après le dernier geste de l'utilisateur, n'a plus le
 * geste derrière : Chrome bloque le SECOND fichier non demandé d'un site (« Needs
 * permission to download »). Le premier passe, le deuxième non — et le film, c'est le
 * deuxième. Le clic qui déclenche le téléchargement doit donc venir de l'utilisateur,
 * sur un bouton visible ; ce que le code prépare d'avance, c'est seulement l'URL.
 *
 * Le `release` rend la main : il révoque l'URL et rend le blob au collecteur. À
 * appeler quand l'utilisateur ferme le dialogue SANS avoir sauvé — un blob que plus
 * personne ne peut sauver doit être rendu (cf. `useReplayExport`, la phase `done`).
 */
export interface PendingDownload {
  /** Déclenche le téléchargement. À appeler UNIQUEMENT depuis le clic d'un utilisateur. */
  save: () => void
  /** Révoque l'URL d'objet et rend le blob au collecteur. Le blob ne descendra pas. */
  release: () => void
}

/**
 * holdDownload prépare un téléchargement sans le déclencher.
 *
 * L'URL d'objet est créée à l'appel : elle vit dans ce que le retour porte, et c'est
 * `release` — pas un minuteur — qui la révoque. Tant que l'utilisateur n'a ni sauvé
 * ni fermé, le blob reste lisible et rien ne part.
 */
export function holdDownload(blob: Blob, filename: string): PendingDownload {
  const url = URL.createObjectURL(blob)
  let released = false
  return {
    save() {
      if (released) return
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.rel = 'noopener'
      // Invisible et hors flux : l'ancre ne doit pas déplacer d'un pixel la page qu'elle traverse.
      a.style.display = 'none'
      document.body.appendChild(a)
      try {
        a.click()
      } finally {
        // L'ANCRE PART TOUT DE SUITE, l'URL non : le clic est traité, le blob se lit encore
        // (cf. `URL_RELEASE_MS`), et on n'a plus besoin de la retenir ensuite.
        a.remove()
        setTimeout(() => {
          if (released) return
          released = true
          URL.revokeObjectURL(url)
        }, URL_RELEASE_MS)
      }
    },
    release() {
      if (released) return
      released = true
      URL.revokeObjectURL(url)
    },
  }
}

/**
 * triggerDownload remet un blob au navigateur sous le nom donné, d'un seul geste.
 *
 * À réserver aux chemins où le clic de l'utilisateur EST le téléchargement — la capture
 * d'image, où le geste et le dépôt sont la même action. Pour un fichier qui existe des
 * minutes après le clic (l'export), le clic final doit venir de l'utilisateur : c'est
 * `holdDownload`, qui prépare l'URL et attend le bouton « Sauvegarder ».
 *
 * L'ancre est ATTACHÉE au document le temps du clic : un clic sur un nœud détaché est
 * ignoré par certains navigateurs, et le téléchargement n'y part alors jamais.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  holdDownload(blob, filename).save()
}

/**
 * captureCanvasImage rend les pixels de la toile en PNG, à sa résolution NATIVE.
 *
 * « Native » veut dire le backing store : le canvas du rejeu est dimensionné en px physiques
 * (largeur × devicePixelRatio) et le contexte porte la mise à l'échelle — `toBlob` sort donc
 * l'image en pleine densité sans qu'on ait rien à recalculer ici.
 *
 * `null` N'EST PAS UNE PANNE À REMONTER : une toile vierge, un contexte perdu ou un navigateur
 * qui refuse rendent `null`, et l'appelant ne télécharge alors rien. Un fichier vide serait
 * pire que pas de fichier.
 */
export function captureCanvasImage(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null)
      return
    }
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}
