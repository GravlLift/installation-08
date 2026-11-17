// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayRecording.ts — THE VIDEO CONTAINER CHOICE, and nothing else.
 *
 * WHY THIS CHOICE IS NOT TRIVIAL. `MediaRecorder` cannot produce the same file everywhere:
 * Chrome on Windows happily encodes MP4/H.264, Firefox only knows WebM. An MP4 file opens in
 * any player and drops straight into an edit timeline; a WebM often needs a conversion. The
 * order below therefore goes from the most portable to the safest, and the EXTENSION FOLLOWS
 * THE CHOSEN TYPE — a `.mp4` that actually held WebM would open nowhere, and that is exactly
 * what a hardcoded file name would produce.
 *
 * THE QUERY IS A PARAMETER (`isSupported`), not a direct call to
 * `MediaRecorder.isTypeSupported`: this keeps the function a pure decision, testable without
 * a browser — jsdom has no `MediaRecorder` at all.
 */

/** The chosen container and the extension that goes with it. The two always travel together. */
export interface VideoMimeChoice {
  mime: string
  ext: string
}

/**
 * The EXACT order from plan decision 5: MP4/H.264 first (the most portable), plain MP4
 * next, then WebM/VP9 and plain WebM — the fallback every recording browser can do.
 */
const CANDIDATES: readonly VideoMimeChoice[] = [
  { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
]

/**
 * CAPTURE RATE, in frames per second.
 *
 * 30, not 60: the replay plays at the screen's rate, but what it shows — dots sliding across
 * a map — gains nothing from doubling the bit rate, and a match clip would then weigh twice
 * as much for an eye that would see no difference. This is NOT the playback speed: filming a
 * replay played at 2x gives a 30 fps clip where the action moves twice as fast (decision 4).
 */
export const CAPTURE_FPS = 30

/** pickVideoMimeType returns the first supported container, or `null` if none is. */
export function pickVideoMimeType(isSupported: (type: string) => boolean): VideoMimeChoice | null {
  return CANDIDATES.find((c) => isSupported(c.mime)) ?? null
}

/**
 * isVideoTypeSupported queries the current browser.
 *
 * Returns `false` everywhere recording doesn't exist (jsdom, old browsers) rather than
 * throwing: that is what lets `pickVideoMimeType` cleanly conclude "none", and the button not
 * render at all (decision 7).
 */
export function isVideoTypeSupported(type: string): boolean {
  if (typeof MediaRecorder === 'undefined') return false
  if (typeof MediaRecorder.isTypeSupported !== 'function') return false
  return MediaRecorder.isTypeSupported(type)
}

/**
 * canRecordCanvas says whether THIS browser can film a canvas.
 *
 * The three conditions are inseparable: the recorder, canvas stream capture, and a container
 * it accepts. Missing any one of them, no recording is possible — and a missing button is
 * then better than a button that would never produce a file.
 */
export function canRecordCanvas(): boolean {
  if (typeof MediaRecorder === 'undefined') return false
  if (typeof HTMLCanvasElement === 'undefined') return false
  if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') return false
  return pickVideoMimeType(isVideoTypeSupported) !== null
}
