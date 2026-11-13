/**
 * ReplaySettingsLayers — the "Layers" section of the drawer, scoped to exactly the toggles the
 * 3D view's `action.show` (`Action3dShow`, `scene3d/action3dInputs.ts`) actually reads: shot and
 * kill effects, weapon pads, ground weapons (plus its two sub-filters), placements, vehicles,
 * mode objectives, flags, VIP crown, bomb carrier.
 *
 * NOT A PORT of LevelUp's `ReplaySettingsLayers.tsx`: that file also carries the 2D-only aim/
 * zones/trail layers and five `available` gates computed from Match View context (zone names,
 * published pads, roster scoreboard) that this server does not serve (see `docs/PARITY.md`).
 * Rather than port five unused `available` booleans, every toggle here is shown unconditionally
 * — the same simplification `useReplaySettings`'s own file note already makes for the heatmap.
 * The skull carrier has no toggle in 3D (its holder carries it as a held weapon, no separate
 * marker — see the comment on `Action3dShow` in `action3dInputs.ts`), so it is not listed here.
 */
import { SettingsToggle } from './SettingsControls'
import { REPLAY_TEXT, type ReplayLocale } from '../i18n/i18n'
import type { Action3dShow } from '../scene3d/action3dInputs'

export interface ReplayLayerControls {
  show: Action3dShow
  toggle: { [K in keyof Action3dShow]: () => void }
}

export function LayersSection({ locale, show, toggle }: { locale: ReplayLocale } & ReplayLayerControls) {
  const t = REPLAY_TEXT[locale]
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-medium text-muted-foreground">{t.effects}</h3>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <SettingsToggle label={t.layerShotFx} pressed={show.shots} onToggle={toggle.shots} hint={t.layerShotFxHint} />
        <SettingsToggle label={t.layerKillFx} pressed={show.kills} onToggle={toggle.kills} hint={t.layerKillFxHint} />
      </div>
      <h3 className="pt-1 text-xs font-medium text-muted-foreground">{t.layers}</h3>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <SettingsToggle
          label={t.layerWeaponPads}
          pressed={show.weaponPads}
          onToggle={toggle.weaponPads}
          hint={t.layerWeaponPadsHint}
        />
        <SettingsToggle
          label={t.layerGroundWeapons}
          pressed={show.groundWeapons}
          onToggle={toggle.groundWeapons}
          hint={t.layerGroundWeaponsHint}
        />
        {show.groundWeapons && (
          <>
            <SettingsToggle
              label={t.layerGroundWeaponsSpecialOnly}
              pressed={show.groundWeaponsSpecialOnly}
              onToggle={toggle.groundWeaponsSpecialOnly}
              hint={t.layerGroundWeaponsSpecialOnlyHint}
            />
            <SettingsToggle
              label={t.layerGroundWeaponsStarting}
              pressed={show.groundWeaponsStarting}
              onToggle={toggle.groundWeaponsStarting}
              hint={t.layerGroundWeaponsStartingHint}
            />
          </>
        )}
        <SettingsToggle
          label={t.layerPlacements}
          pressed={show.placements}
          onToggle={toggle.placements}
          hint={t.layerPlacementsHint}
        />
        <SettingsToggle label={t.layerVehicles} pressed={show.vehicles} onToggle={toggle.vehicles} hint={t.layerVehiclesHint} />
        <SettingsToggle
          label={t.layerModeObjectives}
          pressed={show.objectives}
          onToggle={toggle.objectives}
          hint={t.layerModeObjectivesHint}
        />
        <SettingsToggle label={t.layerFlagCarries} pressed={show.flags} onToggle={toggle.flags} hint={t.layerFlagCarriesHint} />
        <SettingsToggle label={t.layerVipCrown} pressed={show.vipCrown} onToggle={toggle.vipCrown} hint={t.layerVipCrownHint} />
        <SettingsToggle
          label={t.layerBombCarrier}
          pressed={show.bombCarrier}
          onToggle={toggle.bombCarrier}
          hint={t.layerBombCarrierHint}
        />
      </div>
    </section>
  )
}
