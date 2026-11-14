/**
 * ReplaySettingsTeamColors — the "Team colors" section of the settings drawer: the friendly
 * and enemy inks, each a native color input with a swatch, and a reset to the defaults.
 *
 * The colors live in `useTeamColors` (persisted, shared by key): the drawer changes them,
 * every reader of the colors (canvas inks, 3D outlines, HUD, export) follows at once.
 * Control styles match the drawer (`SettingsControls.tsx`, `Look3dSection`).
 */
import { useTeamColors } from './useTeamColors'

export function TeamColorsSection() {
  const { ally, enemy, setAlly, setEnemy, reset } = useTeamColors()
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-medium text-muted-foreground">Team colors</h3>
      <div className="grid grid-cols-1 gap-y-0.5">
        <ColorRow label="Friendly" value={ally} onChange={setAlly} />
        <ColorRow label="Enemy" value={enemy} onChange={setEnemy} />
      </div>
      <button
        type="button"
        onClick={reset}
        className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        Reset
      </button>
    </section>
  )
}

/** One color row: label on the left, the hex readout and the native swatch on the right. */
function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  return (
    <label className="flex min-h-7 w-full items-center justify-between gap-2 rounded px-2 py-1 text-xs text-muted-foreground">
      <span className="min-w-0 break-words">{label}</span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="font-mono tabular-nums text-foreground">{value}</span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          aria-label={label}
          className="h-5 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
        />
      </span>
    </label>
  )
}
