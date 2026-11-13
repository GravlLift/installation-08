/**
 * ReplaySettingsLook3d — ported from LevelUp's `settings/ReplaySettingsLook3d.tsx`: the
 * "3D view" section of the drawer (shadows, reflections, ambient occlusion, game lighting,
 * field of view).
 *
 * Shown only once a 3D map is loaded (same gate as the source). Settings live in
 * `useReplay3dLook`/`useReplay3dFov`, already lifted; the 3D view reads them on its own.
 */
import { GAME_FOV_MAX, GAME_FOV_MIN } from '../model/fovLogic'
import { useReplay3DExport } from '../export/replay3dExportStore'
import type { ReplayLocale } from '../i18n/i18n'
import { SCENE3D_TEXT } from '../i18n/scene3dText'
import { SettingsToggle } from './SettingsControls'
import { useReplay3dFov } from './useReplay3dFov'
import { useReplay3dLook } from './useReplay3dLook'

export function Look3dSection({ locale }: { locale: ReplayLocale }) {
  const t = SCENE3D_TEXT[locale]
  const loaded = useReplay3DExport() !== null
  const { look, toggleShadows, toggleReflections, toggleOcclusion, toggleGameLight } = useReplay3dLook()
  const { fov, setFov } = useReplay3dFov()
  if (!loaded) return null
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-medium text-muted-foreground">{t.lookTitle}</h3>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <SettingsToggle label={t.lookShadows} pressed={look.shadows} onToggle={toggleShadows} hint={t.lookShadowsHint} />
        <SettingsToggle
          label={t.lookReflections}
          pressed={look.reflections}
          onToggle={toggleReflections}
          hint={t.lookReflectionsHint}
        />
        <SettingsToggle
          label={t.lookOcclusion}
          pressed={look.ambientOcclusion}
          onToggle={toggleOcclusion}
          hint={t.lookOcclusionHint}
        />
        <SettingsToggle
          label={t.lookGameLight}
          pressed={look.gameLight}
          onToggle={toggleGameLight}
          hint={t.lookGameLightHint}
        />
        <label className="col-span-2 flex items-center gap-2 text-xs text-muted-foreground" title={t.lookFovHint}>
          <span className="shrink-0">{t.lookFov}</span>
          <input
            type="range"
            min={GAME_FOV_MIN}
            max={GAME_FOV_MAX}
            step={1}
            value={fov}
            onChange={(e) => setFov(Number(e.currentTarget.value))}
            aria-label={t.lookFov}
            className="h-3 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
          />
          <span className="w-7 shrink-0 text-right font-mono tabular-nums text-foreground">{fov}</span>
        </label>
      </div>
    </section>
  )
}
