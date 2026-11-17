// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * WeaponIcon — title-agnostic rendering of a weapon icon.
 *
 * Two modes, selected ONLY by the `tinted` field the backend publishes
 * (`image_tinted`) — never by the title, never by the URL's shape:
 *
 *  - MASK (`tinted`): the icon is a shape carried by its alpha channel, with no color
 *    of its own (icons extracted from Halo Infinite are 100% white). It is
 *    rendered as a `mask-image` over a flat color: it then takes on whatever
 *    color it is given, so it stays legible in both light and dark theme,
 *    and can carry a team color without producing one asset per color.
 *  - IMAGE (default): a finished, colored visual (official Halo 5 icons, Infinite's two
 *    hand-drawn PNGs) -> a plain `<img>`. Tinting it would
 *    flatten it into a silhouette.
 *
 * The tint is either the inherited text color (`currentColor` — the theme decides),
 * or a semantic TOKEN via `tokenCssVar`. Never a hex value, never a Tailwind
 * color class. Since `--ac-team-ally` / `--ac-team-enemy` are overridden by
 * the in-game team color choice, an icon tinted with these tokens follows the
 * player's TRUE color, without producing one asset per color.
 */
import type { CSSProperties } from 'react'
import type { SemanticToken } from '@/lib/accessibility/semantic-tokens'
import { tokenCssVar } from '@/lib/accessibility'

interface WeaponIconProps {
  /** URL served by the backend. Empty/absent -> the component renders nothing. */
  imageUrl?: string | null
  /** The icon is a mask to be tinted (backend's `image_tinted` field). */
  tinted?: boolean
  /** Alternative text (the weapon's name). */
  label: string
  /**
   * Tint token, ignored outside mask mode. Absent -> `currentColor`: the icon
   * takes on the inherited text color, so it follows the theme with no code. Pass a
   * token (`team-ally`/`team-enemy`…) when the tint carries a MEANING.
   */
  token?: SemanticToken
  /** Slot width: a number = px, a string = CSS value as-is ('100%'…). */
  width?: number | string
  /** Slot height: same convention. */
  height?: number | string
  className?: string
  style?: CSSProperties
  /** Called if the image fails to load (image mode only — a mask has no onError). */
  onError?: () => void
}

export function WeaponIcon({
  imageUrl,
  tinted = false,
  label,
  token,
  width = 56,
  height = 24,
  className,
  style,
  onError,
}: WeaponIconProps) {
  if (!imageUrl) return null

  const cssSize = (v: number | string) => (typeof v === 'number' ? `${v}px` : v)
  const box: CSSProperties = { width: cssSize(width), height: cssSize(height), ...style }

  if (tinted) {
    const mask = `url(${imageUrl})`
    return (
      <span
        role="img"
        aria-label={label}
        className={className}
        style={{
          ...box,
          display: 'inline-block',
          backgroundColor: token ? tokenCssVar(token) : 'currentColor',
          maskImage: mask,
          WebkitMaskImage: mask,
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskPosition: 'center',
          WebkitMaskPosition: 'center',
        }}
      />
    )
  }

  return (
    <img
      src={imageUrl}
      alt={label}
      className={className}
      style={{ ...box, objectFit: 'contain' }}
      loading="lazy"
      decoding="async"
      onError={onError}
    />
  )
}
