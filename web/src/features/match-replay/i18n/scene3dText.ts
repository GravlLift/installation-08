// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * scene3dText.ts — the text for the replay's 3D VIEW, FR + EN, parity by typing.
 *
 * A table separate from the replay dictionary (`i18nContract.ts`): the 3D view only exists on
 * the user's own machine (`can_view_replay_3d` capability), and its few texts read together
 * as a group.
 */
import type { Aids3d } from '../scene3d/aids3d'
import type { ReplayLocale } from './i18n'

/**
 * Standalone port note: LevelUp's build-step union lives in `lib/replay/meshBuild`, a
 * TanStack Query module (API client, query keys, app store) this viewer does not lift —
 * there is no "build the 3D map from your own game files" flow here. The union is kept
 * literally so `buildSteps` below still type-checks; `ReplayChargement3d` never reads it.
 */
type ReplayMeshBuildStep = 'geometry' | 'lighting' | 'writing' | 'libraries'

export interface Scene3dText {
  /** Map toggle: top-down view. */
  view2d: string
  /** Map toggle: 3D view. */
  view3d: string
  /** Accessible name of the toggle group. */
  viewGroup: string
  /** 3D view cameras. */
  cameraGroup: string
  cameraFirst: string
  cameraThird: string
  cameraFree: string
  /** The three camera names, short, as the player's control bar shows them (the full names are their tooltips). */
  cameraFirstShort: string
  cameraThirdShort: string
  cameraFreeShort: string
  /** Free-view controls, under the cameras (keys match the layout: QWERTY / AZERTY). */
  cameraFreeHint: string
  /** "3D map: 42% of 224 MB" — the mesh download. */
  loadingFmt: (percent: number, megabytes: number) => string
  /** Steps after the download. */
  loadingMaterials: string
  loadingIndex: string
  loadingAssets: string
  loadingWarmup: string
  /** Load failure: the view says so instead of staying black. */
  loadFailed: string
  /** The followed player has not spawned yet: the camera waits for their first spawn. */
  povUnspawned: string
  /** No viewpoint chosen: only the free camera makes sense. */
  noPov: string
  /** Surface inspector (dev build): the line is now on the clipboard. */
  probeCopied: string
  /** Playback meter (right, under the minimap): frames per second, « 13 / 30 fps ». */
  cadenceIps: string
  /** Playback meter: the worst frame's label, « worst 22.4 ms ». */
  cadencePire: string
  /** Playback meter: the film is paused (no real-time ratio). */
  cadencePaused: string
  /** The corner inset view: enlarge it (whichever one is there), move it, resize it. */
  insetEnlarge2d: string
  insetEnlarge3d: string
  insetMove: string
  insetResize: string
  /** Export dialog: the exported view, and its 3D-specific settings. */
  exportView: string
  exportView2d: string
  exportView3d: string
  /** The export's free camera does not move during the clip. */
  exportCameraFreeFixed: string
  exportFollow: string
  exportMinimap: string
  /** Settings drawer: the 3D view section and its toggles. */
  lookTitle: string
  /** The game's field-of-view setting (horizontal degrees at 16:9), a slider rather than a toggle. */
  lookFov: string
  lookFovHint: string
  lookShadows: string
  lookShadowsHint: string
  lookReflections: string
  lookReflectionsHint: string
  lookOcclusion: string
  lookOcclusionHint: string
  lookGameLight: string
  lookGameLightHint: string
  lookBloom: string
  lookBloomHint: string
  lookGlowAnimation: string
  lookGlowAnimationHint: string
  /** The playback meter's toggle (also the ` key). */
  lookPlaybackFps: string
  lookPlaybackFpsHint: string
  /** Settings drawer: the 3D view's analysis aids (`aids3d`), off by default. */
  aidsTitle: string
  aidsTitleHint: string
  aids: Record<keyof Aids3d, { label: string; hint: string }>
  /** 3D map build panel, shown while its mesh is still missing on this machine. */
  buildTitle: string
  buildBody: string
  buildAction: string
  /** Build in progress: title, steps, start, finish (the view loads), waiting for the match. */
  buildingTitle: string
  buildSteps: Record<ReplayMeshBuildStep, string>
  buildStarting: string
  buildDone: string
  buildWaitingForGame: string
  /** Build failure, and retry. */
  buildFailed: string
  buildRetry: string
  /** Unavailable: Halo Infinite not found on this machine, and the fix (the explanation stands in for the failure). */
  buildGameMissing: string
  /** Unavailable: the build tool is missing, and the fix. */
  buildToolMissing: string
  /** Launch refused: another map is already being built. */
  buildBusy: string
  /** Map shown without its variant's object layer: launching the build, its progress, its failure. */
  variantBuildAction: string
  variantBuilding: string
  variantBuildFailed: string
}

export const SCENE3D_TEXT: Record<ReplayLocale, Scene3dText> = {
  fr: {
    view2d: '2D',
    view3d: '3D',
    viewGroup: 'Vue de la carte',
    cameraGroup: 'Caméra',
    cameraFirst: '1re personne',
    cameraThird: '3e personne',
    cameraFree: 'Vue libre',
  cameraFirstShort: '1re',
  cameraThirdShort: '3e',
  cameraFreeShort: 'Libre',
    cameraFreeHint: 'ZQSD : avancer · E / A : monter, descendre · Maj : plus vite · souris : tourner, clic droit : décaler, molette : approcher',
    loadingFmt: (percent, megabytes) => `Carte 3D : ${percent} % de ${megabytes} Mo`,
    loadingMaterials: 'Décodage des matériaux…',
    loadingIndex: 'Préparation de la carte…',
    loadingAssets: 'Chargement des modèles et armures…',
    loadingWarmup: "Préparation de l'affichage…",
    loadFailed: 'La carte 3D n’a pas pu être chargée.',
    povUnspawned: 'Pas encore apparu',
    noPov: 'Choisissez un joueur à suivre',
    probeCopied: 'copié',
    cadenceIps: 'ips',
    cadencePire: 'pire',
    cadencePaused: 'en pause',
    insetEnlarge2d: 'Agrandir la carte 2D',
    insetEnlarge3d: 'Agrandir la vue 3D',
    insetMove: 'Changer de côté',
    insetResize: 'Changer de taille',
    exportView: 'Vue',
    exportView2d: 'Carte 2D',
    exportView3d: 'Vue 3D',
    exportCameraFreeFixed: 'Vue libre, fixe',
    exportFollow: 'Suivi',
    exportMinimap: 'Carte 2D réduite dans un coin',
    lookTitle: 'Vue 3D',
    lookFov: 'Champ de vision',
    lookFovHint: 'Le réglage de champ du jeu, en degrés. L’arme en 1re personne garde la taille à laquelle elle est réglée.',
    lookShadows: 'Ombres portées',
    lookShadowsHint: 'Ombres du soleil, portées par la carte, les joueurs et les véhicules.',
    lookReflections: 'Reflets',
    lookReflectionsHint: 'Reflets et lumière renvoyée par les surfaces de la carte.',
    lookOcclusion: 'Occlusion ambiante',
    lookOcclusionHint: 'Assombrit les coins et les recoins. Le plus coûteux des réglages.',
    lookGameLight: 'Lumière du jeu',
    lookGameLightHint: 'La lumière cuite et les lampes de la carte, telles que le jeu les pose.',
    lookBloom: 'Halo lumineux',
    lookBloomHint: "Les surfaces lumineuses (lampes, bandeaux, lames d'énergie) rayonnent au-delà de leurs bords.",
    lookGlowAnimation: 'Lumières animées',
    lookGlowAnimationHint: 'Les enseignes, écrans et néons de la carte défilent et scintillent comme en jeu.',
    lookPlaybackFps: 'Afficher les ips de lecture',
    lookPlaybackFpsHint: "Les images du film affichées par seconde face à sa cadence native, le rapport au temps réel, puis le temps d'image et le coût du rendu. Touche `.",
    aidsTitle: 'Repères d’analyse',
    aidsTitleHint: 'Des traits et des marques que le jeu ne montre pas, pour lire une action. Éteints, la vue ressemble au jeu.',
    aids: {
      shotLines: {
        label: 'Lignes de tir',
        hint: 'Le vol entier de chaque tir, de la bouche au mur, et le trait du tueur vers sa victime.',
      },
      deathMarkers: {
        label: 'Croix des morts',
        hint: 'Une croix au sol là où chaque joueur est tombé, et au-dessus « tueur › victime · arme ». La liste des éliminations n’en dépend pas.',
      },
      projectilePaths: {
        label: 'Trajectoires',
        hint: 'Le chemin parcouru par les grenades et les projectiles (roquettes, mortier…).',
      },
      blastRadius: {
        label: 'Rayon des explosions',
        hint: 'La sphère du rayon de dégâts de chaque explosion, une seconde après la détonation.',
      },
      grappleLines: {
        label: 'Câbles du grappin',
        hint: 'Le câble du grappin en trait épais et clair, avec son point d’accroche.',
      },
      knockbackArrows: {
        label: 'Flèches de poussée',
        hint: 'La direction et la force de chaque poussée du répulseur, à la couleur de son auteur.',
      },
      placementShapes: {
        label: 'Formes des poses',
        hint: "Traqueur, failles du translocateur et objets lâchés. Le mur, l'écran occultant, le capteur et le champ de réparation restent affichés.",
      },
      allNameTags: {
        label: 'Tous les noms',
        hint: 'Le nom de chaque joueur à toute distance. Éteint, seuls les joueurs proches de la caméra sont nommés.',
      },
    },
    buildTitle: 'Carte 3D pas encore construite',
    buildBody:
      'Elle se construit à partir de Halo Infinite installé sur cet ordinateur, en moins d’une minute, et reste sur cet ordinateur. La première construction prépare aussi les modèles d’armure et de vue à la première personne : quelques minutes, une seule fois.',
    buildAction: 'Construire la carte 3D',
    buildingTitle: 'Construction de la carte 3D',
    buildSteps: {
      geometry: 'Lecture de la géométrie et des textures',
      lighting: 'Lumière de la carte',
      writing: 'Écriture du fichier',
      libraries: 'Modèles d’armure et vue à la première personne (une seule fois, quelques minutes)',
    },
    buildStarting: 'Démarrage…',
    buildDone: 'Carte construite, chargement…',
    buildWaitingForGame: 'En attente de la fin de la partie',
    buildFailed: 'La construction a échoué',
    buildRetry: 'Réessayer',
    buildGameMissing:
      'Halo Infinite n’a pas été trouvé sur cet ordinateur. La carte 3D se construit à partir des fichiers du jeu installés : installez le jeu, ou indiquez son dossier avec LEVELUP_HALO_DEPLOY.',
    buildToolMissing: 'Le constructeur de cartes 3D est manquant dans cette installation. Réinstallez LevelUp pour le retrouver.',
    buildBusy: 'Une autre carte est en construction',
    variantBuildAction: 'Construire les objets de la carte',
    variantBuilding: 'Construction des objets de la carte',
    variantBuildFailed: 'Les objets de la carte n’ont pas pu être construits',
  },
  en: {
    view2d: '2D',
    view3d: '3D',
    viewGroup: 'Map view',
    cameraGroup: 'Camera',
    cameraFirst: '1st person',
    cameraThird: '3rd person',
    cameraFree: 'Free view',
  cameraFirstShort: '1st',
  cameraThirdShort: '3rd',
  cameraFreeShort: 'Free',
    cameraFreeHint: 'WASD: fly · E / Q: up, down · Shift: faster · mouse: turn, right-drag: slide, wheel: zoom',
    loadingFmt: (percent, megabytes) => `3D map: ${percent}% of ${megabytes} MB`,
    loadingMaterials: 'Decoding materials…',
    loadingIndex: 'Preparing the map…',
    loadingAssets: 'Loading models and armor…',
    loadingWarmup: 'Preparing the view…',
    loadFailed: 'The 3D map could not be loaded.',
    povUnspawned: 'Not spawned yet',
    noPov: 'Pick a player to follow',
    probeCopied: 'copied',
    cadenceIps: 'fps',
    cadencePire: 'worst',
    cadencePaused: 'paused',
    insetEnlarge2d: 'Enlarge the 2D map',
    insetEnlarge3d: 'Enlarge the 3D view',
    insetMove: 'Move to the other side',
    insetResize: 'Change size',
    exportView: 'View',
    exportView2d: '2D map',
    exportView3d: '3D view',
    exportCameraFreeFixed: 'Free view, fixed',
    exportFollow: 'Follow',
    exportMinimap: '2D mini-map in a corner',
    lookTitle: '3D view',
    lookFov: 'Field of view',
    lookFovHint: 'The game’s field-of-view setting, in degrees. The first-person weapon keeps its tuned size.',
    lookShadows: 'Cast shadows',
    lookShadowsHint: 'Sun shadows cast by the map, players and vehicles.',
    lookReflections: 'Reflections',
    lookReflectionsHint: 'Reflections and light bounced off the map surfaces.',
    lookOcclusion: 'Ambient occlusion',
    lookOcclusionHint: 'Darkens corners and crevices. The costliest setting.',
    lookGameLight: 'Game lighting',
    lookGameLightHint: "The map's baked light and lamps, as the game places them.",
    lookBloom: 'Bloom',
    lookBloomHint: 'Glowing surfaces (lamps, light strips, energy blades) shine past their edges.',
    lookGlowAnimation: 'Animated lights',
    lookGlowAnimationHint: "The map's signs, screens and neon scroll and flicker as in the game.",
    lookPlaybackFps: 'Show playback FPS',
    lookPlaybackFpsHint: "Film frames shown per second against the film's native rate, the real-time ratio, then frame time and render cost. Key `.",
    aidsTitle: 'Analysis aids',
    aidsTitleHint: 'Lines and marks the game does not show, to read a play. Off, the view looks like the game.',
    aids: {
      shotLines: {
        label: 'Shot lines',
        hint: "Each shot's full flight from the muzzle to the wall, and the line from killer to victim.",
      },
      deathMarkers: {
        label: 'Death markers',
        hint: 'A cross on the ground where each player fell, with "killer › victim · weapon" above it. The kills list does not depend on it.',
      },
      projectilePaths: {
        label: 'Projectile paths',
        hint: 'The path travelled by grenades and projectiles (rockets, mortar…).',
      },
      blastRadius: {
        label: 'Blast radius',
        hint: 'The damage radius sphere of each explosion, for one second after it goes off.',
      },
      grappleLines: {
        label: 'Grapple lines',
        hint: 'The grapple cable as a thick bright line, with its anchor point.',
      },
      knockbackArrows: {
        label: 'Knockback arrows',
        hint: 'The direction and strength of each repulsor push, in the color of the player who pushed.',
      },
      placementShapes: {
        label: 'Placement shapes',
        hint: 'Threat seeker, translocator rifts and dropped items. The drop wall, shroud screen, threat sensor and repair field stay shown.',
      },
      allNameTags: {
        label: 'All name tags',
        hint: "Every player's name at any distance. Off, only players near the camera are named.",
      },
    },
    buildTitle: '3D map not built yet',
    buildBody:
      'It is built from the Halo Infinite installed on this computer, in under a minute, and stays on this computer. The first build also prepares the armor and first-person models: a few minutes, one time.',
    buildAction: 'Build the 3D map',
    buildingTitle: 'Building the 3D map',
    buildSteps: {
      geometry: 'Reading geometry and textures',
      lighting: 'Map lighting',
      writing: 'Writing the file',
      libraries: 'Armor and first-person models (one time, a few minutes)',
    },
    buildStarting: 'Starting…',
    buildDone: 'Map built, loading…',
    buildWaitingForGame: 'Waiting for your match to end',
    buildFailed: 'The build failed',
    buildRetry: 'Try again',
    buildGameMissing:
      'Halo Infinite was not found on this computer. The 3D replay builds its maps from your own game files: install the game, or set LEVELUP_HALO_DEPLOY to its folder.',
    buildToolMissing: 'The 3D map builder is missing from this installation. Reinstall LevelUp to restore it.',
    buildBusy: 'Another map is being built',
    variantBuildAction: 'Build the map objects',
    variantBuilding: 'Building the map objects',
    variantBuildFailed: 'The map objects could not be built',
  },
}
