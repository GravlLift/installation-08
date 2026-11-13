/**
 * SettingsControls — minimal local UI primitives for the settings drawer (`SettingsToggle`,
 * `InfoMark`): plain React + Tailwind utility classes against this app's own design tokens
 * (`index.css`), no UI library. Ported in spirit from LevelUp's `ReplaySettingsToggle.tsx`
 * (same visual grammar: a labeled switch, a small circled-i hint mark) but written fresh here
 * since the source file imports LevelUp's shadcn `Button`, which this app does not have and
 * is not allowed to add.
 */

/** A small "(i)" mark for a measurement-coverage caveat, in SVG (not a text glyph, which
 *  renders as a blank box on fonts that lack it). Takes no focus and opens nothing; its only
 *  content is its tooltip/aria-label. */
export function InfoMark({ text }: { text: string }) {
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      className="inline-flex shrink-0 items-center text-muted-foreground"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="6" cy="6" r="4.6" />
        <path d="M6 5.4v3" />
        <path d="M6 3.6v.2" />
      </svg>
    </span>
  )
}

/** One on/off setting: label on the left, a real `role="switch"` on the right. Keyboard
 *  accessible (a native `<button>`), `aria-checked` carries the state for screen readers. */
export function SettingsToggle({
  label,
  pressed,
  onToggle,
  hint,
}: {
  label: string
  pressed: boolean
  onToggle: () => void
  hint?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={pressed}
      onClick={onToggle}
      title={hint}
      className="flex min-h-7 w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <span className="min-w-0 break-words">{label}</span>
      <ToggleTrack on={pressed} />
    </button>
  )
}

/** The rail and its thumb — the only drawn part of the switch. Semantic tokens only. */
function ToggleTrack({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-4 w-7 shrink-0 items-center rounded-full border px-[2px] transition-colors ${
        on ? 'border-primary bg-primary' : 'border-border bg-muted'
      }`}
    >
      <span
        className={`h-3 w-3 rounded-full transition-transform duration-150 ${
          on ? 'translate-x-[10px] bg-primary-foreground' : 'translate-x-0 bg-muted-foreground'
        }`}
      />
    </span>
  )
}
