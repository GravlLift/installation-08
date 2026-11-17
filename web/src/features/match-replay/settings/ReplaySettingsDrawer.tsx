// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ReplaySettingsDrawer — the settings panel for the 3D view, ported in spirit from LevelUp's
 * `ReplaySettingsDrawer.tsx`: an overlay panel (not a modal — the replay keeps playing behind
 * it), dismissed by Escape, a click outside, or the close button, with focus entering the panel
 * on open.
 *
 * Placed by the player, not here: it renders in place, and the player puts it in its panel slot
 * (`.bc-panel`, between the top strip and the control bar), so it never covers the bar's buttons
 * and comes along into fullscreen with the rest of the player. It scrolls when taller than the
 * slot. Left out entirely (not present in this standalone shell, see `docs/PARITY.md`): the 2D
 * map's aim/zones/trail/heatmap toggles, marker colors and export — none of those have any
 * effect here yet.
 *
 * Carries `data-replay-escape-layer`, the attribute that marks a layer Escape closes.
 */
import { useEffect, useRef, type RefObject } from 'react'

import { REPLAY_TEXT, type ReplayLocale } from '../i18n/i18n'
import { LayersSection, type ReplayLayerControls } from './ReplaySettingsLayers'
import { Aids3dSection } from './ReplaySettingsAids3d'
import { Look3dSection } from './ReplaySettingsLook3d'
import { TeamColorsSection } from './ReplaySettingsTeamColors'
import { SettingsToggle } from './SettingsControls'
import { SOUND_CATEGORIES } from '../sound/replaySound'
import type { ReplaySound } from '../sound/useReplaySound'
import { TEXTURE_QUALITIES, useTextureQuality } from './useTextureQuality'

const PANEL_WIDTH = 360

interface ReplaySettingsDrawerProps extends ReplayLayerControls {
  locale: ReplayLocale
  sound: ReplaySound
  onClose: () => void
  /** The button that opened the panel: excluded from "click outside", and given focus back by
   *  the caller on close. */
  triggerRef?: RefObject<HTMLElement | null>
}

/** The three exits (Escape, click outside, close button) and the focus-on-open, same contract
 *  as the source's `useDrawerDismiss`. `pointerdown` and not `click`: the panel leaves on the
 *  gesture, not the release. */
function useDrawerDismiss(
  panelRef: RefObject<HTMLDivElement | null>,
  triggerRef: RefObject<HTMLElement | null> | undefined,
  onClose: () => void,
): void {
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true })
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (!target) return
      if (panelRef.current?.contains(target)) return
      if (triggerRef?.current?.contains(target)) return
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [panelRef, triggerRef, onClose])
}

/** The texture-quality section: the viewer's choice of which map and variant files the server
 *  serves (Standard the default, High about 4x graphics memory). It is a viewer preference,
 *  not a display layer — switching it re-requests the mesh and variant at the new quality. */
function TextureQualitySection({ locale }: { locale: ReplayLocale }) {
  const t = REPLAY_TEXT[locale]
  const { quality, setQuality } = useTextureQuality()
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-medium text-muted-foreground">{t.textureQualityTitle}</h3>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5" role="radiogroup" aria-label={t.textureQualityTitle}>
        {TEXTURE_QUALITIES.map((q) => (
          <button
            key={q}
            type="button"
            role="radio"
            aria-checked={quality === q}
            data-testid={`texture-quality-${q}`}
            onClick={() => setQuality(q)}
            className={`rounded px-2 py-1 text-left text-xs transition-colors ${
              quality === q
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {q === 'high' ? t.textureQualityHigh : t.textureQualityStandard}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t.textureQualityHighHint}</p>
    </section>
  )
}

export function ReplaySettingsDrawer({ locale, onClose, show, toggle, triggerRef, sound }: ReplaySettingsDrawerProps) {
  const t = REPLAY_TEXT[locale]
  const panelRef = useRef<HTMLDivElement>(null)
  useDrawerDismiss(panelRef, triggerRef, onClose)

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="region"
      data-replay-escape-layer=""
      aria-label={t.settingsButton}
      style={{ width: PANEL_WIDTH }}
      className="flex flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-card px-3 py-3 text-sm text-foreground shadow-xl outline-none"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t.settingsButton}</h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t.settingsClose}
        >
          ×
        </button>
      </div>
      <LayersSection locale={locale} show={show} toggle={toggle} />
      <TeamColorsSection />
      <Look3dSection locale={locale} />
      <Aids3dSection locale={locale} />
      <TextureQualitySection locale={locale} />
      <section className="space-y-1">
        <h3 className="text-xs font-medium text-muted-foreground">{t.soundCategoriesTitle}</h3>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          {SOUND_CATEGORIES.map((category) => <SettingsToggle key={category} label={t.soundCategory[category]} pressed={sound.categories[category]} onToggle={() => sound.toggleCategory(category)} />)}
        </div>
      </section>
    </div>
  )
}
