/**
 * ReplayAthLunette3d — LA LUNETTE en 1re personne, au style de la `scope` : le cercle du tireur
 * d'élite (écran masqué hors d'un cercle centré, fin réticule en croix interrompu au centre et
 * point) ou le cadre holographique du tir de choc (vignette douce et petit réticule central,
 * sans masque). Elle remplace le
 * réticule normal quand elle est montée et s'estompe avec la progression du zoom (`amount`, 0..1).
 */
import type { ScopeStyle } from '../model/scopeLogic'

export function ReplayAthLunette3d({ amount, style }: { amount: number; style: ScopeStyle }) {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: amount }}>
      {style === 'holo' ? <LunetteHolo /> : <LunetteCercle />}
    </div>
  )
}

/** Le style « cercle » : le masque noir et la croix du tireur d'élite. */
function LunetteCercle() {
  return (
    <>
      {/* Le masque : l'ombre portée d'un disque vide couvre tout ce qui l'entoure. */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: '92cqh',
          height: '92cqh',
          transform: 'translate(-50%, -50%)',
          borderRadius: '50%',
          boxShadow: '0 0 0 200cqmax var(--replay-scope-mask), inset 0 0 6cqh 1cqh var(--replay-scope-mask)',
        }}
      />
      <svg
        viewBox="0 0 100 100"
        style={{ position: 'absolute', width: '92cqh', height: '92cqh', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
        fill="none"
        stroke="currentColor"
        strokeWidth="0.25"
        opacity="0.85"
      >
        <path d="M50 0V46 M50 54V100 M0 50H46 M54 50H100" />
        <path d="M50 0V14 M50 86V100 M0 50H14 M86 50H100" strokeWidth="0.9" />
        <circle cx="50" cy="50" r="0.45" fill="currentColor" stroke="none" />
      </svg>
    </>
  )
}

/**
 * Le style « holo » : tout l'écran reste visible ; les côtés gauche et droit s'assombrissent
 * fortement vers les bords, le tiers central reste clair, et un petit réticule (anneau + point)
 * marque le centre.
 */
function LunetteHolo() {
  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to right, var(--replay-scope-mask) 0%, transparent 36%, transparent 64%, var(--replay-scope-mask) 100%)',
        }}
      />
      <svg
        viewBox="0 0 10 10"
        style={{ position: 'absolute', width: '2.2cqh', height: '2.2cqh', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
        fill="none"
        stroke="currentColor"
        opacity="0.9"
      >
        <circle cx="5" cy="5" r="4" strokeWidth="0.6" />
        <circle cx="5" cy="5" r="0.8" fill="currentColor" stroke="none" />
      </svg>
    </>
  )
}