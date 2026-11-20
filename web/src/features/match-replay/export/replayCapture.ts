// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayCapture.ts — WHAT COMES OUT OF THE REPLAY: the file name, the download, and the
 * canvas image.
 *
 * WHY A SEPARATE MODULE, rather than three lines in the component. The three operations below
 * are the only ones in the capture pipeline that depend on NEITHER React NOR the playback
 * state: naming, handing a blob to the browser, and reading the pixels off a canvas. Isolating
 * them makes them testable without mounting a component — and the canvas size limit
 * (`max-lines` eslint, R5) forbids putting any logic there anyway.
 *
 * # THE NAME SAYS THE MATCH'S MOMENT, NOT THE COMPUTER'S CLOCK
 *
 * A replay gets watched by several people, and the file travels: `replay-<match>-12m34s.png`
 * places itself in the match on its own, where a local timestamp means nothing to anyone else.
 * That is why the timestamp is only a FALLBACK — it appears only when the match or its moment
 * is unknown, and it is then better than a name that would LIE about the captured moment
 * ("0m00s" would read as "kickoff").
 *
 * THE FALLBACK CLOCK IS A PARAMETER, never a buried `Date.now()`: a naming function that reads
 * the system clock is not testable, and testability is this module's whole point.
 */

/** The characters a file name keeps; everything else becomes a dash. */
const FILENAME_SAFE = /[^A-Za-z0-9._-]+/g

/**
 * buildCaptureFilename renders the downloaded file's name (plan decision 8).
 *
 * Nominal: `replay-<matchId>-<XmYYs>.<ext>`, where `XmYYs` is the MATCH time of the captured
 * moment (the start of the recording, for a video). With a SECOND bound (a range export):
 * `replay-<matchId>-<start>-<end>.<ext>`. Fallback, when the match cannot be identified OR its
 * moment is unknown: `replay-<YYYYMMDD-HHMMSS>.<ext>`.
 */
export function buildCaptureFilename(
  matchId: string | null,
  matchMs: number | null,
  ext: string,
  now: Date,
  /**
   * THE SECOND BOUND, for a RANGE EXPORT: the name becomes
   * `replay-<match>-4m10s-6m30s.mp4`. Absent for an image capture or a recording, which only
   * have one moment. WITHOUT IT, two exports of different ranges sharing the same end would
   * carry the SAME name and overwrite each other in the downloads folder.
   */
  endMs?: number | null,
): string {
  const id = (matchId ?? '').trim().replace(FILENAME_SAFE, '-')
  if (id === '' || matchMs === null || !Number.isFinite(matchMs)) {
    return `replay-${stampOf(now)}.${ext}`
  }
  const span =
    endMs !== null && endMs !== undefined && Number.isFinite(endMs)
      ? `${matchClock(matchMs)}-${matchClock(endMs)}`
      : matchClock(matchMs)
  return `replay-${id}-${span}.${ext}`
}

/** `XmYYs`: minutes without a leading zero, seconds always on two digits. */
function matchClock(ms: number): string {
  const total = Math.max(Math.floor(ms / 1000), 0)
  const sec = total % 60
  return `${Math.floor(total / 60)}m${sec < 10 ? '0' : ''}${sec}s`
}

/** `YYYYMMDD-HHMMSS` in LOCAL time: the fallback is for the user, not for a machine. */
function stampOf(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
  return `${date}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}

/**
 * DELAY BEFORE RELEASING THE OBJECT URL, in milliseconds.
 *
 * THIS IS NOT A CONVENIENCE, IT IS THE CONDITION FOR THE FILE TO ARRIVE. A click on a
 * `download` anchor does not COPY the blob: it asks the browser to go READ the URL, and that
 * read is asynchronous. Revoking the URL right after the click — what this module did until
 * 2026-08-28 — cuts the source out from under the download that is just starting. A PNG image
 * a few hundred kilobytes in size survived it (it fit within the first instant); a VIDEO CLIP
 * of several dozen megabytes did not — the file never arrived, with no error to say why.
 *
 * ONE SECOND, NOT ZERO: the next tick would be enough to get past the click, but not enough to
 * guarantee the blob read has actually started on a loaded machine. One second is invisible to
 * the user (the file is already being delivered) and generous for the browser. This is NOT a
 * leak: the revocation does happen, it simply waits its turn.
 */
const URL_RELEASE_MS = 1000

/**
 * holdDownload keeps a blob ready to drop into the downloads folder: the object URL is
 * created NOW, the click fires later, by hand.
 *
 * WHY A COMPLETELY DIFFERENT GESTURE FROM `triggerDownload`. A click on a `download` anchor
 * fired by CODE, minutes after the user's last gesture, no longer has a user gesture behind
 * it: Chrome blocks the SECOND unrequested download from a site ("Needs permission to
 * download"). The first one gets through, the second does not — and the second one is the
 * video. The click that triggers the download must therefore come from the user, on a visible
 * button; all the code prepares in advance is the URL.
 *
 * `release` gives up the hold: it revokes the URL and returns the blob to the collector. Call
 * it when the user closes the dialog WITHOUT having saved — a blob nobody can save anymore
 * must be released (see `useReplayExport`, the `done` phase).
 *
 * `save` and `release` play asymmetric roles, on purpose: `save` can be called as many times
 * as wanted, `release` only makes sense once. A first download attempt can FAIL (Chrome
 * cannot overwrite a file another program has open), and the click on "Save" must be
 * RETRYABLE — a `save` that revoked its URL after a second would make that second click do
 * nothing.
 */
export interface PendingDownload {
  /**
   * The held clip itself. Readable while the hold lives (the URL is created on the call and
   * revoked only by `release`), which is what a delivery that is not a click — an upload to
   * the server, the auto-export's — needs: the bytes, not the anchor.
   */
  readonly blob: Blob
  /** Triggers the download. Call from a user's click, as often as needed. */
  save: () => void
  /** Revokes the object URL and returns the blob to the collector. Call once, when closing without saving. */
  release: () => void
}

/**
 * holdDownload prepares a download without triggering it.
 *
 * The object URL is created on the call: it lives in what the return value carries, along
 * with the blob itself (readable until `release`). `save` places the anchor and clicks it,
 * NEVER revoking — the URL must survive every "Save" click (the first can fail, the second
 * must work). It is `release` — and only `release` — that revokes it. As long as the user has
 * not closed, the blob stays readable.
 */
export function holdDownload(blob: Blob, filename: string): PendingDownload {
  const url = URL.createObjectURL(blob)
  let released = false
  return {
    blob,
    save() {
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.rel = 'noopener'
      // Invisible and out of flow: the anchor must not move the page it crosses by a pixel.
      a.style.display = 'none'
      document.body.appendChild(a)
      try {
        a.click()
      } finally {
        // THE ANCHOR LEAVES RIGHT AWAY. THE URL, THOUGH, IS LEFT IN PLACE: a second "Save"
        // click must still be able to read it, and it is `release` that gives it up.
        a.remove()
      }
    },
    release() {
      if (released) return
      released = true
      URL.revokeObjectURL(url)
    },
  }
}

/**
 * triggerDownload hands a blob to the browser under the given name, in a single gesture.
 *
 * Reserve this for paths where the user's click IS the download — image capture, where the
 * gesture and the delivery are the same action. For a file that exists minutes after the
 * click (export), the final click must come from the user: that's `holdDownload`, which
 * prepares the URL and waits for the "Save" button.
 *
 * The anchor is ATTACHED to the document for the duration of the click: a click on a detached
 * node is ignored by some browsers, and the download then never fires.
 *
 * THIS PATH IS SINGLE-USE: `save` no longer revokes, so a DEDICATED TIMER is needed to revoke
 * the URL after `URL_RELEASE_MS` (long enough for the blob to be read), otherwise a clip of
 * several megabytes would stay held in memory until the tab closes.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const pending = holdDownload(blob, filename)
  pending.save()
  setTimeout(pending.release, URL_RELEASE_MS)
}

/**
 * captureCanvasImage renders the canvas's pixels as PNG, at its NATIVE resolution.
 *
 * "Native" means the backing store: the replay canvas is sized in physical px (width ×
 * devicePixelRatio) and the context carries the scaling — `toBlob` therefore produces the
 * image at full density with nothing left to recompute here.
 *
 * `null` IS NOT A FAILURE TO REPORT: a blank canvas, a lost context, or a browser that refuses
 * all render `null`, and the caller then downloads nothing. An empty file would be worse than
 * no file.
 */
export function captureCanvasImage(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null)
      return
    }
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}
