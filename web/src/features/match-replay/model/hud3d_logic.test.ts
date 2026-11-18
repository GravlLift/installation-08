// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** hud3d_logic.test.ts — HUD 3D: ammo, kill feed, score banner, and reticle logic. */
import { describe, expect, it } from 'vitest'
import { KILL_POPUP_SECONDS, allyOnLeft, reticleShape, hudClock, readHud, readKillFeed, readKillPopups, readScoreHud, impactMark, prepareHud } from './hud3d_logic'
import { testReplayDoc } from '../test/testDoc'
import { buildExportPlan } from '../export/replayExportPlan'
import { frameToMs } from '@/lib/replay/replayLogic'

describe('HUD 3D display', () => {
  it('chooses reticle shapes by weapon key and class', () => {
    expect(reticleShape('hinf_ma40_ar')).toBe('circle')
    expect(reticleShape('hinf_br75')).toBe('precision')
    expect(reticleShape('hinf_sidekick')).toBe('pistol')
    expect(reticleShape('hinf_s7_sniper')).toBe('dot')
    expect(reticleShape('hinf_m41_spnkr')).toBe('large')
    expect(reticleShape(undefined)).toBe('default')
  })

  it('computes impact flash from elapsed time, independent of playback direction', () => {
    expect(impactMark(-1, 150)).toBe(0)
    expect(impactMark(0, 150)).toBe(1)
    expect(impactMark(75, 150)).toBe(0.5)
    expect(impactMark(150, 150)).toBe(0)
  })

  it('the HUD clock counts down from the time limit, or shows elapsed time without one', () => {
    expect(hudClock(null, 32_000)).toBe(32_000)
    expect(hudClock(720_000, 32_000)).toBe(688_000)
    expect(hudClock(720_000, 720_000)).toBe(0)
    expect(hudClock(720_000, 800_000)).toBe(0)
    expect(hudClock(720_000, 0)).toBe(720_000)
  })

  it('shows nothing when the player is absent', () => {
    expect(readHud(prepareHud(testReplayDoc(), 'absent', []), 0, 'en')).toBeNull()
  })

  it('tracks slot impacts and inventory readings in both playback directions', () => {
    const doc = testReplayDoc({
      frameIntervalMs: 100,
      tracks: [{ slot: 512, xuid: 'A', team: -1, startFrame: 0, endFrame: 100, points: [{ t: 0, x: 0, y: 0, sh: 1 }, { t: 10, x: 0, y: 0, sh: 0.4 }, { t: 100, x: 0, y: 0 }] }],
      inventory: [{ t: 0, slot: 512, d: 0, am: [{ mag: 13, res: 42 }], g: [2] }],
      loadouts: [{ t: 0, slot: 512, w: ['arme'] }],
      damages: [{ t: 10, slot: 99, by: 512 }, { t: 11, slot: 512, by: 99 }],
    })
    const source = prepareHud(doc, 'A', [])
    expect(readHud(source, 10, 'en')).toMatchObject({ shield: 0.4, hit: 1, ammo: { mag: 13, res: 42 } })
    expect(readHud(source, 12, 'en')?.hit).toBe(0)
    expect(readHud(source, 9, 'en')?.hit).toBe(0)
    expect(readHud(source, 10, 'en')?.hit).toBe(1)
    expect(readHud(source, 101, 'en')).toBeNull()
  })

  it('follows the magazine per-shot on ammoReads and keeps the reserve from the inventory reading', () => {
    const doc = testReplayDoc({
      frameIntervalMs: 100,
      tracks: [{ slot: 512, xuid: 'A', team: -1, startFrame: 0, endFrame: 100, points: [{ t: 0, x: 0, y: 0 }, { t: 100, x: 0, y: 0 }] }],
      inventory: [{ t: 0, slot: 512, d: 0, am: [{ mag: 13, res: 42 }], g: [2] }],
      loadouts: [{ t: 0, slot: 512, w: ['arme'] }],
      ammoReads: [
        { t: 0, ms: 0, slot: 512, w: 0, mag: 13, res: 42, src: 'kf' },
        { t: 2, ms: 250, slot: 512, w: 0, mag: 12, src: 'delta' },
        { t: 2, ms: 260, slot: 512, w: 1, mag: 3, src: 'kf' },
        { t: 5, ms: 500, slot: 512, w: 0, mag: 11, src: 'delta' },
      ],
    })
    const source = prepareHud(doc, 'A', [])
    expect(readHud(source, 2, 'en')?.ammo).toMatchObject({ mag: 13, res: 42 })
    expect(readHud(source, 3, 'en')?.ammo).toMatchObject({ mag: 12, res: 42 })
    expect(readHud(source, 5, 'en')?.ammo).toMatchObject({ mag: 11, res: 42 })
    expect(readHud(source, 3, 'en')?.ammo).toMatchObject({ mag: 12, res: 42 })
  })

  it("follows the weapon whose magazine moves when the inventory keyframe predates the switch", () => {
    const doc = testReplayDoc({
      frameIntervalMs: 100,
      tracks: [{ slot: 512, xuid: 'A', team: -1, startFrame: 0, endFrame: 100, points: [{ t: 0, x: 0, y: 0 }, { t: 100, x: 0, y: 0 }] }],
      inventory: [{ t: 0, slot: 512, d: 0, am: [{ mag: 13, res: 42 }, { mag: 8, res: 20 }], g: [2] }],
      loadouts: [{ t: 0, slot: 512, w: ['arme', 'autre'] }],
      ammoReads: [
        { t: 3, ms: 300, slot: 512, w: 1, mag: 7, src: 'delta' },
        { t: 4, ms: 400, slot: 512, w: 1, mag: 6, src: 'delta' },
      ],
    })
    const source = prepareHud(doc, 'A', [])
    expect(readHud(source, 2, 'en')?.ammo).toMatchObject({ mag: 13, res: 42 })
    expect(readHud(source, 3, 'en')?.ammo).toMatchObject({ mag: 7, res: 20 })
    expect(readHud(source, 4, 'en')?.ammo).toMatchObject({ mag: 6, res: 20 })
  })

  // f5454b2a (Streets): R One Oh 7 respawns at frame 2376 with the 0x6ACDC44D and no read of his
  // ammo until his first shot at 2668 (~10 s); the HUD showed no count. Other lives of the film
  // read the same weapon by keyframe before firing: 15 | 45.
  describe('a fresh spawn before any read of its ammo', () => {
    const spawnDoc = (extra: Parameters<typeof testReplayDoc>[0] = {}) => testReplayDoc({
      frameIntervalMs: 33,
      tracks: [
        { slot: 520, xuid: 'B', team: 0, startFrame: 100, endFrame: 400, points: [{ t: 100, x: 0, y: 0 }, { t: 400, x: 0, y: 0 }] },
        { slot: 530, xuid: 'A', team: 1, startFrame: 2376, endFrame: 2732, points: [{ t: 2376, x: 0, y: 0 }, { t: 2732, x: 0, y: 0 }] },
      ],
      loadouts: [
        { t: 100, slot: 520, w: ['0x6ACDC44D'], src: 'birth', k: [0] },
        { t: 200, slot: 520, w: ['0x6ACDC44D'] },
        { t: 2376, slot: 530, w: ['0x6ACDC44D'], src: 'birth', k: [0] },
      ],
      // Life 520 is read at 200, before its first shot (300): its spawn state.
      inventory: [{ t: 200, slot: 520, d: 0, am: [{ mag: 15, res: 45 }, { res: 0 }], g: [2] }],
      shots: [{ t: 300, slot: 520, x: 0, y: 0, w: '0x6ACDC44D42C9679F' }, { t: 2668, o: 4, slot: 530, x: 0, y: 0, w: '0x6ACDC44D42C9679F' }],
      ammoReads: [
        { t: 200, ms: 6600, slot: 520, w: 0, mag: 15, res: 45, src: 'kf' },
        { t: 300, ms: 9900, slot: 520, w: 0, mag: 14, src: 'delta' },
        { t: 2668, ms: 88048, slot: 530, w: 0, mag: 14, src: 'delta' },
      ],
      ...extra,
    })

    it('shows the spawn ammo the film reads for that weapon from the spawn to the first read', () => {
      const source = prepareHud(spawnDoc(), 'A', [])
      expect(readHud(source, 2376, 'en')?.ammo).toMatchObject({ mag: 15, res: 45 })
      expect(readHud(source, 2500, 'en')?.ammo).toMatchObject({ mag: 15, res: 45 })
      expect(readHud(source, 2669, 'en')?.ammo?.mag).toBe(14)
    })

    it('stops at the first shot of the life, and never seeds a weapon picked up since the spawn', () => {
      const shotDoc = spawnDoc({ ammoReads: [{ t: 200, ms: 6600, slot: 520, w: 0, mag: 15, res: 45, src: 'kf' }] })
      expect(readHud(prepareHud(shotDoc, 'A', []), 2669, 'en')?.ammo?.mag).toBeUndefined()
      const swapDoc = spawnDoc({
        loadouts: [
          { t: 100, slot: 520, w: ['0x6ACDC44D'], src: 'birth', k: [0] },
          { t: 2376, slot: 530, w: ['0x2B1824D5'], src: 'birth', k: [0] },
        ],
      })
      expect(readHud(prepareHud(swapDoc, 'A', []), 2500, 'en')?.ammo?.mag).toBeUndefined()
    })

    it('leaves a field out when the spawn reads of the film disagree on it', () => {
      const doc = spawnDoc({
        tracks: [
          { slot: 520, xuid: 'B', team: 0, startFrame: 100, endFrame: 400, points: [{ t: 100, x: 0, y: 0 }, { t: 400, x: 0, y: 0 }] },
          { slot: 521, xuid: 'C', team: 0, startFrame: 100, endFrame: 400, points: [{ t: 100, x: 0, y: 0 }, { t: 400, x: 0, y: 0 }] },
          { slot: 530, xuid: 'A', team: 1, startFrame: 2376, endFrame: 2732, points: [{ t: 2376, x: 0, y: 0 }, { t: 2732, x: 0, y: 0 }] },
        ],
        loadouts: [
          { t: 100, slot: 520, w: ['0x6ACDC44D'], src: 'birth', k: [0] },
          { t: 100, slot: 521, w: ['0x6ACDC44D'], src: 'birth', k: [0] },
          { t: 2376, slot: 530, w: ['0x6ACDC44D'], src: 'birth', k: [0] },
        ],
        inventory: [
          { t: 200, slot: 520, d: 0, am: [{ mag: 15, res: 45 }], g: [2] },
          { t: 200, slot: 521, d: 0, am: [{ mag: 15, res: 90 }], g: [2] },
        ],
      })
      const ammo = readHud(prepareHud(doc, 'A', []), 2500, 'en')?.ammo
      expect(ammo?.mag).toBe(15)
      expect(ammo?.res).toBeUndefined()
    })
  })

  describe('the spawn ammo per emplacement, across a switch', () => {
    // Life 520 reads both spawn magazines by keyframe (15 | 45 and 12 | 36); life 530 spawns at
    // 2376 with the same two-weapon loadout and is the one read by the HUD.
    const switchDoc = (extra: Parameters<typeof testReplayDoc>[0] = {}) => testReplayDoc({
      frameIntervalMs: 33,
      tracks: [
        { slot: 520, xuid: 'B', team: 0, startFrame: 100, endFrame: 400, points: [{ t: 100, x: 0, y: 0 }, { t: 400, x: 0, y: 0 }] },
        { slot: 530, xuid: 'A', team: 1, startFrame: 2376, endFrame: 2732, points: [{ t: 2376, x: 0, y: 0 }, { t: 2732, x: 0, y: 0 }] },
      ],
      loadouts: [
        { t: 100, slot: 520, w: ['0x6ACDC44D', '0x2B1824D5'], src: 'birth', k: [0, 1] },
        { t: 2376, slot: 530, w: ['0x6ACDC44D', '0x2B1824D5'], src: 'birth', k: [0, 1] },
      ],
      inventory: [{ t: 200, slot: 520, d: 0, am: [{ mag: 15, res: 45 }, { mag: 12, res: 36 }], g: [2] }],
      ...extra,
    })

    it('shows the secondary its spawn ammo after a switch, with no shot fired', () => {
      const doc = switchDoc({ drawnWeapons: [{ t: 2450, slot: 530, d: 1 }] })
      const source = prepareHud(doc, 'A', [])
      expect(readHud(source, 2400, 'en')?.ammo).toMatchObject({ mag: 15, res: 45 })
      expect(readHud(source, 2500, 'en')?.ammo).toMatchObject({ mag: 12, res: 36 })
    })

    it('keeps the secondary at its spawn ammo after the primary fires, and the primary follows its own read', () => {
      const doc = switchDoc({
        shots: [{ t: 2420, slot: 530, x: 0, y: 0, w: '0x6ACDC44D42C9679F' }],
        ammoReads: [{ t: 2420, ms: 79860, slot: 530, w: 0, mag: 14, res: 44, src: 'delta' }],
        drawnWeapons: [{ t: 2450, slot: 530, d: 1 }],
      })
      const source = prepareHud(doc, 'A', [])
      expect(readHud(source, 2420, 'en')?.ammo?.mag).toBe(14)
      expect(readHud(source, 2500, 'en')?.ammo).toMatchObject({ mag: 12, res: 36 })
    })

    it('shows no spawn ammo for a weapon picked up since the spawn', () => {
      const doc = switchDoc({
        pickups: [{ t: 2440, slot: 530, class: 1, kind: 'weapon', w: '0xAAAA1111' }],
        weaponChanges: [{ t: 2440, slot: 530, kind: 'taken', k: 1, w: '0xAAAA1111' }],
        drawnWeapons: [{ t: 2450, slot: 530, d: 1 }],
      })
      const source = prepareHud(doc, 'A', [])
      const hud = readHud(source, 2500, 'en')
      expect(hud?.weaponId).toBe('0xAAAA1111')
      expect(hud?.ammo?.mag).toBeUndefined()
    })
  })
})

describe('HUD 3D score banner: team order', () => {
  const docTwoTeams = (me: number) =>
    testReplayDoc({
      scoreTimeline: {
        teams: [
          { teamId: 0, rounds: [{ round: 0, points: [{ t: 0, v: 0 }, { t: 100, v: 43 }] }], total: [{ t: 0, v: 0 }, { t: 100, v: 43 }] },
          { teamId: 1, rounds: [{ round: 0, points: [{ t: 0, v: 0 }, { t: 100, v: 30 }] }], total: [{ t: 0, v: 0 }, { t: 100, v: 30 }] },
        ],
        players: [],
      },
      roster: [
        { filmIndex: 0, xuid: 'a1', name: 'Alpha', team: me },
        { filmIndex: 1, xuid: 'b1', name: 'Bravo', team: 1 - me },
      ],
    })

  it('puts the ally on the left when the followed player is team 0', () => {
    const reading = readScoreHud(prepareHud(docTwoTeams(0), 'a1', []), 150)
    expect(reading?.allyOnLeft).toBe(true)
    expect(reading?.ally.teamId).toBe(0)
    expect(reading?.enemy.teamId).toBe(1)
  })

  it('puts the enemy on the left when the followed player is team 1', () => {
    const reading = readScoreHud(prepareHud(docTwoTeams(1), 'a1', []), 150)
    expect(reading?.allyOnLeft).toBe(false)
    expect(reading?.ally.teamId).toBe(1)
    expect(reading?.enemy.teamId).toBe(0)
  })

  it('keeps the ally on the left when team ids are unknown or equal', () => {
    expect(allyOnLeft(null, 1)).toBe(true)
    expect(allyOnLeft(0, null)).toBe(true)
    expect(allyOnLeft(3, 3)).toBe(true)
  })
})

describe('HUD 3D kill popup', () => {
  const doc = () => testReplayDoc({ frameIntervalMs: 1000 })

  const kill = (replayMs: number, xuid = 'A', medals: { name: string }[] = []) => ({
    replayMs,
    tMs: replayMs,
    xuid,
    victimXuid: 'B',
    victimGamertag: 'Bravo',
    teamID: 0,
    weaponKey: '',
    weaponLabel: '',
    weaponImageUrl: '',
    weaponTinted: false,
    assistState: '' as const,
    assistGamertag: '',
    assistTeamID: null,
    killerDamagePct: null,
    assistDamagePct: null,
    medals: medals.map((m) => ({ tMs: replayMs, xuid, gamertag: xuid, name: m.name, label: m.name, description: '', imageUrl: '' })),
  })

  it('shows the followed player\'s kill at its frame and drops it after the window', () => {
    const source = prepareHud(doc(), 'A', [kill(1000)])
    expect(readKillPopups(source, 1).map((p) => p.kill.replayMs)).toEqual([1000])
    expect(readKillPopups(source, 0)).toEqual([])
    expect(readKillPopups(source, 1 + KILL_POPUP_SECONDS)).toEqual([])
  })

  it('holds opacity at 1 until the last second, then fades linearly', () => {
    const source = prepareHud(doc(), 'A', [kill(1000)])
    expect(readKillPopups(source, 3)[0].opacity).toBe(1)
    expect(readKillPopups(source, 4.5)[0].opacity).toBe(0.5)
  })

  it('never imports a kill from another player', () => {
    const source = prepareHud(doc(), 'A', [kill(1000, 'C')])
    expect(readKillPopups(source, 2)).toEqual([])
  })

  it('never imports a kill before its time', () => {
    const source = prepareHud(doc(), 'A', [kill(5000)])
    expect(readKillPopups(source, 4)).toEqual([])
  })

  it('shows two recent kills, newest first, and drops a third older one', () => {
    const source = prepareHud(doc(), 'A', [kill(1000), kill(2000), kill(3000)])
    expect(readKillPopups(source, 3).map((p) => p.kill.replayMs)).toEqual([3000, 2000])
  })

  it('carries the kill\'s medals in feed order', () => {
    const source = prepareHud(doc(), 'A', [kill(1000, 'A', [{ name: 'Double Kill' }, { name: 'Perfect' }])])
    expect(readKillPopups(source, 2)[0].kill.medals.map((m) => m.name)).toEqual(['Double Kill', 'Perfect'])
  })
})

describe('HUD 3D kill feed', () => {
  const doc = () => testReplayDoc({ frameIntervalMs: 1000 })

  const kill = (replayMs: number) => ({
    replayMs,
    tMs: replayMs,
    xuid: 'A',
    victimXuid: 'B',
    victimGamertag: 'B',
    teamID: 0,
    weaponKey: '',
    weaponLabel: '',
    weaponImageUrl: '',
    weaponTinted: false,
    assistState: '' as const,
    assistGamertag: '',
    assistTeamID: null,
    killerDamagePct: null,
    assistDamagePct: null,
    medals: [],
  })

  it('bounds the feed to four entries, fades the last second, and reads backwards', () => {
    const source = prepareHud(doc(), 'A', [kill(4000), kill(0), kill(1000), kill(2000), kill(3000)])
    expect(readKillFeed(source, 4).map((e) => e.kill.replayMs)).toEqual([1000, 2000, 3000, 4000])
    expect(readKillFeed(source, 6.5)[0]).toMatchObject({ opacity: 0.5, involved: true })
    expect(readKillFeed(source, 6).map((e) => e.kill.replayMs)).toEqual([1000, 2000, 3000, 4000])
    expect(readKillFeed(source, 0).map((e) => e.kill.replayMs)).toEqual([0])
  })
})

describe('HUD 3D score banner: enemy bar first when followed player is team 1', () => {
  it('places the enemy bar before the ally bar for a team-1 viewer', () => {
    const doc = testReplayDoc({
      tracks: [{ slot: 512, xuid: 'A', team: -1, startFrame: 0, endFrame: 10, points: [{ t: 0, x: 0, y: 0 }] }],
      scoreTimeline: {
        teams: [
          { teamId: 0, total: [{ t: 0, v: 0 }, { t: 50, v: 7 }] },
          { teamId: 1, total: [{ t: 0, v: 0 }, { t: 50, v: 3 }] },
        ],
        players: [],
      },
      roster: [
        { filmIndex: 0, xuid: 'A', name: 'Alpha', team: 1 },
        { filmIndex: 1, xuid: 'B', name: 'Bravo', team: 0 },
      ],
    })
    const source = prepareHud(doc, 'A', [])
    const reading = readScoreHud(source, 5)
    expect(reading?.allyOnLeft).toBe(false)
    expect(reading?.ally.teamId).toBe(1)
    expect(reading?.enemy.teamId).toBe(0)
  })
})

describe('HUD 3D at the 60 fps export steps (half film frames)', () => {
  // A ~30 Hz film, as Halo's (33.3 ms per frame): the 60 fps export samples it at half frames.
  const doc = () => testReplayDoc({ frameIntervalMs: 100 / 3, frameCount: 400 })
  const kill = (replayMs: number, xuid: string, victimXuid: string) => ({
    replayMs, tMs: replayMs, xuid, victimXuid, victimGamertag: victimXuid, teamID: 0,
    weaponKey: '', weaponLabel: '', weaponImageUrl: '', weaponTinted: false,
    assistState: '' as const, assistGamertag: '', assistTeamID: null, killerDamagePct: null, assistDamagePct: null, medals: [],
  })
  // Two kills 10 ms apart (closer than one 16.7 ms step), one on a half frame, one past the clip.
  const kills = [kill(1000, 'A', 'B'), kill(1010, 'C', 'D'), kill(2016.6, 'A', 'E'), kill(20_000, 'A', 'F')]
  const plan = buildExportPlan({ startFrame: 0, endFrame: 300 }, doc(), 60)
  const sampleMs = (i: number) => frameToMs(plan.frames[i], doc())

  it('each kill enters the feed exactly once, at the first sample at or after it, and stays contiguous', () => {
    const source = prepareHud(doc(), 'A', kills)
    const seen = new Map<number, number[]>()
    plan.frames.forEach((frame, i) => {
      const feed = readKillFeed(source, frame).map((e) => e.kill.replayMs)
      // No kill twice in one frame's feed.
      expect(new Set(feed).size).toBe(feed.length)
      for (const ms of feed) seen.set(ms, [...(seen.get(ms) ?? []), i])
    })
    for (const k of kills.slice(0, 3)) {
      const at = seen.get(k.replayMs) ?? []
      const first = plan.frames.findIndex((_, i) => sampleMs(i) >= k.replayMs - 1e-6)
      expect(at[0]).toBe(first)
      // One run of consecutive samples: never shown, hidden, then shown again.
      expect(at).toEqual(at.map((_, j) => first + j))
    }
    // The kill past the clip's end is never shown.
    expect(seen.has(20_000)).toBe(false)
  })

  it('the followed player\'s kill popups follow the same rule', () => {
    const source = prepareHud(doc(), 'A', kills)
    const runs = new Map<number, number[]>()
    plan.frames.forEach((frame, i) => {
      for (const p of readKillPopups(source, frame)) runs.set(p.kill.replayMs, [...(runs.get(p.kill.replayMs) ?? []), i])
    })
    for (const ms of [1000, 2016.6]) {
      const at = runs.get(ms) ?? []
      expect(at.length).toBeGreaterThan(0)
      expect(at).toEqual(at.map((_, j) => at[0] + j))
    }
    // Not the followed player's kill: no popup.
    expect(runs.has(1010)).toBe(false)
  })

  it('a reading depends on the frame alone: the same sample read twice, in any order, is identical', () => {
    const source = prepareHud(doc(), 'A', kills)
    const forward = plan.frames.map((f) => readKillFeed(source, f).map((e) => e.kill.replayMs))
    const backward = [...plan.frames].reverse().map((f) => readKillFeed(source, f).map((e) => e.kill.replayMs)).reverse()
    expect(backward).toEqual(forward)
  })
})
