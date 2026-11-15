/**
 * CoatingsSetupControl — the match viewer's top-strip control when coatings are off: the
 * notice with a "Set up coatings" button, then the setup's progress, then its outcome (the
 * rebuilds are queued, or the server's failure message with a Retry button). It sits at the
 * right end of the top strip, never over the scene's top-left camera view selector.
 */
import { COATINGS_SETUP_TOOLTIP } from './useCoatingsNotice'
import { COATINGS_SETUP_STAGE_LABELS, useCoatingsSetup } from './useCoatingsSetup'

export interface CoatingsSetupControlProps {
  /** The notice text the control shows before a setup starts ("Coatings off: ..."). */
  notice: string
  /** Polling interval override (tests). */
  pollMs?: number
}

export function CoatingsSetupControl({ notice, pollMs }: CoatingsSetupControlProps) {
  const { phase, start } = useCoatingsSetup(pollMs)

  if (phase.phase === 'running') {
    return (
      <span data-testid="coatings-setup-status" role="status" className="bc-player-notice">
        Setting up coatings: {COATINGS_SETUP_STAGE_LABELS[phase.stage] ?? phase.stage}
      </span>
    )
  }
  if (phase.phase === 'ready') {
    return (
      <span data-testid="coatings-setup-status" role="status" className="bc-player-notice">
        Coatings set up: the coating libraries are rebuilding. Reopen the match when they finish.
      </span>
    )
  }
  const failed = phase.phase === 'failed'
  const text = failed ? `Coatings setup failed: ${phase.error}` : notice
  return (
    <>
      <span
        data-testid={failed ? 'coatings-setup-status' : 'coatings-notice'}
        role={failed ? 'alert' : undefined}
        title={failed ? text : COATINGS_SETUP_TOOLTIP}
        className="bc-player-notice bc-player-notice-long"
      >
        {text}
      </span>
      <button type="button" data-testid="coatings-setup-button" className="bc-player-action" onClick={start}>
        {failed ? 'Retry' : 'Set up coatings'}
      </button>
    </>
  )
}
