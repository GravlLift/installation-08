// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * FirstRunPanel — the home screen's "Getting ready" plate while the server's first-start work
 * runs (`useFirstRunProgress`): a determinate bar (finished steps of five), the current step in
 * plain words, and the reassurance that the viewer works meanwhile. "Ready" briefly when it all
 * finishes; a failed step keeps the plate with its message.
 */
import { Plate } from '../ui/Plate'
import { currentStep, FIRST_RUN_STEPS, isFinished, type FirstRunView } from './useFirstRunProgress'

export function FirstRunPanel({ view }: { view: FirstRunView }) {
  if (view.phase === 'hidden') return null
  const steps = view.steps
  const done = steps.filter(isFinished).length
  const total = FIRST_RUN_STEPS.length
  const failed = steps.filter((s) => s.status === 'failed')
  const step = currentStep(steps)
  const title = view.phase === 'ready' ? 'Ready' : view.phase === 'failed' ? 'Setup incomplete' : 'Getting ready'
  return (
    <div className="bc-firstrun" data-testid="first-run-panel">
      <Plate eyebrow={`Step ${Math.min(done + (step ? 1 : 0), total)} of ${total}`} title={title} as="h2">
        <div
          className="bc-progress"
          role="progressbar"
          aria-label="First-start setup"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <div className="bc-progress-fill" style={{ width: `${(done / total) * 100}%` }} />
        </div>
        {step && (
          <div className="bc-firstrun-step" role="status" data-testid="first-run-step">
            {step.label}
          </div>
        )}
        {failed.map((s) => (
          <div className="bc-firstrun-error" role="alert" key={s.key} data-testid="first-run-error">
            {s.label} failed: {s.error}
          </div>
        ))}
        {view.phase === 'working' && (
          <div className="bc-firstrun-note">
            You can use the viewer meanwhile. Matches look complete once this finishes.
          </div>
        )}
      </Plate>
    </div>
  )
}
