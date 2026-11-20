// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * autoExport.test.ts — WHAT THE URL ASKS: the parsing of `?autoexport=...` (and its optional
 * parameters) out of a page hash.
 *
 * WHAT THEY PROTECT. The contract the driving tool relies on: a URL with no request means no
 * request (the page runs normally); every parameter defaults are filled in; and an invalid
 * value is REFUSED with a stated reason, never silently replaced by a default — a silent
 * fallback would render the wrong clip and call it the right one.
 */
import { describe, expect, it } from 'vitest'

import { parseAutoExport, type AutoExportRequest } from './autoExport'

/** A hash the test knows asks for a valid request: the parser's answer, narrowed to it. */
function request(hash: string): AutoExportRequest {
  const r = parseAutoExport(hash)
  if (r === null || 'error' in r) throw new Error(`expected a request, got ${JSON.stringify(r)}`)
  return r
}

describe('parseAutoExport — the request, defaults filled in', () => {
  it('the name alone: the defaults are 1080p, clean, sound on, and out = the script name', () => {
    expect(parseAutoExport('#/matches/m-1?autoexport=demo-5')).toEqual({
      name: 'demo-5',
      format: '1080p',
      clean: true,
      sound: true,
      out: 'demo-5',
      motionBlur: { subframes: 1, shutterDeg: 180 },
      supersample: 1,
      stills: null,
    })
  })

  it('every parameter present, all of them chosen', () => {
    expect(parseAutoExport('#/matches/m-1?autoexport=demo-5&format=720p&clean=0&sound=0&out=clip_1')).toEqual({
      name: 'demo-5',
      format: '720p',
      clean: false,
      sound: false,
      out: 'clip_1',
      motionBlur: { subframes: 1, shutterDeg: 180 },
      supersample: 1,
      stills: null,
    })
  })

  it('stills: script times in ms, in the order given; a malformed or overlong list is refused', () => {
    expect(request('#/matches/m-1?autoexport=a&stills=3721.5,0,8221').stills).toEqual([3721.5, 0, 8221])
    expect(parseAutoExport('#/matches/m-1?autoexport=a&stills=1,,2')).toEqual({ error: expect.stringContaining('stills') })
    expect(parseAutoExport('#/matches/m-1?autoexport=a&stills=-5')).toEqual({ error: expect.stringContaining('stills') })
    const many = Array.from({ length: 65 }, (_, i) => i).join(',')
    expect(parseAutoExport(`#/matches/m-1?autoexport=a&stills=${many}`)).toEqual({ error: expect.stringContaining('stills') })
  })

  it('each parameter can be chosen on its own', () => {
    expect(request('#/matches/m-1?autoexport=a&format=720p').format).toBe('720p')
    expect(request('#/matches/m-1?autoexport=a&clean=0').clean).toBe(false)
    expect(request('#/matches/m-1?autoexport=a&sound=0').sound).toBe(false)
    expect(request('#/matches/m-1?autoexport=a&out=b-2').out).toBe('b-2')
  })

  it('a hash with no query at all: no request', () => {
    expect(parseAutoExport('#/matches/m-1')).toBeNull()
  })

  it('a query without the `autoexport` parameter: no request', () => {
    expect(parseAutoExport('#/matches/m-1?format=720p')).toBeNull()
  })

  it('the empty hash: no request', () => {
    expect(parseAutoExport('')).toBeNull()
  })
})

describe('parseAutoExport — the route part before `?` is ignored on purpose', () => {
  it('any route, any id: the request is read from the query only', () => {
    for (const hash of [
      '#/matches/any-id?autoexport=demo-5',
      '#/other/page?autoexport=demo-5',
      '?autoexport=demo-5',
      '/matches/m-2?autoexport=demo-5',
    ]) {
      expect(request(hash).name).toBe('demo-5')
    }
  })

  it('a non-match page is not a page that asks for an export on its match', () => {
    // The hook only runs on a match's page; the parser's job is to read the query, and it
    // does so without judging the route.
    expect(request('#/leaderboard?autoexport=demo-5').name).toBe('demo-5')
  })
})

describe('parseAutoExport — an invalid value is refused at once, never a silent default', () => {
  it('an unknown format', () => {
    const r = parseAutoExport('#/matches/m-1?autoexport=demo-5&format=4k')
    expect(r).toEqual({ error: expect.stringContaining('4k') })
  })

  it('a script name outside [a-z0-9_-]{1,64}', () => {
    for (const name of ['Demo', 'demo 5', 'demo/5', 'x'.repeat(65)]) {
      const r = parseAutoExport(`#/matches/m-1?autoexport=${encodeURIComponent(name)}`)
      expect(r).toMatchObject({ error: expect.stringContaining(name === 'x'.repeat(65) ? 'is not a script name' : name) })
    }
  })

  it('a `clean` that is not 0 or 1', () => {
    const r = parseAutoExport('#/matches/m-1?autoexport=demo-5&clean=2')
    expect(r).toEqual({ error: expect.stringContaining('clean') })
  })

  it('a `sound` that is not 0 or 1', () => {
    const r = parseAutoExport('#/matches/m-1?autoexport=demo-5&sound=yes')
    expect(r).toEqual({ error: expect.stringContaining('sound') })
  })

  it('an `out` outside [a-z0-9_-]{1,64}', () => {
    const r = parseAutoExport('#/matches/m-1?autoexport=demo-5&out=My Clip')
    expect(r).toEqual({ error: expect.stringContaining('out') })
  })

  it('a `blur` that is not a whole number of subframes from 1 to 32', () => {
    for (const blur of ['0', '33', '2.5', '-4', 'x', '', '1e1', '+8']) {
      const r = parseAutoExport(`#/matches/m-1?autoexport=demo-5&blur=${encodeURIComponent(blur)}`)
      expect(r).toEqual({ error: expect.stringContaining(`blur '${blur}'`) })
    }
  })

  it('a `shutter` outside 1 to 360 degrees', () => {
    for (const shutter of ['0', '0.5', '361', '-90', 'open', '', '1e2']) {
      const r = parseAutoExport(`#/matches/m-1?autoexport=demo-5&shutter=${encodeURIComponent(shutter)}`)
      expect(r).toEqual({ error: expect.stringContaining(`shutter '${shutter}'`) })
    }
  })

  it('an `ss` that is not 1 or 2', () => {
    for (const ss of ['0', '3', '4', '1.5', 'yes']) {
      const r = parseAutoExport(`#/matches/m-1?autoexport=demo-5&ss=${ss}`)
      expect(r).toEqual({ error: expect.stringContaining(`ss '${ss}'`) })
    }
  })
})

describe('parseAutoExport — film quality: motion blur and supersampling', () => {
  it('off by default: one subframe at a 180 degree shutter, no supersampling', () => {
    const r = request('#/matches/m-1?autoexport=demo-5')
    expect(r.motionBlur).toEqual({ subframes: 1, shutterDeg: 180 })
    expect(r.supersample).toBe(1)
  })

  it('each chosen on its own, at its bounds', () => {
    expect(request('#/matches/m-1?autoexport=a&blur=8').motionBlur).toEqual({ subframes: 8, shutterDeg: 180 })
    expect(request('#/matches/m-1?autoexport=a&blur=32').motionBlur.subframes).toBe(32)
    expect(request('#/matches/m-1?autoexport=a&blur=1').motionBlur.subframes).toBe(1)
    expect(request('#/matches/m-1?autoexport=a&shutter=360').motionBlur).toEqual({ subframes: 1, shutterDeg: 360 })
    expect(request('#/matches/m-1?autoexport=a&shutter=1').motionBlur.shutterDeg).toBe(1)
    expect(request('#/matches/m-1?autoexport=a&shutter=172.8').motionBlur.shutterDeg).toBe(172.8)
    expect(request('#/matches/m-1?autoexport=a&ss=2').supersample).toBe(2)
    expect(request('#/matches/m-1?autoexport=a&ss=1').supersample).toBe(1)
  })

  it('all together, beside the other parameters', () => {
    const r = request('#/matches/m-1?autoexport=demo-5&format=720p&blur=16&shutter=270&ss=2&out=film')
    expect(r).toMatchObject({ format: '720p', out: 'film', motionBlur: { subframes: 16, shutterDeg: 270 }, supersample: 2 })
  })
})
