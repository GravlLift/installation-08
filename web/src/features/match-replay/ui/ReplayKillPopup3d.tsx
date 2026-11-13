/**
 * ReplayKillPopup3d — la popup d'élimination du HUD 3D en 1re personne : à la gauche du
 * réticule, comme dans le jeu. Une ligne par médaille du kill (libellé en texte discret à
 * gauche, icône à droite), puis la victime dans une boîte translucide, le tout aligné à
 * droite. L'opacité vient de la logique (`lirePopupsAth`) : la popup est une fonction pure
 * de la frame, elle se rejoue au retour en arrière.
 *
 * Les tailles sont en em : elles suivent la taille de texte du HUD (elle-même en cqh), donc
 * la vue compacte sans réglage séparé.
 */
import { displayPlayerName } from '@/lib/players/displayName'
import type { KillPopup } from '../model/ath3d_logic'
import { REPLAY_TEXT, type ReplayLocale } from '../i18n/i18n'
import { libelleMedale } from './MedalBadges'

export function ReplayKillPopup3d({ popups, locale }: { popups: readonly KillPopup[]; locale: ReplayLocale }) {
  if (popups.length === 0) return null
  const t = REPLAY_TEXT[locale]
  return (
    <div
      aria-hidden="true"
      style={{ position: 'absolute', top: '44.5%', right: '69%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3em' }}
    >
      {popups.map(({ kill, opacite }, i) => (
        <div key={`${kill.replayMs}-${kill.xuid}-${i}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25em', opacity: opacite }}>
          {/* Le jeu empile la médaille la plus récente en haut : l'ordre inverse du fil. */}
          {[...kill.medals].reverse().map((m, j) => (
            <span key={`${m.name}-${m.tMs}-${j}`} style={{ display: 'flex', alignItems: 'center', gap: '0.45em', fontSize: '0.38em', fontWeight: 500 }}>
              {libelleMedale(m)}
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
