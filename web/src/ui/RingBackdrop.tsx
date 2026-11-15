/**
 * RingBackdrop — the home screen's backdrop: deep space with a few faint stars and a vignette
 * that keeps the menu side dark so the text stays readable. The ring art will be an image
 * Jordan provides; until then the drawn arc is left out. Static, one SVG; `xMidYMid slice`
 * fills any window without stretching (a phone crops the sides).
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
        <linearGradient id="bc-ring-shade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#04070c" stopOpacity="0.82" />
          <stop offset="0.45" stopColor="#04070c" stopOpacity="0.3" />
          <stop offset="1" stopColor="#04070c" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <rect width="1600" height="900" fill="url(#bc-ring-space)" />
      {field.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#dfefff" opacity={s.o} />
      ))}
      {/* Readability: dark over the menu side and the bottom. */}
      <rect width="1600" height="900" fill="url(#bc-ring-shade)" />
    </svg>
  )
}
