/**
 * ReplaySettingsDrawer — the settings panel for the 3D view, ported in spirit from LevelUp's
 * `ReplaySettingsDrawer.tsx`: an overlay panel (not a modal — the replay keeps playing behind
 * it), dismissed by Escape, a click outside, or the close button, with focus entering the panel
 * on open.
 *
 * SIMPLIFIED FROM THE SOURCE: fixed to the bottom-right corner of the viewport rather than
 * anchored to the button that opened it (`useAnchoredPanel`, which this app does not lift — it
 * only matters for exact pixel alignment, not behavior). Left out entirely (not present in this
 * standalone shell, see `docs/PARITY.md`): the 2D map's aim/zones/trail/heatmap toggles, marker
 * colors, sound category filters, and export — none of those have any effect here yet.
 *
 * Carries `data-replay-escape-layer` (the attribute `useReplayFullscreen` already lifted and
 * reads) so an Escape press closes this drawer first when fullscreen is also active, instead of
 * both at once.
 */
import { useEffect, useRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { REPLAY_TEXT, type ReplayLocale } from '../i18n/i18n'
import { LayersSection, type ReplayLayerControls } from './ReplaySettingsLayers'
import { Aids3dSection } from './ReplaySettingsAids3d'
import { Look3dSection } from './ReplaySettingsLook3d'

const PANEL_WIDTH = 360

interface ReplaySettingsDrawerProps extends ReplayLayerControls {
  locale: ReplayLocale
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

export function ReplaySettingsDrawer({ locale, onClose, show, toggle, triggerRef }: ReplaySettingsDrawerProps) {
  const t = REPLAY_TEXT[locale]
  const panelRef = useRef<HTMLDivElement>(null)
  useDrawerDismiss(panelRef, triggerRef, onClose)

  return createPortal(
    <div
      ref={panelRef}
      tabIndex={-1}
      role="region"
      data-replay-escape-layer=""
      aria-label={t.settingsButton}
      style={{ width: PANEL_WIDTH, maxHeight: 'calc(100vh - 5rem)' }}
      className="fixed bottom-16 right-3 z-50 flex flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-card px-3 py-3 text-sm text-foreground shadow-xl outline-none"
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
      <Look3dSection locale={locale} />
      <Aids3dSection locale={locale} />
    </div>,
    document.body,
  )
}
