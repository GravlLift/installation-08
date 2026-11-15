/**
 * RingBackdrop — the home screen's backdrop: a ringworld arc sweeping across deep space, drawn
 * in code (original art: gradients and ellipses, no image file). The ring is a huge tilted
 * ellipse whose center sits below the window, so only its upper arc crosses the sky: a darker
 * outer edge, a thin bright band for its inner surface, and a soft blurred atmosphere glow; a
 * few faint stars sit behind it, and a vignette keeps the menu side dark so the text stays
 * readable. Static, one SVG; `xMidYMid slice` fills any window without stretching (a phone
 * crops the sides).
 */
import { useMemo } from 'react'

/** A few faint stars at fixed places (a tiny seeded generator, so every render is the same). */
function stars(count: number): { x: number; y: number; r: number; o: number }[] {
  let seed = 0x2f6b
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  return Array.from({ length: count }, () => ({
    x: next() * 1600,
    y: next() * 620,
    r: 0.6 + next() * 1.1,
    o: 0.25 + next() * 0.45,
  }))
}

export function RingBackdrop() {
  const field = useMemo(() => stars(70), [])
  return (
    <svg className="bc-ring" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="bc-ring-space" cx="62%" cy="30%" r="85%">
          <stop offset="0" stopColor="#10243a" />
          <stop offset="0.55" stopColor="#08121e" />
          <stop offset="1" stopColor="#04070c" />
        </radialGradient>
        <linearGradient id="bc-ring-band" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#6fd3ff" stopOpacity="0" />
          <stop offset="0.3" stopColor="#9fe2ff" stopOpacity="0.55" />
          <stop offset="0.62" stopColor="#e8f7ff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#6fd3ff" stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id="bc-ring-edge" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1a2636" stopOpacity="0" />
          <stop offset="0.4" stopColor="#1f3247" stopOpacity="0.9" />
          <stop offset="1" stopColor="#1a2636" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id="bc-ring-shade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#04070c" stopOpacity="0.82" />
          <stop offset="0.45" stopColor="#04070c" stopOpacity="0.3" />
          <stop offset="1" stopColor="#04070c" stopOpacity="0.15" />
        </linearGradient>
        <filter id="bc-ring-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="22" />
        </filter>
      </defs>
      <rect width="1600" height="900" fill="url(#bc-ring-space)" />
      {field.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#dfefff" opacity={s.o} />
      ))}
      <g transform="rotate(-9 800 1180)">
        {/* Atmosphere: a wide soft glow along the arc. */}
        <ellipse cx="800" cy="1180" rx="1150" ry="860" fill="none" stroke="#6fd3ff" strokeOpacity="0.22" strokeWidth="70" filter="url(#bc-ring-glow)" />
        {/* The ring's outer, darker edge. */}
        <ellipse cx="800" cy="1180" rx="1150" ry="860" fill="none" stroke="url(#bc-ring-edge)" strokeWidth="30" />
        {/* The thin bright inner surface, just inside the edge. */}
        <ellipse cx="800" cy="1180" rx="1128" ry="840" fill="none" stroke="url(#bc-ring-band)" strokeWidth="7" />
      </g>
      {/* Readability: dark over the menu side and the bottom. */}
      <rect width="1600" height="900" fill="url(#bc-ring-shade)" />
    </svg>
  )
}
