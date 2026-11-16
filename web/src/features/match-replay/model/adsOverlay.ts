/**
 * adsOverlay.ts — THE AIM-DOWN-SIGHTS OVERLAY of each weapon, as data.
 *
 * Halo Infinite draws its scope screens as CUI (2D UI screens), so the game files hold no scope
 * bitmap to extract. Each overlay is therefore redrawn procedurally from the in-game captures of the
 * real ADS view (1280x720, horizontal FOV 108, the viewer's default FOV). This module only says WHICH
 * overlay a weapon shows and what each zoom level prints; the drawing (`ui/ReplayAthLunette3d`)
 * holds the geometry, in units of 1/720 of the screen height with the origin at the screen center.
 *
 * A weapon nobody captured gets no copy of another weapon's overlay: a scoped one (a weapon whose
 * scope kind replaces the reticle) gets the neutral MINIMAL overlay, a thin center reticle; any
 * other keeps its own hip reticle.
 */
import type { ScopeSpec } from './scopeLogic'

/**
 * The FOV of the captures, in degrees (horizontal). The overlays are screen-space CUI, so their
 * geometry does not follow the field of view; it matches the captures exactly at this FOV.
 */
export const ADS_REFERENCE_FOV_DEG = 108

/**
 * The overlay families. Several weapons share one: the human and Banished small arms all show the
 * same smart-link frame at 1.40x (Sidekick, MA40, Bulldog, Disruptor, Mangler, Plasma Pistol).
 */
export type AdsDesign =
  | 'smartLink'
  | 'br75'
  | 'commando'
  | 'bandit'
  | 's7'
  | 'shock'
  | 'skewer'
  | 'stalker'
  | 'vestige'
  | 'minimal'

/** One zoom level of an overlay. */
export interface AdsLevel {
  /** The zoom label the game prints at this level ('1.40x', '2.0x'...), null when it prints none. */
  label: string | null
}

/** How close a drawing is to its capture. */
export type AdsFidelity = 'faithful' | 'approximate' | 'fallback'

export interface AdsOverlaySpec {
  design: AdsDesign
  /** The levels, index = zoom level - 1. A level past the last draws the last. */
  levels: readonly AdsLevel[]
  /** The overlay prints the magazine count (the smart-link frame, the Commando, the Bandit). */
  ammo: boolean
  /** The overlay draws its own center reticle; otherwise the weapon's hip reticle stays. */
  ownReticle: boolean
  fidelity: AdsFidelity
}

const SMART_LINK: AdsOverlaySpec = { design: 'smartLink', levels: [{ label: '1.40x' }], ammo: true, ownReticle: false, fidelity: 'faithful' }

/** The neutral overlay of a scoped weapon nobody captured: a thin center reticle, nothing else. */
export const ADS_MINIMAL: AdsOverlaySpec = { design: 'minimal', levels: [{ label: null }], ammo: false, ownReticle: true, fidelity: 'fallback' }

/** THE TABLE, by weapon label key (`weaponLabels[id].key`): the weapons the captures show. */
export const ADS_OVERLAYS: Readonly<Record<string, AdsOverlaySpec>> = {
  hinf_sidekick: SMART_LINK,
  hinf_ma40_ar: SMART_LINK,
  hinf_cqs48_bulldog: SMART_LINK,
  hinf_disruptor: SMART_LINK,
  hinf_mangler: SMART_LINK,
  hinf_plasma_pistol: SMART_LINK,
  hinf_br75: { design: 'br75', levels: [{ label: null }], ammo: false, ownReticle: true, fidelity: 'faithful' },
  hinf_vk78_commando: { design: 'commando', levels: [{ label: '2.0x' }], ammo: true, ownReticle: true, fidelity: 'approximate' },
  hinf_bandit: { design: 'bandit', levels: [{ label: '1.6X' }], ammo: true, ownReticle: true, fidelity: 'faithful' },
  hinf_s7_sniper: { design: 's7', levels: [{ label: '5x' }, { label: '10x' }], ammo: false, ownReticle: true, fidelity: 'faithful' },
  hinf_shock_rifle: { design: 'shock', levels: [{ label: null }], ammo: false, ownReticle: true, fidelity: 'approximate' },
  hinf_skewer: { design: 'skewer', levels: [{ label: null }, { label: null }], ammo: false, ownReticle: true, fidelity: 'approximate' },
  hinf_stalker_rifle: { design: 'stalker', levels: [{ label: null }, { label: null }], ammo: false, ownReticle: true, fidelity: 'approximate' },
  hinf_vestige_carbine: { design: 'vestige', levels: [{ label: null }], ammo: false, ownReticle: true, fidelity: 'approximate' },
}

/** The label keys of the weapons the scope table knows by model key (first eight hex digits). */
const LABEL_BY_MODEL: Readonly<Record<string, string>> = {
  '0a1992bc': 'hinf_s7_sniper',
  '1a22fee6': 'hinf_shock_rifle',
  'adb78225': 'hinf_stalker_rifle',
  '2b1824d5': 'hinf_br75',
  fd98554c: 'hinf_vk78_commando',
  '6acdc44d': 'hinf_bandit',
  '2fb21c87': 'hinf_bandit',
}

/**
 * adsOverlayFor gives the overlay of the held weapon: the captured one by label key (then by model
 * key), else the minimal overlay for a weapon whose scope replaces the reticle, else null (the
 * weapon keeps its hip reticle and draws no frame).
 */
export function adsOverlayFor(
  modelKey: string | null | undefined,
  labelKey: string | null | undefined,
  scope: ScopeSpec,
): AdsOverlaySpec | null {
  const byLabel = labelKey ? ADS_OVERLAYS[labelKey] : undefined
  if (byLabel) return byLabel
  const viaModel = modelKey ? LABEL_BY_MODEL[modelKey.toLowerCase()] : undefined
  if (viaModel) return ADS_OVERLAYS[viaModel]
  return scope.kind === 'smartLink' ? null : ADS_MINIMAL
}

/**
 * adsLevelIndex is the level the overlay draws for the film's zoom level (1, 2...): its index in
 * `spec.levels`, the last one past the declared levels, the first one when the film gives no level
 * (`zoomLevel` <= 0, e.g. a zoom fading out with no recorded level).
 */
export function adsLevelIndex(spec: AdsOverlaySpec, zoomLevel: number): number {
  if (!(zoomLevel > 0)) return 0
  return Math.min(Math.floor(zoomLevel), spec.levels.length) - 1
}

/** The magazine count the overlay prints: two digits like the game ('07'), null when unknown. */
export function adsAmmoText(mag: number | null | undefined): string | null {
  if (mag == null || !Number.isFinite(mag)) return null
  return String(Math.max(0, Math.round(mag))).padStart(2, '0')
}
