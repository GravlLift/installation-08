/**
 * RingBackdrop — the home screen's backdrop. The image is the game's own ring scene,
 * extracted from the install at first run and served from `/api/backdrop/home` (never
 * shipped); it fills the window with `object-fit: cover`, positioned so the ring on the
 * right stays in view. Behind it is a drawn space field with faint stars, shown while the
 * image is absent and as the fallback if it fails to load. A dark shade over the menu side
 * keeps the text readable.
 */
import { useMemo, useState } from 'react'

const BACKDROP_SRC = '/api/backdrop/home'

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
  // 'loading' until the image has loaded: the drawn field shows in the meantime, and it
  // stays (the fallback) if the image fails to load.
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  return (
    <>
      <svg className="bc-ring" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id="bc-ring-space" cx="62%" cy="30%" r="85%">
            <stop offset="0" stopColor="#10243a" />
            <stop offset="0.55" stopColor="#08121e" />
            <stop offset="1" stopColor="#04070c" />
          </radialGradient>
        </defs>
        <rect width="1600" height="900" fill="url(#bc-ring-space)" />
        {field.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#dfefff" opacity={s.o} />
        ))}
      </svg>
      <img
        className="bc-ring-img"
        src={BACKDROP_SRC}
        alt=""
        aria-hidden="true"
        hidden={state !== 'ok'}
        onLoad={() => setState('ok')}
        onError={() => setState('error')}
      />
      {/* Readability: dark over the menu side, kept above the photo. */}
      <div className="bc-ring-shade" aria-hidden="true" />
    </>
  )
}
