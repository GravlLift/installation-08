/**
 * ReplaySettingsAids3d — ported from LevelUp's `settings/ReplaySettingsAids3d.tsx`: the
 * "Analysis aids" section of the drawer, one toggle per `aids3d` flag, in `AIDS3D_ORDER`.
 *
 * Shown only once a 3D map is loaded (same gate as the source: `useReplay3DExport() !== null`),
 * same as having no commands when there is nothing to command. Settings live in
 * `useReplay3dAids`, already lifted; the 3D view reads them on its own.
 */
import { useReplay3DExport } from '../export/replay3dExportStore'
import type { ReplayLocale } from '../i18n/i18n'
import { SCENE3D_TEXT } from '../i18n/scene3dText'
import { AIDS3D_ORDER } from '../scene3d/aids3d'
import { InfoMark, SettingsToggle } from './SettingsControls'
import { useReplay3dAids } from './useReplay3dAids'

export function Aids3dSection({ locale }: { locale: ReplayLocale }) {
  const t = SCENE3D_TEXT[locale]
  const loaded = useReplay3DExport() !== null
  const { aids, toggle } = useReplay3dAids()
  if (!loaded) return null
  return (
    <section className="space-y-1">
      <h3 className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {t.aidsTitle}
        <InfoMark text={t.aidsTitleHint} />
      </h3>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {AIDS3D_ORDER.map((key) => (
          <SettingsToggle
            key={key}
            label={t.aids[key].label}
            pressed={aids[key]}
            onToggle={toggle[key]}
            hint={t.aids[key].hint}
          />
        ))}
      </div>
    </section>
  )
}
