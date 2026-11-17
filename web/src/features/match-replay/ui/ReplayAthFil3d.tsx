// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { WeaponIcon } from '@/components/ui/WeaponIcon'
import { teamTokenCssVar } from '@/features/match-view/teamSeriesColor'
import { displayPlayerName } from '@/lib/players/displayName'
import { REPLAY_TEXT, type ReplayLocale } from '../i18n/i18n'
import type { lireFilAth } from '../model/ath3d_logic'
import { MIRROR_STYLE, weaponFullIcon } from '../model/weaponFullIcon'

/** The game's kill feed draws the FULL weapon (the silhouette, not the outline), pointing at
 *  the victim: the atlases point left, so a swapped atlas icon is mirrored. */
/** The followed player's own kills sit on a light wash of his team color, as in the game. */
const MY_KILL_BACKGROUND = `color-mix(in srgb, ${teamTokenCssVar(true)} 30%, transparent)`

function FeedWeaponIcon({ url, tinted, label, color }: { url: string; tinted?: boolean; label: string; color: string }) {
  const full = weaponFullIcon(url)
  return <WeaponIcon imageUrl={full.url} tinted={tinted} label={label} width="2.4em" height="1.2em" style={{ color, ...(full.mirrored ? MIRROR_STYLE : {}) }} />
}

export function ReplayAthFil3d({ fil, locale, nameOfXuid }: { fil: ReturnType<typeof lireFilAth>; locale: ReplayLocale; nameOfXuid?: (xuid: string) => string | null }) {
  return <div role="list" aria-label={REPLAY_TEXT[locale].killFeedTitle} style={{ position: 'absolute', left: '3%', bottom: '22%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.2em', fontSize: '0.48em', lineHeight: 1.2 }}>
    {fil.map(({ kill: k, opacite, implique, mien, tueur, victime }, index) => <div role="listitem" key={`${k.replayMs}-${k.xuid}-${k.victimXuid}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: '0.4em', opacity: opacite, fontWeight: implique ? 800 : 500, padding: '0.1em 0.5em', borderRadius: '0.15em', background: mien ? MY_KILL_BACKGROUND : undefined }}>
      <span style={{ color: teamTokenCssVar(tueur) }}>{displayPlayerName(nameOfXuid?.(k.xuid), k.xuid)}</span>
      {k.weaponImageUrl && <FeedWeaponIcon url={k.weaponImageUrl} tinted={k.weaponTinted} label={k.weaponLabel || REPLAY_TEXT[locale].killFeedUnknownWeapon} color={teamTokenCssVar(tueur)} />}
      {k.victimGamertag && <span style={{ color: teamTokenCssVar(victime) }}>{displayPlayerName(k.victimGamertag, k.victimXuid)}</span>}
    </div>)}
  </div>
}
