/**
 * replayVideoEncoder.ts — L'ENCODAGE VIDÉO DE L'EXPORT, et rien d'autre.
 *
 * # POURQUOI PAS `MediaRecorder`, QUI EXISTE DÉJÀ DANS CE DOSSIER
 *
 * `replayRecording.ts` filme la toile PENDANT qu'elle joue : c'est un enregistreur d'écran, et
 * il horodate sur l'horloge murale. On ne peut donc pas le nourrir plus vite que le temps réel
 * — pousser trente images en une seconde produirait une seconde de vidéo, pas une seconde de
 * match. C'est exactement ce que l'export refuse : il RECALCULE le film image par image, aussi
 * vite que la machine suit, et la durée du clip doit rester celle du MATCH.
 *
 * WebCodecs est le seul chemin où l'horodatage est un PARAMÈTRE et non une conséquence. Chaque
 * `VideoFrame` porte son instant (en microsecondes de match) ; le muxeur les remet dans l'ordre
 * du fichier. Le temps de calcul n'entre nulle part dans le résultat.
 *
 * # POURQUOI `mediabunny` ET PLUS `mp4-muxer` (2026-08-28)
 *
 * Les deux viennent du meme auteur, et le second est le successeur du premier. Le changement
 * n'est pas une preference : `mp4-muxer` declare `audio?:` AU SINGULIER — une piste video, une
 * piste audio, pas plus. L'utilisateur veut ses bruitages, ses voix et sa musique SEPARES pour
 * les remonter ; `mediabunny` accepte un nombre illimite de pistes audio en MP4 (verifie :
 * `Mp4OutputFormat.getSupportedTrackCounts()` rend `audio.max = 2^32-1`).
 *
 * CE QUI N'A PAS CHANGE, ET C'EST DELIBERE : l'encodage VIDEO reste le notre — `VideoEncoder`,
 * notre config, notre contre-pression, nos horodatages. `mediabunny` sait encoder lui-meme,
 * mais tout cela est deja mesure et teste, et une reecriture aurait remis en jeu la seule
 * partie du chantier verifiee de bout en bout dans un navigateur. Seule la couche de MUXAGE
 * change, par `EncodedVideoPacketSource` qui prend nos paquets tels quels.
 *
 * L'AUDIO, LUI, PASSE PAR `AudioBufferSource` : on donne un tampon rendu, la bibliotheque
 * encode. C'est ce qui supprime notre `encodeAudioInto` et, avec lui, toute la famille de
 * pieges qu'il portait (configuration AAC refusee de facon asynchrone, `flush()` sur un
 * encodeur ferme, piste declaree mais vide).
 *
 * # CE QUE CE MODULE NE FAIT PAS
 *
 * Il ne dessine rien, ne connaît ni le document du rejeu ni React, et n'écrit aucun fichier :
 * il rend un `Blob`. La boucle qui pose les images vit dans `useReplayExport.ts`, la piste
 * sonore dans `replayAudioMix.ts`, le téléchargement dans `replayCapture.ts`. Ici, seulement :
 * quel codec, à quel débit, et comment on ne noie pas l'encodeur.
 *
 * # LES TROIS DÉCISIONS QUI NE SONT PAS ARBITRAIRES
 *
 * 1. LES DIMENSIONS SONT PAIRES. H.264 échantillonne la chrominance à 4:2:0, c'est-à-dire un
 *    demi-pixel sur chaque axe : une largeur impaire n'a pas de représentation, et l'encodeur
 *    la refuse. Depuis le 2026-09-16 l'export ne demande que des formats pairs (`exportFormats.ts`) ;
 *    l'arrondi reste le garde-fou de tout appelant qui passerait une taille de toile brute. On
 *    arrondit VERS LE BAS — rogner une colonne de pixels est invisible, l'étirer ne l'est pas.
 * 2. LE NIVEAU H.264 SE CALCULE, il ne se choisit pas au jugé. Un niveau déclaré trop bas
 *    produit un fichier que les lecteurs stricts refusent ; trop haut, il ferme la porte aux
 *    lecteurs anciens sans rien apporter. `avcLevelFor` prend le plus BAS qui accepte la
 *    surface ET la cadence demandées.
 * 3. LA CONTRE-PRESSION N'EST PAS UNE OPTIMISATION. `encoder.encode()` ne bloque jamais : sur
 *    un match de dix minutes, une boucle qui ne regarde pas `encodeQueueSize` empile dix-huit
 *    mille images dans la file avant que l'encodeur en ait sorti la moitié, et l'onglet meurt.
 *    On attend que la file redescende (cf. `shouldDrain`).
 */
import {
  AudioBufferSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
} from 'mediabunny'
import type { StreamTargetChunk } from 'mediabunny'

import { ExportFileTarget } from './replayExportFileTarget'
import { yieldToEvents } from './eventLoopYield'

/**
 * Les sous-objets propres à un codec que WebCodecs accepte sur `VideoEncoderConfig` et
 * `VideoEncoderEncodeOptions`. `lib.dom` ne type que `avc` ; `hevc` et `av1` sont de vrais
 * champs WebCodecs (chacun porte un `quantizer` dans les options d'encodage) que la lib ne
 * suit pas encore. On étend les types DOM ici pour construire des configs bien typées pour ces
 * codecs, sans les forcer dans l'API publique du module.
 */
interface ExportCodecFields {
  hevc?: { quantizer?: number | null }
  av1?: { quantizer?: number | null }
}

/** `VideoEncoderConfig` + les champs `hevc`/`av1` que lib.dom ne type pas. */
type ExportVideoEncoderConfig = VideoEncoderConfig & ExportCodecFields
/** `VideoEncoderEncodeOptions` + les champs `hevc`/`av1` que lib.dom ne type pas. */
type ExportVideoEncoderEncodeOptions = VideoEncoderEncodeOptions & ExportCodecFields

/**
 * CADENCE DE L'EXPORT, en images par seconde.
 *
 * VOLONTAIREMENT DISTINCTE de `CAPTURE_FPS` (`replayRecording.ts`), qui vaut le même nombre
 * pour une raison qui n'est pas la même : là-bas c'est un DÉBIT DEMANDÉ à un flux de toile,
 * que le navigateur sert au mieux ; ici c'est la définition même de l'axe du temps du fichier —
 * une image tous les 1/30 de seconde de MATCH, ni plus ni moins. Les fusionner ferait croire
 * qu'un réglage de l'un vaut pour l'autre.
 *
 * This is the 2D MAP export's rate: points sliding on a map gain nothing visible past 30, and
 * doubling the rate would double the file weight and the compute time. The 3D export has its
 * own rate (`EXPORT_FPS_3D`).
 */
export const EXPORT_FPS = 30

/**
 * THE 3D EXPORT'S RATE: 60 frames per second of MATCH, guaranteed by construction. The export is
 * offline: each frame is posed at an exact 1/60 s step of match time, rendered to completion,
 * and stamped `index / 60` s, so the rate never depends on how fast the machine renders.
 *
 * 60 and not 30 because the 3D view is a first/third-person camera on players whose motion is
 * recorded at ~60 Hz (`tr.fullRate`, `fineTracks3d`); at 30 a camera pan judders, and the clips
 * are cut into videos played at 60. The film's own frame grid (~30 Hz) is not a ceiling: the
 * scene poses fractional frames and interpolates, as on screen at the monitor's refresh rate.
 *
 * If the browser cannot encode 60 at the chosen size, the export falls back to `EXPORT_FPS` and
 * SAYS so (`VideoExportSink.fpsFallback`): never a silent 30.
 */
export const EXPORT_FPS_3D = 60

/**
 * Une image-clé toutes les 2 secondes de match. C'est ce qui rend le clip NAVIGABLE : sans
 * image-clé régulière, déplacer le curseur dans le fichier oblige le lecteur à tout rejouer
 * depuis le début. Plus serré gonflerait le fichier sans servir personne.
 */
export const KEYFRAME_SECONDS = 2

/** The keyframe interval at the 2D rate, in frames (kept for the 2D callers and tests). */
export const KEYFRAME_EVERY = EXPORT_FPS * KEYFRAME_SECONDS

/**
 * Profondeur de file au-delà de laquelle la boucle attend. Deux images de marge : assez pour
 * que l'encodeur ne chôme jamais entre deux tracés, assez peu pour que la mémoire retenue reste
 * celle de quelques images et non celle d'un match.
 */
export const ENCODE_QUEUE_MAX = 2

/**
 * THE QUANTIZER FOR CONSTANT-QUALITY ENCODING (`bitrateMode: 'quantizer'`), in H.264 QP
 * (0-51, lower is better). The browser's own rate control starves frames under a hard target:
 * a 1080p60 export asked for 31 Mb/s averaged 10.1 Mb/s, and its keyframes ranged from 12.7 KB
 * to 230 KB — a 12.7 KB 1080p keyframe is a screen of 16x16 blocks, and the user sees them
 * whenever another player moves or shoots. A fixed QP trades the opposite way: every frame
 * gets the quality asked for, and the rate floats. QP 20 is the classic "visually clean" point
 * for hardware H.264: at 1080p60 it lands near the 31 Mb/s the old target aimed at, and a
 * still frame stays small instead of burning its quota. Keyframes and other frames take the
 * SAME QP: a keyframe at QP 14 next to 20 P-frames made the step between them visible.
 */
export const EXPORT_QP = 20

/**
 * Bits per pixel per frame. At 0.1 a moving 3D camera smeared every textured wall into blocks
 * (1080p60 got 12.4 Mb/s): a still frame costs nothing, but a pan changes every pixel of stone
 * and foliage, and the browser's hardware H.264 needs more bits than x264 for the same picture.
 * 0.25 gives 1080p60 31 Mb/s, inside High 4.2's 62.5 Mb/s ceiling.
 */
const BITS_PER_PIXEL = 0.25
/** Débit plancher et plafond, en bits par seconde : sous 2 Mb/s le texte du HUD bave. */
const BITRATE_MIN = 2_000_000
const BITRATE_MAX = 80_000_000

/**
 * Les niveaux H.264, du plus bas au plus haut, avec ce que chacun accepte : `maxFS` en
 * macroblocs par image, `maxMBps` en macroblocs par seconde (tableau A-1 de la norme, les
 * seuls niveaux qu'un export de rejeu peut atteindre). `hex` est l'octet du nom de codec.
 */
const AVC_LEVELS: readonly { hex: string; maxFS: number; maxMBps: number }[] = [
  { hex: '1e', maxFS: 1620, maxMBps: 40_500 }, // 3.0
  { hex: '1f', maxFS: 3600, maxMBps: 108_000 }, // 3.1
  { hex: '20', maxFS: 5120, maxMBps: 216_000 }, // 3.2
  { hex: '28', maxFS: 8192, maxMBps: 245_760 }, // 4.0
  { hex: '2a', maxFS: 8704, maxMBps: 522_240 }, // 4.2
  { hex: '32', maxFS: 22_080, maxMBps: 589_824 }, // 5.0
  { hex: '33', maxFS: 36_864, maxMBps: 983_040 }, // 5.1
  { hex: '34', maxFS: 36_864, maxMBps: 2_073_600 }, // 5.2
  { hex: '3c', maxFS: 139_264, maxMBps: 4_177_920 }, // 6.0
]

/** Profil HIGH (`6400`) : le profil que tout lecteur matériel de cette décennie décode. */
const AVC_PROFILE = 'avc1.6400'

/**
 * evenSize arrondit VERS LE BAS à un nombre pair, plancher à 2 (cf. décision 1 de l'en-tête).
 * Une dimension nulle ou négative n'a pas de sens pour un encodeur : elle remonte à 2, et
 * l'appelant qui lui a servi ça a un autre problème que l'arrondi.
 */
export function evenSize(n: number): number {
  const floored = Math.floor(n)
  if (!Number.isFinite(floored) || floored < 2) return 2
  return floored - (floored % 2)
}

/** Surface en macroblocs 16x16 : l'unité dans laquelle la norme H.264 compte tout. */
function frameMacroblocks(width: number, height: number): number {
  return Math.ceil(width / 16) * Math.ceil(height / 16)
}

/**
 * avcLevelFor rend le nom de codec complet pour cette image et cette cadence : le PLUS BAS
 * niveau qui accepte la surface et le débit de macroblocs (cf. décision 2 de l'en-tête).
 *
 * Au-delà du plus haut niveau du tableau (une toile démesurée), on rend quand même le dernier :
 * un fichier au niveau sous-déclaré reste lisible partout où le décodeur ne vérifie pas, là où
 * refuser l'export ne rendrait service à personne. Le cas ne se produit pas sous 8K.
 */
export function avcLevelFor(width: number, height: number, fps: number): string {
  const fs = frameMacroblocks(width, height)
  const mbps = fs * fps
  const level = AVC_LEVELS.find((l) => fs <= l.maxFS && mbps <= l.maxMBps)
  return `${AVC_PROFILE}${level?.hex ?? AVC_LEVELS[AVC_LEVELS.length - 1].hex}`
}

/**
 * Les niveaux HEVC, du plus bas au plus haut, avec ce que chacun accepte : `maxLuma` en
 * échantillons de luminance par image et `maxLumaRate` en échantillons par seconde (tableau
 * A-1 de la norme, Main Tier). `code` est le suffixe `L<level>` du nom de codec.
 */
const HEVC_LEVELS: readonly { code: string; maxLuma: number; maxLumaRate: number }[] = [
  { code: 'L90', maxLuma: 36_864, maxLumaRate: 99_532 }, // 1
  { code: 'L93', maxLuma: 81_920, maxLumaRate: 222_784 }, // 2
  { code: 'L100', maxLuma: 122_880, maxLumaRate: 334_176 }, // 3
  { code: 'L103', maxLuma: 245_760, maxLumaRate: 668_352 }, // 4
  { code: 'L110', maxLuma: 245_760, maxLumaRate: 1_336_704 }, // 5
  { code: 'L120', maxLuma: 552_960, maxLumaRate: 2_963_072 }, // 6
  { code: 'L123', maxLuma: 1_105_920, maxLumaRate: 5_926_144 }, // 7
  { code: 'L150', maxLuma: 8_912_896, maxLumaRate: 47_513_152 }, // 8
  { code: 'L153', maxLuma: 17_825_792, maxLumaRate: 95_026_304 }, // 8.1
]

/** Profil MAIN (`1`), type de profil généraliste (`6`) : ce que tout lecteur décode. */
const HEVC_PROFILE = 'hvc1.1.6'

/**
 * hevcLevelFor rend le nom de codec HEVC pour cette image et cette cadence : le PLUS BAS
 * niveau qui accepte la surface et le débit d'échantillons, en `hvc1.1.6.L<level>.B0` (le `B0`
 * est le High Tier absent — Main Tier). Comme `avcLevelFor`, au-delà du plus haut niveau on
 * rend le dernier plutôt que de refuser l'export.
 */
export function hevcLevelFor(width: number, height: number, fps: number): string {
  const luma = Math.ceil(width / 2) * Math.ceil(height / 2)
  const rate = luma * fps
  const level = HEVC_LEVELS.find((l) => luma <= l.maxLuma && rate <= l.maxLumaRate)
  return `${HEVC_PROFILE}.${level?.code ?? HEVC_LEVELS[HEVC_LEVELS.length - 1].code}.B0`
}

/**
 * Les niveaux AV1, du plus bas au plus haut, avec `maxLuma` (échantillons de luminance par
 * image) et `maxLumaRate` (par seconde). `code` est le niveau, `tier` le tier (`0` Main, `1`
 * High). AV1 compte la surface en échantillons de luminance (pas en macroblocs), d'où les
 * plafonds deux fois plus grands que HEVC à niveau comparable.
 */
const AV1_LEVELS: readonly { code: string; tier: '0' | '1'; maxLuma: number; maxLumaRate: number }[] = [
  { code: '2.0', tier: '0', maxLuma: 204_800, maxLumaRate: 614_400 }, // 2.0
  { code: '2.1', tier: '0', maxLuma: 204_800, maxLumaRate: 1_228_800 }, // 2.1
  { code: '3.0', tier: '0', maxLuma: 409_600, maxLumaRate: 1_228_800 }, // 3.0
  { code: '3.1', tier: '0', maxLuma: 409_600, maxLumaRate: 2_457_600 }, // 3.1
  { code: '4.0', tier: '0', maxLuma: 819_200, maxLumaRate: 2_457_600 }, // 4.0
  { code: '4.1', tier: '0', maxLuma: 819_200, maxLumaRate: 4_915_200 }, // 4.1
  { code: '5.0', tier: '0', maxLuma: 1_638_400, maxLumaRate: 4_915_200 }, // 5.0
  { code: '5.1', tier: '1', maxLuma: 1_638_400, maxLumaRate: 9_830_400 }, // 5.1
  { code: '5.2', tier: '1', maxLuma: 1_638_400, maxLumaRate: 19_660_800 }, // 5.2
  { code: '6.0', tier: '0', maxLuma: 3_276_800, maxLumaRate: 9_830_400 }, // 6.0
  { code: '6.1', tier: '1', maxLuma: 3_276_800, maxLumaRate: 19_660_800 }, // 6.1
  { code: '6.2', tier: '1', maxLuma: 3_276_800, maxLumaRate: 39_321_600 }, // 6.2
]

/** Profil MAIN (`0`), 8 bits (`.08`) : le nom de codec AV1 de base, suivi du niveau et du tier. */
const AV1_PREFIX = 'av01.0.'

/**
 * av1LevelFor rend le nom de codec AV1 pour cette image et cette cadence : le PLUS BAS niveau
 * qui accepte la surface et le débit d'échantillons, en `av01.0.<level><tier>.08` (Main
 * Profile `0`, 8 bits `.08`). Comme `avcLevelFor`, au-delà du plus haut niveau on rend le
 * dernier plutôt que de refuser l'export.
 */
export function av1LevelFor(width: number, height: number, fps: number): string {
  const luma = Math.ceil(width / 2) * Math.ceil(height / 2)
  const rate = luma * fps
  const level = AV1_LEVELS.find((l) => luma <= l.maxLuma && rate <= l.maxLumaRate)
  const last = AV1_LEVELS[AV1_LEVELS.length - 1]
  return `${AV1_PREFIX}${level?.code ?? last.code}${level?.tier ?? last.tier}.08`
}

/** videoBitrate : le débit visé, borné (cf. `BITRATE_MIN` / `BITRATE_MAX`), à `bitsPerPixel`. */
export function videoBitrate(width: number, height: number, fps: number, bitsPerPixel: number = BITS_PER_PIXEL): number {
  const raw = Math.round(width * height * fps * bitsPerPixel)
  return Math.min(BITRATE_MAX, Math.max(BITRATE_MIN, raw))
}

/**
 * THE RATE MODE OF THE FILE: constant quality (`'quantizer'`) first, then constant bitrate
 * (`'constant'`), then the browser's own rate control (`'variable'`). Decided by the probe in
 * `chooseExportRateMode`; `openVideoExport` records it where it records the fps fallback and
 * says it once at export start.
 */
export type ExportRateMode = 'quantizer' | 'constant' | 'variable'

/** Les familles de codec que l'export sait encoder. */
export type ExportVideoCodec = 'avc' | 'hevc' | 'av1'

/** Les noms de préréglages vidéo. */
export type ExportVideoPresetName =
  | 'h264-qp20'
  | 'h264-qp23'
  | 'h264-qp26'
  | 'h264-qp29'
  | 'hevc-qp26'
  | 'av1-q35'

/**
 * Un préréglage vidéo nommé. C'est la SEULE chose que l'on change pour varier la qualité : on
 * pointe `EXPORT_VIDEO_PRESET` sur un autre nom de ce tableau.
 *
 * - `codec` : la famille de codec (`'avc'` = H.264, `'hevc'`, `'av1'`).
 * - `mode` : le mode de débit à essayer en premier. Tous nos préréglages sont `'quantizer'`.
 * - `quantizer` : le quantizer à l'échelle PROPRE du codec (H.264 et HEVC : 0-51 ; AV1 : 0-63).
 *   Présent quand `mode` est `'quantizer'`.
 * - `bitsPerPixel` : les bits par pixel pour le mode de débit, utilisé quand le mode
 *   `'quantizer'` n'est pas supporté. H.264 conserve le 0.25 d'aujourd'hui.
 * - `fallback` : le nom du préréglage à essayer quand le navigateur ne sait pas encoder celui-ci.
 *   Absent à la fin de la chaîne : le préréglage H.264 par défaut, dont le repli de mode
 *   (constant puis variable) est toujours accepté.
 */
export interface ExportVideoPreset {
  name: ExportVideoPresetName
  codec: ExportVideoCodec
  mode: ExportRateMode
  quantizer?: number
  bitsPerPixel?: number
  fallback?: ExportVideoPresetName
}

/**
 * LA TABLE DES PRÉRÉGLAGES. Le repli de chaque préréglage pointe vers un préréglage plus sûr,
 * et TOUTE chaîne se termine sur un préréglage H.264 : le navigateur encode toujours H.264, et
 * ses replis de mode constant/variable (le 0.25 d'aujourd'hui) sont toujours acceptés. `hevc`
 * et `av1` tombent sur `h264-qp23` — valeurs de départ pour la mesure à venir, pas un choix
 * final.
 */
export const EXPORT_VIDEO_PRESETS: Record<ExportVideoPresetName, ExportVideoPreset> = {
  'h264-qp20': { name: 'h264-qp20', codec: 'avc', mode: 'quantizer', quantizer: EXPORT_QP, bitsPerPixel: BITS_PER_PIXEL },
  'h264-qp23': { name: 'h264-qp23', codec: 'avc', mode: 'quantizer', quantizer: 23, bitsPerPixel: BITS_PER_PIXEL, fallback: 'h264-qp20' },
  'h264-qp26': { name: 'h264-qp26', codec: 'avc', mode: 'quantizer', quantizer: 26, bitsPerPixel: BITS_PER_PIXEL, fallback: 'h264-qp20' },
  'h264-qp29': { name: 'h264-qp29', codec: 'avc', mode: 'quantizer', quantizer: 29, bitsPerPixel: BITS_PER_PIXEL, fallback: 'h264-qp20' },
  'hevc-qp26': { name: 'hevc-qp26', codec: 'hevc', mode: 'quantizer', quantizer: 26, bitsPerPixel: BITS_PER_PIXEL, fallback: 'h264-qp23' },
  'av1-q35': { name: 'av1-q35', codec: 'av1', mode: 'quantizer', quantizer: 35, bitsPerPixel: BITS_PER_PIXEL, fallback: 'h264-qp23' },
}

/**
 * LE PRÉRÉGLAGE ACTUEL : le seul nom à changer pour basculer de qualité. `'h264-qp20'` est
 * exactement le comportement d'aujourd'hui (H.264, QP 20).
 */
export const EXPORT_VIDEO_PRESET: ExportVideoPresetName = 'h264-qp20'

/**
 * codecStringFor rend le nom de codec complet du préréglage pour cette image et cette cadence :
 * le H.264 de `avcLevelFor`, ou le HEVC/AV1 de `hevcLevelFor`/`av1LevelFor` selon le codec.
 */
export function codecStringFor(preset: ExportVideoPreset, width: number, height: number, fps: number): string {
  const w = evenSize(width)
  const h = evenSize(height)
  switch (preset.codec) {
    case 'avc': return avcLevelFor(w, h, fps)
    case 'hevc': return hevcLevelFor(w, h, fps)
    case 'av1': return av1LevelFor(w, h, fps)
  }
}

/**
 * videoEncoderConfig assemble la configuration complète. PURE : c'est elle qu'on teste, et
 * c'est elle qu'on passe à `VideoEncoder.isConfigSupported` avant d'ouvrir quoi que ce soit.
 *
 * Les dimensions reçues sont celles de la TOILE ; celles qui sortent sont paires.
 *
 * Le MODE est choisi par l'appelant (`chooseExportRateMode`), qui l'a PROUVE par la même
 * fonction : `'quantizer'` encode à qualité constante (le quantizer du préréglage, pas de
 * `bitrate`), `'constant'` et `'variable'` visent le débit borné de `videoBitrate`.
 *
 * LE PRÉRÉGLAGE (`preset`) choisit le codec et le quantizer. Par défaut, c'est le préréglage
 * d'aujourd'hui : H.264, QP 20 — la config rendue est alors byte à byte celle d'avant.
 */
export function videoEncoderConfig(
  width: number,
  height: number,
  fps: number = EXPORT_FPS,
  mode: ExportRateMode = 'variable',
  preset: ExportVideoPreset = EXPORT_VIDEO_PRESETS[EXPORT_VIDEO_PRESET],
): ExportVideoEncoderConfig {
  const w = evenSize(width)
  const h = evenSize(height)
  const config: ExportVideoEncoderConfig = {
    codec: codecStringFor(preset, w, h, fps),
    width: w,
    height: h,
    framerate: fps,
  }
  if (preset.codec === 'avc') {
    // `avc` et non `annexb` : c'est la forme que le conteneur MP4 attend. HEVC/AV1 n'ont pas
    // de sous-objet de config : leur nom de codec fait déjà le travail.
    config.avc = { format: 'avc' }
  }
  if (mode === 'quantizer') {
    // Pas de `bitrate` : en mode quantizer, la qualité EST le réglage.
    config.bitrateMode = 'quantizer'
  } else {
    config.bitrate = videoBitrate(w, h, fps, preset.bitsPerPixel)
    config.bitrateMode = mode
  }
  return config
}

/**
 * chooseExportRateMode picks the rate mode, PURE over its probe (`VideoEncoder.isConfigSupported`
 * in the browser, a stub in tests): `'quantizer'` if the probe accepts a config in that mode at
 * this size and rate, else `'constant'` if it accepts that one, else `'variable'` — the mode the
 * browser always accepts. The probe answer decides; nothing is assumed.
 */
export async function chooseExportRateMode(
  width: number,
  height: number,
  fps: number,
  probe: (config: VideoEncoderConfig) => Promise<boolean>,
): Promise<ExportRateMode> {
  if (await probe(videoEncoderConfig(width, height, fps, 'quantizer'))) return 'quantizer'
  if (await probe(videoEncoderConfig(width, height, fps, 'constant'))) return 'constant'
  return 'variable'
}

/**
 * resolveExportPreset parcourt la chaîne de repli des préréglages et rend le PREMIER que ce
 * navigateur sait encoder, dans le mode de débit que la sonde a prouvé.
 *
 * - Un préréglage NON H.264 (HEVC/AV1) n'est essayé que dans son mode primaire (`quantizer`) ;
 *   refusé, la chaîne avance vers son `fallback`.
 * - Un préréglage H.264 est la fin de la chaîne : on essaie son quantizer, puis le repli de
 *   mode constant puis variable d'aujourd'hui, toujours accepté par le navigateur. La marche
 *   aboutit donc TOUJOURS à un préréglage H.264 dans un mode supporté.
 *
 * `null` seulement si la table est mal formée (nom inconnu ou boucle) : avec la table bien
 * formée, la marche se termine toujours sur H.264.
 */
export async function resolveExportPreset(
  presetName: ExportVideoPresetName,
  width: number,
  height: number,
  fps: number,
  probe: (config: VideoEncoderConfig) => Promise<boolean>,
): Promise<{ preset: ExportVideoPreset; mode: ExportRateMode } | null> {
  const seen = new Set<ExportVideoPresetName>()
  let name: ExportVideoPresetName = presetName
  for (;;) {
    const preset = EXPORT_VIDEO_PRESETS[name]
    if (!preset || seen.has(name)) return null
    seen.add(name)
    if (preset.codec === 'avc') {
      return { preset, mode: await rateModeForPreset(preset, width, height, fps, probe) }
    }
    if (await probe(videoEncoderConfig(width, height, fps, preset.mode, preset))) {
      return { preset, mode: preset.mode }
    }
    if (!preset.fallback) return null
    name = preset.fallback
  }
}

/** Le mode de débit H.264 que la sonde accepte pour ce préréglage : quantizer, puis constant, puis variable. */
async function rateModeForPreset(
  preset: ExportVideoPreset,
  width: number,
  height: number,
  fps: number,
  probe: (config: VideoEncoderConfig) => Promise<boolean>,
): Promise<ExportRateMode> {
  if (preset.mode === 'quantizer' && (await probe(videoEncoderConfig(width, height, fps, 'quantizer', preset)))) return 'quantizer'
  if (await probe(videoEncoderConfig(width, height, fps, 'constant', preset))) return 'constant'
  return 'variable'
}

/**
 * The encode options of one frame: the codec's `quantizer` in quantizer mode, and only there.
 * The quantizer travels under the codec's own key (`avc`/`hevc`/`av1`), on that codec's scale.
 */
export function encodeOptionsFor(
  mode: ExportRateMode,
  keyFrame: boolean,
  preset: ExportVideoPreset = EXPORT_VIDEO_PRESETS[EXPORT_VIDEO_PRESET],
): ExportVideoEncoderEncodeOptions {
  if (mode !== 'quantizer') return { keyFrame }
  const options: ExportVideoEncoderEncodeOptions = { keyFrame }
  switch (preset.codec) {
    case 'avc': options.avc = { quantizer: preset.quantizer }; break
    case 'hevc': options.hevc = { quantizer: preset.quantizer }; break
    case 'av1': options.av1 = { quantizer: preset.quantizer }; break
  }
  return options
}

/**
 * shouldDrain dit si la boucle doit attendre avant de pousser l'image suivante (décision 3).
 * Séparée de la boucle pour être testable sans encodeur.
 */
export function shouldDrain(queueSize: number): boolean {
  return queueSize > ENCODE_QUEUE_MAX
}

/**
 * isKeyFrame : l'image `index` (0 = la première) ouvre-t-elle un nouveau point d'entrée ? Every
 * `KEYFRAME_SECONDS` of clip at the rate `fps`: a keyframe every 60 frames at 30, every 120 at 60.
 */
export function isKeyFrame(index: number, fps: number = EXPORT_FPS): boolean {
  return index % Math.max(1, Math.round(fps * KEYFRAME_SECONDS)) === 0
}

/**
 * frameTimestampUs: the file instant of frame `index` at the rate `fps`, in microseconds.
 * COMPUTED FROM THE INDEX, never accumulated from a rounded duration: `round(1e6 / 60)` is
 * 16667 us, and summing it drifted the video 1.2 ms per minute ahead of the sound.
 */
export function frameTimestampUs(index: number, fps: number): number {
  return Math.round((index * 1_000_000) / fps)
}

/** frameDurationUs: how long frame `index` lasts, so that consecutive frames tile exactly. */
export function frameDurationUs(index: number, fps: number): number {
  return frameTimestampUs(index + 1, fps) - frameTimestampUs(index, fps)
}

/**
 * chooseExportFps picks the encoding rate IN THE MODE ALREADY CHOSEN (`mode`): `wanted` if this
 * browser accepts the configuration at that rate in that mode, else `fallback` if it accepts
 * that one, else null. PURE over its probe, which is `VideoEncoder.isConfigSupported` in the
 * browser and a stub in tests. The mode is fixed first (`chooseExportRateMode`) so the fps
 * fallback probes the config that will actually be opened, not a variable-rate one.
 */
export async function chooseExportFps(
  width: number,
  height: number,
  wanted: number,
  fallback: number | undefined,
  probe: (config: VideoEncoderConfig) => Promise<boolean>,
  mode: ExportRateMode = 'variable',
  preset: ExportVideoPreset = EXPORT_VIDEO_PRESETS[EXPORT_VIDEO_PRESET],
): Promise<number | null> {
  if (await probe(videoEncoderConfig(width, height, wanted, mode, preset))) return wanted
  if (fallback === undefined || fallback === wanted) return null
  return (await probe(videoEncoderConfig(width, height, fallback, mode, preset))) ? fallback : null
}

/** The browser probe: a throw (invalid configuration) is an answer, not a failure. */
async function browserSupports(config: VideoEncoderConfig): Promise<boolean> {
  try {
    return (await VideoEncoder.isConfigSupported(config)).supported === true
  } catch {
    return false
  }
}

/**
 * canExportVideo dit si CE navigateur sait encoder hors temps réel.
 *
 * Les trois conditions sont indissociables : l'encodeur, le type d'image qu'on lui pousse, et
 * la lecture asynchrone de ses capacités. Il en manque une, il n'y a pas d'export possible — et
 * c'est le bouton d'enregistrement TEMPS RÉEL qui reprend la main (repli, décision D5 du plan).
 *
 * Rend `false` sous jsdom, où rien de tout cela n'existe : c'est ce qui permet aux tests de ce
 * module de rester des tests purs.
 */
export function canExportVideo(): boolean {
  if (typeof VideoEncoder === 'undefined') return false
  if (typeof VideoFrame === 'undefined') return false
  return typeof VideoEncoder.isConfigSupported === 'function'
}

/**
 * canExportAudio dit si ce navigateur sait encoder une piste sonore.
 *
 * SE TESTE AVANT D'OUVRIR LE CONTENEUR, jamais après : le MP4 annonce ses pistes une fois pour
 * toutes. Déclarer une piste AAC puis découvrir qu'`AudioEncoder` manque produisait un fichier
 * portant une piste VIDE — selon le lecteur : muette, avertissement, ou refus d'ouvrir.
 */
export function canExportAudio(): boolean {
  return typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined'
}

/**
 * Débit de la piste sonore, en bits par seconde. 128 kb/s en AAC stéréo : au-dessus du seuil
 * où l'oreille distingue encore l'encodage sur des sons courts et secs (tirs, explosions),
 * et sans commune mesure avec le débit vidéo — la piste ne pèse rien dans le fichier.
 */
const AUDIO_BITRATE = 128_000

/** La configuration AAC visee : AAC-LC, le profil que tout lecteur decode. */
export function audioEncoderConfig(shape: AudioTrackShape): AudioEncoderConfig {
  return {
    codec: 'mp4a.40.2',
    sampleRate: shape.sampleRate,
    numberOfChannels: shape.numberOfChannels,
    bitrate: AUDIO_BITRATE,
  }
}

/**
 * audioTrackUsable dit si ce navigateur sait REELLEMENT encoder cette piste.
 *
 * `canExportAudio` ne repond qu'a « l'API existe-t-elle ». Elle peut exister et REFUSER la
 * configuration — et ce refus est ASYNCHRONE : `configure()` ne leve pas, il passe l'encodeur
 * en erreur et le ferme, si bien que la panne n'apparait qu'au `flush()`, sous la forme
 * trompeuse « Encoder must be configured first ». C'est exactement ce qui s'est produit en
 * recette le 2026-08-28.
 *
 * La question se pose donc AVANT d'ouvrir le conteneur, qui declare ses pistes une fois pour
 * toutes : mieux vaut un clip muet annonce qu'un export perdu.
 */
export async function audioTrackUsable(shape: AudioTrackShape): Promise<boolean> {
  if (!canExportAudio()) return false
  if (typeof AudioEncoder.isConfigSupported !== 'function') return false
  try {
    const probe = await AudioEncoder.isConfigSupported(audioEncoderConfig(shape))
    return probe.supported === true
  } catch {
    // Une configuration REFUSEE leve ici (config invalide) : c'est une reponse, pas une panne.
    return false
  }
}

/** Ce que la boucle d'export reçoit : trois gestes, et aucun état à tenir de son côté. */
export interface VideoExportSink {
  /** Pousse la toile TELLE QU'ELLE EST à cet instant. Attend si la file est pleine. */
  addFrame: (canvas: HTMLCanvasElement, index: number) => Promise<void>
  /** Vide la file, referme le conteneur, rend le fichier. */
  finish: () => Promise<Blob>
  /**
   * `false` = les pistes sonores demandees n'ont PAS pu etre declarees (encodeur AAC absent ou
   * configuration refusee). Le clip sortira muet, et l'appelant doit le DIRE.
   */
  audioEnabled: boolean
  /**
   * Remet les tampons rendus, DANS L'ORDRE des noms declares a l'ouverture. A n'appeler QUE si
   * `audioEnabled`, et une seule fois.
   */
  addAudioTracks: (tracks: readonly AudioTrackInput[], progress?: (fraction: number) => void) => Promise<void>
  /** Referme tout sans rien rendre (annulation, erreur). Ne lève jamais. */
  abort: () => void
  /** The rate the file is actually encoded at: the frame plan must be built at this rate. */
  fps: number
  /**
   * `true` = the requested rate was refused by this browser and the clip is encoded at
   * `VideoExportOptions.fallbackFps` instead. The caller must SAY it.
   */
  fpsFallback: boolean
  /**
   * The rate mode the file is encoded in, decided by the probe (`resolveExportPreset`).
   * `'quantizer'` = constant quality at the selected preset's quantizer; the others target
   * `videoBitrate`. Recorded next to the fps fallback; `openVideoExport` already said it at
   * export start.
   */
  rateMode: ExportRateMode
}

export interface VideoExportOptions {
  width: number
  height: number
  fps?: number
  /**
   * The rate to fall back to when `fps` is refused by this browser (`chooseExportFps`). Absent:
   * a refused `fps` is a refused export (`null`), as before.
   */
  fallbackFps?: number
  /**
   * COMBIEN de pistes sonores le clip portera. Declare a l'ouverture ou jamais : le conteneur
   * ecrit sa table des pistes une fois pour toutes. `0` = clip muet, ce qui reste un resultat.
   *
   * Les noms sont donnes ici parce qu'ils font partie de la DECLARATION ; les tampons, eux,
   * arrivent plus tard (`addAudioTracks`), une fois le mixage rendu.
   */
  audioTracks?: readonly string[]
}

/** La forme d'une piste sonore : ce que le conteneur annonce avant le premier octet. */
export interface AudioTrackShape {
  sampleRate: number
  numberOfChannels: number
}

/**
 * Une piste sonore a ecrire dans le clip : son nom, et le tampon deja rendu.
 *
 * L'ORDRE DES PISTES N'EST PAS DECORATIF. La PREMIERE est celle que tout lecteur ordinaire
 * joue — un navigateur n'expose pas les autres. C'est donc le MIXAGE COMPLET qui doit venir en
 * premier ; les familles separees suivent, pour qui ouvre le fichier dans un montage. Livrer
 * les familles SANS le mixage ferait entendre les seuls bruitages, sans musique ni voix : une
 * regression pour tout le monde sauf le monteur.
 */
export interface AudioTrackInput {
  /** Nom lisible de la piste (« Mixage », « Bruitages », « Voix », « Musique »). */
  name: string
  buffer: AudioBuffer
}

/**
 * openVideoExport ouvre l'encodeur et le conteneur, et rend les trois gestes de la boucle.
 *
 * `null` = ce navigateur ne sait pas encoder CETTE image (configuration refusée) : l'appelant
 * bascule sur le repli. On ne lève pas — un export impossible n'est pas une panne, c'est une
 * capacité absente, et le plan (D5) veut qu'elle se traite par un autre bouton.
 */
/**
 * La forme de reference des pistes sonores : celle que rend le mixage hors ligne
 * (`replayAudioMix.ts`). Elle ne sert qu'a PROUVER que l'encodeur AAC l'accepte, AVANT de
 * declarer quoi que ce soit dans le conteneur — une piste declaree puis refusee perd tout
 * l'export.
 */
const MIX_TRACK_SHAPE: AudioTrackShape = { sampleRate: 48_000, numberOfChannels: 2 }

export async function openVideoExport(o: VideoExportOptions): Promise<VideoExportSink | null> {
  if (!canExportVideo()) return null
  const wanted = o.fps ?? EXPORT_FPS
  // LE PRÉRÉGLAGE SE PROUVE D'ABORD : il choisit le codec et le mode de débit (et, si HEVC/AV1
  // sont refusés, retombe sur H.264). La sonde de cadence (le repli 60->30) probe ensuite la
  // config qui sera réellement ouverte.
  const resolved = await resolveExportPreset(EXPORT_VIDEO_PRESET, o.width, o.height, wanted, browserSupports)
  if (resolved === null) return null
  const { preset, mode } = resolved
  const fps = await chooseExportFps(o.width, o.height, wanted, o.fallbackFps, browserSupports, mode, preset)
  if (fps === null) return null
  const fpsFallback = fps !== wanted
  if (fpsFallback) {
    // LOUD, NOT SILENT: the caller also shows it in the dialog (`ReplayExportState.fpsFallback`).
    console.warn(`[replay-export] ${o.width}x${o.height} at ${wanted} fps refused by this browser's encoder, encoding at ${fps} fps`)
  }
  const config = videoEncoderConfig(o.width, o.height, fps, mode, preset)
  // ON DIT LE PRÉRÉGLAGE ET LE MODE UNE FOIS, avec la config : le reviewer vérifie dans la
  // console ce qui a été demandé à l'encodeur, sans avoir à deviner ce qui a gagné la sonde.
  console.info(`[replay-export] preset ${preset.name}, rate mode ${mode} —`, JSON.stringify(config))
  const noms = o.audioTracks ?? []
  // LES PISTES SONORES SE PROUVENT AVANT D'ETRE DECLAREES (cf. `audioTrackUsable`) : le
  // conteneur ecrit sa table des pistes une fois pour toutes, et une piste declaree que
  // l'encodeur refusera ensuite perd TOUT l'export.
  const audioOk = noms.length > 0 && (await audioTrackUsable(MIX_TRACK_SHAPE))

  // LE FICHIER EST ECRIT EN FLUX, JAMAIS DANS UN SEUL ArrayBuffer.
  //
  // Un match complet en qualité constante peut dépasser plusieurs Go ; un seul ArrayBuffer ne
  // tient pas ca et l'export mourait en fin de course, apres avoir rendu tout le film. Ici, les
  // octets sont livres par `StreamTarget` dans un `WritableStream` et rabattus en `Blob` de ~64
  // Mo par `ExportFileTarget` : le navigateur garde les gros morceaux hors du tas JS.
  //
  // `fastStart: false` garde la disposition MP4 ordinaire (moov en fin de fichier). mediabunny
  // n'y fait alors qu'une seule reecriture in place — le patch de l'en-tete mdat, tout au debut
  // du fichier — et `ExportFileTarget` la recueille dans son tampon de tete mutable.
  const fileTarget = new ExportFileTarget()
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(
      new WritableStream<StreamTargetChunk>({
        write: (chunk) => fileTarget.write(chunk),
      }),
    ),
  })
  // La piste du conteneur déclare le codec du préréglage : `avc`, `hevc` ou `av1`.
  const videoSource = new EncodedVideoPacketSource(preset.codec)
  output.addVideoTrack(videoSource, { frameRate: fps })
  // Les pistes AUDIO sont ajoutees ICI, vides : leur EXISTENCE et leur ORDRE se declarent avant
  // le premier octet, leur contenu arrive plus tard (`addAudioTracks`).
  const audioSources = audioOk
    ? noms.map((name) => {
        const src = new AudioBufferSource({ codec: 'aac', quality: QUALITY_HIGH })
        output.addAudioTrack(src, { name })
        return src
      })
    : []
  await output.start()

  // La première erreur gagne et sera relancée par `finish` : une erreur d'encodeur arrive de
  // façon asynchrone, hors de la pile de l'appelant, et l'avaler rendrait un fichier tronqué
  // sans que rien ne le dise.
  let failure: Error | null = null
  /**
   * LES ECRITURES DE PAQUETS SONT ENCHAINEES, ET ATTENDUES AVANT LA FINALISATION.
   *
   * `videoSource.add()` est ASYNCHRONE — il rend une promesse — alors que le rappel `output`
   * d'un `VideoEncoder` est synchrone et ne peut rien attendre. Les lancer sans les suivre
   * (`void add(...)`) laissait `output.finalize()` fermer le fichier pendant que des paquets
   * etaient encore en vol : le clip sortait AVEC SON SON ET SANS IMAGE. `encoder.flush()` ne
   * protege pas de ca — il garantit que les paquets ont ete EMIS, pas qu'ils ont ete ECRITS.
   *
   * L'enchainement preserve aussi l'ORDRE : deux `add` concurrents pourraient s'ecrire dans le
   * desordre, ce qu'un flux video ne pardonne pas.
   */
  let ecritures: Promise<unknown> = Promise.resolve()
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const packet = EncodedPacket.fromEncodedChunk(chunk)
      ecritures = ecritures.then(() => videoSource.add(packet, meta))
    },
    error: (err) => {
      failure = err instanceof Error ? err : new Error(String(err))
    },
  })
  encoder.configure(config)
  const sink = makeSink(encoder, output, videoSource, audioSources, fps, mode, preset, () => failure, () => ecritures, {
    width: config.width,
    height: config.height,
  }, fileTarget)
  return { ...sink, fpsFallback, rateMode: mode }
}

/**
 * makeSink assemble les trois gestes. HORS de `openVideoExport` pour tenir la règle des 80
 * lignes du dépôt, et parce que l'ouverture (asynchrone, faillible) et l'usage (synchrone,
 * répété dix-huit mille fois) n'ont pas la même nature.
 */
function makeSink(
  encoder: VideoEncoder,
  output: Output,
  videoSource: EncodedVideoPacketSource,
  audioSources: readonly AudioBufferSource[],
  fps: number,
  mode: ExportRateMode,
  preset: ExportVideoPreset,
  failureOf: () => Error | null,
  /** La chaine des ecritures de paquets video, a attendre avant de finaliser. */
  ecrituresEnCours: () => Promise<unknown>,
  size: { width: number; height: number },
  /** Les octets du fichier, rabattus en `Blob` au fil de l'eau ; `finish` les rend, `abort` les jette. */
  fileTarget: ExportFileTarget,
): Omit<VideoExportSink, 'fpsFallback'> {
  let closed = false

  const addFrame = async (canvas: HTMLCanvasElement, index: number) => {
    const failed = failureOf()
    if (failed) throw failed
    if (closed) return
    // L'HORODATAGE EST CALCULÉ, JAMAIS MESURÉ (cf. l'en-tête) : c'est ce qui rend la durée du
    // clip indépendante du temps de calcul.
    const frame = new VideoFrame(canvas, {
      timestamp: frameTimestampUs(index, fps),
      duration: frameDurationUs(index, fps),
      // LE RECADRAGE EST EXPLICITE. Une toile d'une autre taille que la config (impaire, ou pas
      // encore au format) ne doit pas passer implicitement : sans `visibleRect`, on pousse une image
      // 1919x601 dans un encodeur configuré en 1918x600, et le comportement dépend alors de la
      // version du navigateur — mise à l'échelle implicite ici, erreur d'encodeur ailleurs.
      visibleRect: { x: 0, y: 0, width: size.width, height: size.height },
    })
    try {
      // le quantizer du préréglage, sous la clé de SON codec, seulement en mode quantizer :
      // dans les modes de débit le navigateur l'ignore, et l'envoyer mentirait la console.
      encoder.encode(frame, encodeOptionsFor(mode, isKeyFrame(index, fps), preset))
    } finally {
      // TOUJOURS, même si `encode` lève : une `VideoFrame` non fermée retient sa mémoire GPU,
      // et il en passe trente par seconde de match.
      frame.close()
    }
    while (shouldDrain(encoder.encodeQueueSize)) {
      // JAMAIS `setTimeout` ICI (cf. `eventLoopYield.ts`) : bridé à une seconde en onglet
      // caché, il rendait l'export dix fois plus lent que le temps réel qu'il encode.
      await yieldToEvents()
      const late = failureOf()
      if (late) throw late
    }
  }

  /**
   * addAudioTracks remet les tampons rendus, DANS L'ORDRE des noms declares a l'ouverture.
   *
   * `AudioBufferSource.close()` est appele apres chaque tampon : sans lui, la piste reste
   * ouverte et `output.finalize()` attendrait indefiniment de quoi la remplir.
   *
   * `progress` receives the share of the tracks already encoded, 0..1, after each one: on a full
   * match each track takes seconds of AAC encoding.
   */
  const addAudioTracks = async (tracks: readonly AudioTrackInput[], progress?: (fraction: number) => void) => {
    for (let i = 0; i < audioSources.length; i++) {
      const piste = tracks[i]
      if (piste) await audioSources[i].add(piste.buffer)
      audioSources[i].close()
      progress?.((i + 1) / audioSources.length)
    }
  }

  const finish = async (): Promise<Blob> => {
    await encoder.flush()
    // `flush()` garantit que les paquets ont ete EMIS ; celle-ci, qu'ils ont ete ECRITS.
    await ecrituresEnCours()
    const failed = failureOf()
    if (failed) throw failed
    // LES SOURCES SE FERMENT AVANT LA FINALISATION : une piste declaree mais jamais close
    // laisse `finalize()` attendre un contenu qui ne viendra pas.
    for (const src of audioSources) src.close()
    videoSource.close()
    // `finalize()` ferme le flux : tous les octets (y compris le patch mdat et le moov) ont
    // alors ete livres au target. On les rend tels quels, deja rabattus en `Blob`.
    await output.finalize()
    closed = true
    encoder.close()
    return fileTarget.finish()
  }

  const abort = () => {
    if (closed) return
    closed = true
    // On jette tout ce qui a ete ecrit jusqu'ici : sans ca, un match annule laisserait des
    // gigaoctets de `Blob` en attente dans le target.
    fileTarget.abort()
    // `close()` sur un encodeur déjà en erreur lève : l'annulation ne doit jamais masquer la
    // cause d'un échec par une seconde erreur.
    try {
      encoder.close()
    } catch {
      // Rien à dire : on annule, il n'y a pas de fichier à rendre ni d'appelant à prévenir.
    }
  }

  return { addFrame, addAudioTracks, audioEnabled: audioSources.length > 0, finish, abort, fps, rateMode: mode }
}


