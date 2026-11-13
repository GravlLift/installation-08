import { WeaponIcon } from '@/components/ui/WeaponIcon'
import { teamTokenCssVar } from '@/features/match-view/teamSeriesColor'
import { displayPlayerName } from '@/lib/players/displayName'
import { REPLAY_TEXT, type ReplayLocale } from '../i18n/i18n'
import type { lireFilAth } from '../model/ath3d_logic'

export function ReplayAthFil3d({ fil, locale, nameOfXuid }: { fil: ReturnType<typeof lireFilAth>; locale: ReplayLocale; nameOfXuid?: (xuid: string) => string | null }) {
  return <div role="list" aria-label={REPLAY_TEXT[locale].killFeedTitle} style={{ position: 'absolute', left: '3%', bottom: '12%', display: 'flex', flexDirection: 'column', gap: '0.2em', fontSize: '0.48em', lineHeight: 1.2 }}>
    {fil.map(({ kill: k, opacite, implique, tueur, victime }, index) => <div role="listitem" key={`${k.replayMs}-${k.xuid}-${k.victimXuid}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: '0.4em', opacity: opacite, fontWeight: implique ? 800 : 500 }}>
      <span style={{ color: teamTokenCssVar(tueur) }}>{displayPlayerName(nameOfXuid?.(k.xuid), k.xuid)}</span>
      {k.weaponImageUrl && <WeaponIcon imageUrl={k.weaponImageUrl} tinted={k.weaponTinted} label={k.weaponLabel || REPLAY_TEXT[locale].killFeedUnknownWeapon} width="2em" height="1em" style={{ color: teamTokenCssVar(tueur) }} />}
      {k.victimGamertag && <span style={{ color: teamTokenCssVar(victime) }}>{displayPlayerName(k.victimGamertag, k.victimXuid)}</span>}
    </div>)}
  </div>
}
