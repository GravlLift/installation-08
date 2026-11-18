// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ReplayKillPopup3d — the elimination popup for the first-person 3D HUD: to the left of
 * the reticle, as in the game. One line per medal from the kill (label in discreet text on
 * the left, icon on the right), then the victim in a translucent box, everything aligned
 * to the right. Opacity comes from the logic (`readKillPopups`): the popup is a pure
 * function of the frame, it replays correctly when scrubbing backward.
 *
 * Sizes are in em: they follow the HUD's own text size (itself in cqh), so the view scales
 * down compact with no separate setting.
 */
import { displayPlayerName } from '@/lib/players/displayName'
import type { KillPopup } from '../model/hud3d_logic'
import { REPLAY_TEXT, type ReplayLocale } from '../i18n/i18n'
import { medalLabel } from './MedalBadges'

export function ReplayKillPopup3d({ popups, locale }: { popups: readonly KillPopup[]; locale: ReplayLocale }) {
  if (popups.length === 0) return null
  const t = REPLAY_TEXT[locale]
  return (
    <div
      aria-hidden="true"
      style={{ position: 'absolute', top: '44.5%', right: '69%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3em' }}
    >
      {popups.map(({ kill, opacity }, i) => (
        <div key={`${kill.replayMs}-${kill.xuid}-${i}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25em', opacity }}>
          {/* The game stacks the most recent medal on top: the feed's order reversed. */}
          {[...kill.medals].reverse().map((m, j) => (
            <span key={`${m.name}-${m.tMs}-${j}`} style={{ display: 'flex', alignItems: 'center', gap: '0.45em', fontSize: '0.38em', fontWeight: 500 }}>
              {medalLabel(m)}
              {m.imageUrl && <img src={m.imageUrl} alt="" style={{ width: '2.2em', height: '2.2em', objectFit: 'contain' }} />}
            </span>
          ))}
          {kill.victimGamertag && (
            <span style={{ fontSize: '0.4em', fontWeight: 600, lineHeight: 1.3, padding: '0.15em 0.5em', background: 'var(--replay-hud-shadow)' }}>
              {t.killPopupVictimFmt(displayPlayerName(kill.victimGamertag, kill.victimXuid))}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
