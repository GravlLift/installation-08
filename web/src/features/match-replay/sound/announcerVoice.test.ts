/**
 * announcerVoice.test.ts — the call keys onto the game's vocalization names, the extracted
 * manifest as a voice, and the load that stays silent when nothing was extracted.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  ANNOUNCER_MANIFEST_URL,
  combineVoices,
  loadAnnouncerManifest,
  manifestVoice,
  parseAnnouncerManifest,
  tableVoice,
  voiceNamesOfCall,
  type AnnouncerManifest,
} from './announcerVoice'

const MANIFEST: AnnouncerManifest = {
  version: 1,
  language: 'en',
  lines: {
    doublekill: { takes: [{ file: 'announcer_doublekill_01.ogg', durationMs: 900 }] },
    overkillmedal: { takes: [{ file: 'announcer_overkillmedal_01.ogg', durationMs: 1_000 }, { file: 'announcer_overkillmedal_02.ogg', durationMs: 1_200 }] },
    ctfstart: { takes: [{ file: 'announcer_ctfstart_01.ogg', durationMs: 1_400 }] },
    flagcaptured: { takes: [{ file: 'announcer_flagcaptured_01.ogg', durationMs: 1_100 }] },
    '1minutes': { takes: [{ file: 'announcer_1minutes_01.ogg', durationMs: 800 }] },
  },
}

describe('voiceNamesOfCall', () => {
  it('a medal by its name, then its name followed by "medal"', () => {
    expect(voiceNamesOfCall('medal.double_kill')).toEqual(['doublekill', 'doublekillmedal'])
    expect(voiceNamesOfCall('medal.killamanjaro')).toEqual(['killimanjaro', 'killimanjaromedal'])
    expect(voiceNamesOfCall('medal.fire_and_forget')).toEqual(['fireandforget', 'fireandforgetmedal'])
  })

  it('a mode by its name, then with "intro" or "start"', () => {
    expect(voiceNamesOfCall('mode.ctf')).toEqual(['ctf', 'ctfintro', 'ctfstart'])
    expect(voiceNamesOfCall('mode.capture_the_flag')).toEqual(['ctf', 'ctfintro', 'ctfstart'])
  })

  it('objective and match calls through their tables; anything else is silent', () => {
    expect(voiceNamesOfCall('objective.flag_returns.theirs')).toEqual(['enemyflagreturned'])
    expect(voiceNamesOfCall('time.60')).toEqual(['1minutes'])
    expect(voiceNamesOfCall('score.lost_lead')).toEqual(['lostlead'])
    expect(voiceNamesOfCall('objective.flag_captures.theirs')).toEqual([])
    expect(voiceNamesOfCall('round_over')).toEqual([])
  })
})

describe('manifestVoice', () => {
  const voice = manifestVoice(MANIFEST)

  it('resolves a call through its names, with every take and its measured duration', () => {
    expect(voice.takes('medal.double_kill', 'en')).toEqual([{ stem: 'announcer_doublekill_01', durationMs: 900 }])
    expect(voice.takes('medal.overkill', 'fr').map((t) => t.stem)).toEqual(['announcer_overkillmedal_01', 'announcer_overkillmedal_02'])
    expect(voice.takes('mode.ctf', 'en')[0].durationMs).toBe(1_400)
    expect(voice.takes('medal.perfect', 'en')).toEqual([])
  })

  it('lists every extracted stem, and gives way to a voice placed before it', () => {
    expect(voice.stems('en')).toHaveLength(6)
    const bundled = tableVoice({ 'medal.double_kill': { en: { stem: 'bundled_dk', durationMs: 700 } } })
    const both = combineVoices(bundled, voice)
    expect(both.takes('medal.double_kill', 'en')[0].stem).toBe('bundled_dk')
    expect(both.takes('medal.double_kill', 'fr')[0].stem).toBe('announcer_doublekill_01')
  })
})

describe('parseAnnouncerManifest and loadAnnouncerManifest', () => {
  it('keeps the well-formed takes and refuses another shape', () => {
    const parsed = parseAnnouncerManifest({
      version: 1,
      language: 'en',
      lines: { a: { takes: [{ file: '../x.ogg', durationMs: 5 }, { file: 'ok_01.ogg', durationMs: 0 }] }, b: { takes: [{ file: 'b_01.ogg', durationMs: 5 }] } },
    })
    expect(parsed?.lines).toEqual({ b: { takes: [{ file: 'b_01.ogg', durationMs: 5 }] } })
    expect(parseAnnouncerManifest({ version: 2, language: 'en', lines: {} })).toBeNull()
    expect(parseAnnouncerManifest('nope')).toBeNull()
  })

  it('reads the route; a 404, a failure or no fetch at all is null, never a throw', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify(MANIFEST), { status: 200 }))
    expect((await loadAnnouncerManifest(ok as unknown as typeof fetch))?.lines.ctfstart).toBeDefined()
    expect(ok).toHaveBeenCalledWith(ANNOUNCER_MANIFEST_URL)
    const missing = vi.fn(async () => new Response('not found', { status: 404 }))
    expect(await loadAnnouncerManifest(missing as unknown as typeof fetch)).toBeNull()
    const down = vi.fn(async () => {
      throw new Error('offline')
    })
    expect(await loadAnnouncerManifest(down as unknown as typeof fetch)).toBeNull()
    expect(await loadAnnouncerManifest(null as unknown as typeof fetch)).toBeNull()
  })
})
