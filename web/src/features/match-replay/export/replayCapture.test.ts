// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * Tests — replayCapture (the file name, the download, the canvas image).
 *
 * WHAT THEY PROTECT. Three promises, and each one breaks silently if not kept: the name
 * carries the MATCH'S MOMENT (a local timestamp means nothing to whoever receives the file),
 * the blob handed to the browser is RELEASED right away (otherwise a video of several
 * megabytes stays held in memory until the tab closes), and a canvas that renders no image
 * triggers NO download at all (an empty file would be worse than nothing).
 *
 * jsdom HAS NO `canvas.toBlob` (nor `URL.createObjectURL` until we put one there): these
 * tests replace them with stand-ins, exactly as `useReplayPlayback.test.tsx` replaces the
 * animation loop. This is not a workaround — there is nothing REAL to measure here, the
 * question being asked is "who gets called, with what".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildCaptureFilename, captureCanvasImage, holdDownload, triggerDownload } from './replayCapture'

/** A FIXED clock for the fallback: the name must not depend on any real-world time. */
const CLOCK = new Date(2026, 7, 26, 14, 3, 9)

describe('buildCaptureFilename — the name says the match’s moment', () => {
  it('nominal: match id and match time', () => {
    expect(buildCaptureFilename('abc-123', 74_000, 'png', CLOCK)).toBe('replay-abc-123-1m14s.png')
  })

  it('seconds always fit on two digits, minutes never do', () => {
    // A captures folder's alphabetical sort then follows the match's order, which a
    // "1m4s" would lie about from the tenth second onward.
    expect(buildCaptureFilename('m', 4_000, 'png', CLOCK)).toBe('replay-m-0m04s.png')
  })

  it('past ten minutes, the match time stays readable', () => {
    expect(buildCaptureFilename('m', 754_000, 'webm', CLOCK)).toBe('replay-m-12m34s.webm')
  })

  it('without a match id: timestamped fallback (decision 8)', () => {
    expect(buildCaptureFilename(null, 74_000, 'mp4', CLOCK)).toBe('replay-20260826-140309.mp4')
    expect(buildCaptureFilename('   ', 74_000, 'mp4', CLOCK)).toBe('replay-20260826-140309.mp4')
  })

  it('without a readable moment: fallback ALSO applies — a name must not invent "0m00s"', () => {
    // "0m00s" would read as "kickoff": that is a claim, not an absence.
    expect(buildCaptureFilename('abc', null, 'png', CLOCK)).toBe('replay-20260826-140309.png')
    expect(buildCaptureFilename('abc', Number.NaN, 'png', CLOCK)).toBe('replay-20260826-140309.png')
  })

  it('an exotic id does not leak into the file name', () => {
    expect(buildCaptureFilename('a/b c:d', 0, 'png', CLOCK)).toBe('replay-a-b-c-d-0m00s.png')
  })
})

describe('triggerDownload — the blob is delivered, then released', () => {
  let created: string[] = []
  let revoked: string[] = []

  beforeEach(() => {
    created = []
    revoked = []
    vi.stubGlobal('URL', {
      createObjectURL: (b: Blob) => {
        created.push(String(b.size))
        return 'blob:replay-test'
      },
      revokeObjectURL: (u: string) => revoked.push(u),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('places a named anchor, attaches it to the document, and triggers it', () => {
    const anchor = document.createElement('a')
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => {
      // THE ANCHOR IS IN THE DOCUMENT AT THE MOMENT OF THE CLICK, which is the whole point of
      // this assertion: a click on a detached node is ignored by some browsers (the download
      // then never starts). Checking it AFTER the fact would say nothing — it's already removed.
      expect(anchor.isConnected).toBe(true)
    })
    const create = vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    triggerDownload(new Blob(['xy']), 'replay-m-0m04s.png')
    expect(create).toHaveBeenCalledWith('a')
    expect(anchor.download).toBe('replay-m-0m04s.png')
    expect(anchor.href).toBe('blob:replay-test')
    expect(click).toHaveBeenCalledTimes(1)
    expect(created).toHaveLength(1)
    // AND IT LEAVES AGAIN: an anchor left behind would pile up on every capture.
    expect(anchor.isConnected).toBe(false)
    create.mockRestore()
  })

  it('does NOT revoke the URL right after the click, but later', () => {
    vi.useFakeTimers()
    const anchor = document.createElement('a')
    vi.spyOn(anchor, 'click').mockImplementation(() => {})
    const create = vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    triggerDownload(new Blob(['xy']), 'replay-m-0m04s.mp4')
    // THE POINT OF THIS TEST (fix from 2026-08-28): revoking right away cuts the source out
    // from under the download that is just starting. A PNG survived it, a video clip never
    // arrived.
    expect(revoked).toEqual([])
    vi.runAllTimers()
    expect(revoked).toEqual(['blob:replay-test'])
    create.mockRestore()
    vi.useRealTimers()
  })
})

describe('holdDownload — the download waits for a click', () => {
  let created: string[] = []
  let revoked: string[] = []

  beforeEach(() => {
    created = []
    revoked = []
    vi.stubGlobal('URL', {
      createObjectURL: (b: Blob) => {
        created.push(String(b.size))
        return 'blob:replay-test'
      },
      revokeObjectURL: (u: string) => revoked.push(u),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates the URL on the call, but DEPOSITS NOTHING before the click', () => {
    holdDownload(new Blob(['mp4']), 'replay-m-0m00s-0m00s.mp4')
    // THE URL IS READY: the clip is assembled, and the "Save" button only waits for a click.
    expect(created).toEqual(['3'])
    // BUT NO ANCHOR HAS BEEN PLACED: the delivery has not happened, and nothing was clicked.
    // This is what distinguishes `holdDownload` from `triggerDownload`: the click comes from
    // the user, not from the code.
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('`save` places the anchor, attaches it, triggers it, and removes it', () => {
    const pending = holdDownload(new Blob(['mp4']), 'replay-m-0m00s-0m00s.mp4')
    const anchor = document.createElement('a')
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => {
      expect(anchor.isConnected).toBe(true)
    })
    const create = vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    pending.save()
    expect(anchor.download).toBe('replay-m-0m00s-0m00s.mp4')
    expect(anchor.href).toBe('blob:replay-test')
    expect(click).toHaveBeenCalledTimes(1)
    expect(anchor.isConnected).toBe(false)
    create.mockRestore()
  })

  it('`save` NEVER revokes the URL, even afterwards: a second click must still be able to read it', () => {
    vi.useFakeTimers()
    const pending = holdDownload(new Blob(['mp4']), 'replay-m-0m00s-0m00s.mp4')
    const anchor = document.createElement('a')
    vi.spyOn(anchor, 'click').mockImplementation(() => {})
    const create = vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    pending.save()
    vi.runAllTimers()
    // No dedicated timer: `holdDownload`'s `save` leaves the URL in place, so that a RETRIED
    // "Save" click (the first one failed) can still read the blob.
    expect(revoked).toEqual([])
    create.mockRestore()
    vi.useRealTimers()
  })

  it('`save` can be retried: a second click places the anchor and clicks again', () => {
    const pending = holdDownload(new Blob(['mp4']), 'replay-m-0m00s-0m00s.mp4')
    const anchor = document.createElement('a')
    const click = vi.spyOn(anchor, 'click')
    const create = vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    pending.save()
    pending.save()
    // TWO clicks: the first download failed (file locked elsewhere), the second goes through
    // — that is the whole point of `save` neither revoking nor shutting down.
    expect(click).toHaveBeenCalledTimes(2)
    expect(revoked).toEqual([])
    create.mockRestore()
  })

  it('`release` revokes the URL WITHOUT placing an anchor: the clip does not come down', () => {
    const pending = holdDownload(new Blob(['mp4']), 'replay-m-0m00s-0m00s.mp4')
    pending.release()
    // THE URL IS REVOKED: the blob is returned to the collector, and nothing can read it anymore.
    expect(revoked).toEqual(['blob:replay-test'])
    // NO ANCHOR: the download never happened.
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('`release` does NOT revoke a second time', () => {
    const pending = holdDownload(new Blob(['mp4']), 'replay-m-0m00s-0m00s.mp4')
    pending.release()
    pending.release()
    expect(revoked).toEqual(['blob:replay-test'])
  })

  it('`triggerDownload` — single-use — revokes the URL after `URL_RELEASE_MS`', () => {
    // Image capture has no "Save" button: it is a DEDICATED TIMER that revokes, otherwise a
    // clip of several megabytes would stay held in memory until the tab closes.
    vi.useFakeTimers()
    const anchor = document.createElement('a')
    vi.spyOn(anchor, 'click').mockImplementation(() => {})
    const create = vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    triggerDownload(new Blob(['mp4']), 'replay-m-0m00s-0m00s.mp4')
    expect(revoked).toEqual([])
    vi.runAllTimers()
    expect(revoked).toEqual(['blob:replay-test'])
    create.mockRestore()
    vi.useRealTimers()
  })
})

describe('captureCanvasImage — the pixels, or nothing', () => {
  it('renders the PNG blob the canvas produces', async () => {
    const blob = new Blob(['png'])
    const canvas = {
      toBlob: (cb: (b: Blob | null) => void, type: string) => {
        expect(type).toBe('image/png')
        cb(blob)
      },
    } as unknown as HTMLCanvasElement
    await expect(captureCanvasImage(canvas)).resolves.toBe(blob)
  })

  it('a canvas that renders nothing gives `null` — never a hanging promise', async () => {
    const canvas = {
      toBlob: (cb: (b: Blob | null) => void) => cb(null),
    } as unknown as HTMLCanvasElement
    await expect(captureCanvasImage(canvas)).resolves.toBeNull()
  })

  it('a browser without `toBlob` gives `null` instead of throwing', async () => {
    // This is jsdom's case, and would be a very old browser's too: the command must not
    // break the page, it must do nothing.
    await expect(captureCanvasImage({} as HTMLCanvasElement)).resolves.toBeNull()
  })
})
