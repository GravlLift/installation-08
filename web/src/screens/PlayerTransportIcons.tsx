// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * PlayerTransportIcons — the transport's icon buttons and the inline icons they draw (no icon
 * library: every glyph is a small 16 px SVG in `currentColor`).
 *
 * `IconButton` is icon-only: its `label` is the accessible name, and its `tip` is the hover and
 * keyboard-focus tooltip drawn by `broadcast.css` (`.bc-icon-btn[data-tip]`), above the button.
 * It sets no `title`, so the browser's own tooltip never doubles it.
 */
import type { CSSProperties, ReactNode, RefObject } from 'react'

interface IconButtonProps {
  label: string
  tip: string
  /** Anchors the tooltip to the button's right edge (the buttons at the bar's right end). */
  tipEnd?: boolean
  pressed?: boolean
  disabled?: boolean
  className?: string
  style?: CSSProperties
  buttonRef?: RefObject<HTMLButtonElement | null>
  onClick: () => void
  children: ReactNode
}

export function IconButton({ label, tip, tipEnd, pressed, disabled, className, style, buttonRef, onClick, children }: IconButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`bc-icon-btn${tipEnd ? ' bc-tip-end' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      data-tip={tip}
      style={style}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Glyph({ children, filled }: { children: ReactNode; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function PlayIcon() {
  return <Glyph filled><path d="M4.5 2.5v11l9-5.5z" /></Glyph>
}

export function PauseIcon() {
  return <Glyph filled><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" /></Glyph>
}

export function RestartIcon() {
  return (
    <Glyph>
      <path d="M3 8a5 5 0 1 0 1.5-3.6" />
      <path d="M4.2 1.8v2.8H7" />
    </Glyph>
  )
}

export function PrevEventIcon() {
  return (
    <Glyph>
      <path d="M3.5 3v10" />
      <path d="M12.5 3.2v9.6L5.8 8z" fill="currentColor" />
    </Glyph>
  )
}

export function NextEventIcon() {
  return (
    <Glyph>
      <path d="M12.5 3v10" />
      <path d="M3.5 3.2v9.6L10.2 8z" fill="currentColor" />
    </Glyph>
  )
}

/** A two-team board: a header bar over two columns of rows. */
export function ScoreboardIcon() {
  return (
    <Glyph>
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="0.5" />
      <path d="M1.75 5.5h12.5M8 5.5v8.25M3.75 8.25h2.5M3.75 11h2.5M9.75 8.25h2.5M9.75 11h2.5" />
    </Glyph>
  )
}

/** An eight-tooth gear, built once from its radii. */
const GEAR_PATH = (() => {
  const teeth = 8
  const outer = 7
  const inner = 5.2
  const points: string[] = []
  for (let i = 0; i < teeth; i += 1) {
    const base = (i / teeth) * Math.PI * 2
    const step = (Math.PI * 2) / teeth
    // Each tooth: up the flank, across the top, down the flank, across the root.
    const angles: [number, number][] = [
      [base - step * 0.18, inner],
      [base - step * 0.12, outer],
      [base + step * 0.12, outer],
      [base + step * 0.18, inner],
    ]
    for (const [a, r] of angles) points.push(`${(8 + r * Math.cos(a)).toFixed(2)} ${(8 + r * Math.sin(a)).toFixed(2)}`)
  }
  return `M${points.join('L')}Z`
})()

export function SettingsIcon() {
  return (
    <Glyph>
      <path d={GEAR_PATH} strokeWidth="1.3" />
      <circle cx="8" cy="8" r="2.1" />
    </Glyph>
  )
}

/** A camera on a path: a small camera body (with a lens) in the lower left and the dotted arc of
 *  the path it flies. */
export function CameraScriptIcon() {
  return (
    <Glyph>
      <rect x="1.75" y="7" width="6.5" height="4.5" rx="0.5" />
      <circle cx="5" cy="9.25" r="0.9" />
      <path d="M4.5 3.25a6.5 6.5 0 0 1 8 8.25" strokeDasharray="0.6 1.5" />
    </Glyph>
  )
}

/** Export: an arrow down into a tray (the film is saved as a file). */
export function ExportIcon() {
  return (
    <Glyph>
      <path d="M8 2v8M4.8 7 8 10.2 11.2 7" />
      <path d="M2.5 10.5v3h11v-3" />
    </Glyph>
  )
}

export function FullscreenIcon() {
  return <Glyph><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" /></Glyph>
}

export function ExitFullscreenIcon() {
  return <Glyph><path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5" /></Glyph>
}
