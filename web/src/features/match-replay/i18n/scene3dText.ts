/**
 * scene3dText.ts — les textes de la VUE 3D du rejeu, FR + EN, parité par typage.
 *
 * Table à part du dictionnaire du rejeu (`i18nContract.ts`) : la vue 3D n'existe que sur le
 * poste de l'utilisateur (capacité `can_view_replay_3d`), et ses quelques textes se lisent
 * ensemble.
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
  /** Grossissement affiché dans le cadre du Bandit. */
  banditZoom: string
  /** Bascule de la carte : vue du dessus. */
  view2d: string
  /** Bascule de la carte : vue 3D. */
  view3d: string
  /** Nom accessible du groupe de bascule. */
  viewGroup: string
  /** Caméras de la vue 3D. */
  cameraGroup: string
  cameraFirst: string
  cameraThird: string
  cameraFree: string
  /** Les commandes de la vue libre, sous les caméras (touches à leur place : QWERTY / AZERTY). */
  cameraFreeHint: string
  /** « Carte 3D : 42 % de 224 Mo » — le téléchargement du maillage. */
  loadingFmt: (percent: number, megabytes: number) => string
  /** Étapes après le téléchargement. */
  loadingMaterials: string
  loadingIndex: string
  loadingAssets: string
  loadingWarmup: string
  /** Échec du chargement : la vue le dit au lieu de rester noire. */
  loadFailed: string
  /** Le joueur suivi n'est pas encore apparu : la caméra attend à sa première apparition. */
  povUnspawned: string
  /** Aucun point de vue choisi : la caméra libre seule a un sens. */
  noPov: string
  /** Inspecteur de surfaces (poste de développement) : la ligne est dans le presse-papiers. */
  probeCopied: string
  /** Lecteur de cadence (coin haut droit) : les images par seconde, « 60 ips ». */
  cadenceIps: string
  /** Lecteur de cadence : l'étiquette de la pire image, « pire 22.4 ms ». */
  cadencePire: string
  /** La vue réduite du coin : l'agrandir (selon celle qui y est), la déplacer, la retailler. */
  insetEnlarge2d: string
  insetEnlarge3d: string
  insetMove: string
  insetResize: string
  /** Boîte d'export : la vue exportée, et ses réglages en 3D. */
  exportView: string
  exportView2d: string
  exportView3d: string
  /** La caméra libre de l'export ne bouge pas pendant le clip. */
  exportCameraFreeFixed: string
  exportFollow: string
  exportMinimap: string
  /** Tiroir des réglages : la section de la vue 3D et ses interrupteurs. */
  lookTitle: string
  /** Le réglage de champ du jeu (degrés horizontaux à 16:9), un curseur et non une bascule. */
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
  /** Tiroir des réglages : les repères d'analyse de la vue 3D (`aids3d`), éteints par défaut. */
  aidsTitle: string
  aidsTitleHint: string
  aids: Record<keyof Aids3d, { label: string; hint: string }>
  /** Panneau de construction de la carte 3D, quand son maillage manque encore sur le poste. */
  buildTitle: string
  buildBody: string
  buildAction: string
  /** Construction en cours : titre, étapes, démarrage, fin (la vue se charge), attente de la partie. */
  buildingTitle: string
  buildSteps: Record<ReplayMeshBuildStep, string>
  buildStarting: string
  buildDone: string
  buildWaitingForGame: string
  /** Échec de la construction, et nouvel essai. */
  buildFailed: string
  buildRetry: string
  /** Indisponible : Halo Infinite absent du poste, et le remède (l'explication tient lieu d'échec). */
  buildGameMissing: string
  /** Indisponible : l'outil de construction manquant, et le remède. */
  buildToolMissing: string
  /** Lancement refusé : une autre carte est en construction. */
  buildBusy: string
  /** Carte affichée sans le calque des objets de sa variante : le lancer, son avancement, son échec. */
  variantBuildAction: string
  variantBuilding: string
  variantBuildFailed: string
}

export const SCENE3D_TEXT: Record<ReplayLocale, Scene3dText> = {
  fr: {
    banditZoom: '1.6X',
    view2d: '2D',
    view3d: '3D',
    viewGroup: 'Vue de la carte',
    cameraGroup: 'Caméra',
    cameraFirst: '1re personne',
    cameraThird: '3e personne',
    cameraFree: 'Vue libre',
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
    banditZoom: '1.6X',
    view2d: '2D',
    view3d: '3D',
    viewGroup: 'Map view',
    cameraGroup: 'Camera',
    cameraFirst: '1st person',
    cameraThird: '3rd person',
    cameraFree: 'Free view',
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
