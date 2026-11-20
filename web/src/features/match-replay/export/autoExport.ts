// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * autoExport.ts — THE URL SIDE of "auto export": what a page asks for, read from its hash.
 *
 * Another tool writes camera scripts to the server and needs the rendered clip on disk without
 * a human clicking the export dialog. It opens the match at
 * `#/matches/<id>?autoexport=<scriptName>[&format=1080p|720p][&clean=0|1][&sound=0|1][&out=<name>]`
 * `[&blur=<subframes 1..32>][&shutter=<degrees 1..360>][&ss=1|2]`
 * and the page renders it, uploads it, and reports each step (`useAutoExport.ts`). This module
 * only READS that question: a pure function of the hash string, testable without a page.
 *
 * THE HASH ROUTER HAS ALREADY DONE ITS PART: `parseHash` (`App.tsx`) drops the `?query` part
 * when matching, so `#/matches/<id>?autoexport=...` still lands on the match route. The route
 * part is therefore ignored here on purpose — the request concerns only the match the page is
 * on, and a hash that is not a match's is a page that is not one.
 */
import { DEFAULT_EXPORT_FORMAT_ID, EXPORT_FORMAT_IDS, type ExportFormatId } from './exportFormats'
import { MOTION_BLUR_MAX_SUBFRAMES, SHUTTER_DEFAULT_DEG, type MotionBlur } from './exportShutter'

/** An export's stored name, the server's rule (a camera script's name obeys the same one). */
const EXPORT_NAME_RE = /^[a-z0-9_-]{1,64}$/
/** A whole number written plainly (no sign, no exponent, no fraction). */
const WHOLE_RE = /^\d{1,3}$/
/** An angle written plainly: digits, optionally a decimal fraction (`172.8`). */
const DEGREES_RE = /^\d{1,3}(\.\d{1,6})?$/

/** One auto-export request, defaults filled in. */
export interface AutoExportRequest {
  /** The camera script to render, fetched from the match's stored scripts. */
  name: string
  /** The file's format; `1080p` when the URL does not choose. */
  format: ExportFormatId
  /** CLEAN frame: no HUD, name tags, minimap or panels; on when the URL does not choose. */
  clean: boolean
  /** The clip's sound; on when the URL does not choose. */
  sound: boolean
  /** The name the clip is uploaded under; the script's name when the URL does not choose. */
  out: string
  /**
   * Motion blur: `blur` subframes per file frame (1 = off, the default) over a `shutter` of
   * degrees (180 when the URL does not choose).
   */
  motionBlur: MotionBlur
  /** Supersampling: the 3D frame renders at 1x or 2x the file's size; 1 when the URL does not choose. */
  supersample: 1 | 2
}

/** A request the page refuses AT ONCE, with the stated reason (see `useAutoExport`). */
export interface AutoExportRefusal {
  error: string
}

/**
 * parseAutoExport reads an auto-export request out of a page hash.
 *
 * - `null`: no `autoexport` parameter — no request, the page runs normally.
 * - an `AutoExportRequest`: every parameter present is VALIDATED; an unknown format, a name
 *   outside `[a-z0-9_-]{1,64}`, a `clean`/`sound` that is not `0` or `1`, a `blur` that is not
 *   a whole 1 to 32, a `shutter` outside 1 to 360 degrees, or an `ss` that is not `1` or `2` is
 *   refused with a stated reason, never silently fallen back to a default.
 */
export function parseAutoExport(hash: string): AutoExportRequest | AutoExportRefusal | null {
  const qIndex = hash.indexOf('?')
  if (qIndex === -1) return null
  const params = new URLSearchParams(hash.slice(qIndex + 1))
  const name = params.get('autoexport')
  if (name === null) return null
  if (!EXPORT_NAME_RE.test(name)) {
    return { error: `autoexport '${name}' is not a script name ([a-z0-9_-], 1 to 64 characters)` }
  }
  const format = params.get('format')
  if (format !== null && !EXPORT_FORMAT_IDS.includes(format as ExportFormatId)) {
    return { error: `format '${format}' is not a known export format (${EXPORT_FORMAT_IDS.join(', ')})` }
  }
  const clean = params.get('clean')
  if (clean !== null && clean !== '0' && clean !== '1') return { error: `clean '${clean}' must be 0 or 1` }
  const sound = params.get('sound')
  if (sound !== null && sound !== '0' && sound !== '1') return { error: `sound '${sound}' must be 0 or 1` }
  const out = params.get('out')
  if (out !== null && !EXPORT_NAME_RE.test(out)) {
    return { error: `out '${out}' is not a valid export name ([a-z0-9_-], 1 to 64 characters)` }
  }
  const blur = params.get('blur')
  if (blur !== null && (!WHOLE_RE.test(blur) || Number(blur) < 1 || Number(blur) > MOTION_BLUR_MAX_SUBFRAMES)) {
    return { error: `blur '${blur}' must be a whole number of subframes from 1 to ${MOTION_BLUR_MAX_SUBFRAMES}` }
  }
  const shutter = params.get('shutter')
  if (shutter !== null && (!DEGREES_RE.test(shutter) || Number(shutter) < 1 || Number(shutter) > 360)) {
    return { error: `shutter '${shutter}' must be an angle in degrees from 1 to 360` }
  }
  const ss = params.get('ss')
  if (ss !== null && ss !== '1' && ss !== '2') return { error: `ss '${ss}' must be 1 or 2` }
  return {
    name,
    format: format === null ? DEFAULT_EXPORT_FORMAT_ID : (format as ExportFormatId),
    clean: clean === null ? true : clean === '1',
    sound: sound === null ? true : sound === '1',
    out: out ?? name,
    motionBlur: {
      subframes: blur === null ? 1 : Number(blur),
      shutterDeg: shutter === null ? SHUTTER_DEFAULT_DEG : Number(shutter),
    },
    supersample: ss === '2' ? 2 : 1,
  }
}
