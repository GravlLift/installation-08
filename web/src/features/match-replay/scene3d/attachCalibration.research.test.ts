// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * attachCalibration.research.test.ts — the pose of a grenade stuck to a player, calibrated in the
 * frame of the BONE the film names, with the viewer's own animation of that player.
 *
 * Research instrument, skipped unless IT3D_ATTACH_CASES is set. Its inputs are the cases the Go
 * instrument exports (`replay/projectiles_attaches_research_test.go`, IT3D_ATTACH_EXPORT), the
 * Spartan body GLB (IT3D_SPARTAN_GLB, `data/weapons/spartan.glb`) and the stored matches
 * (IT3D_MATCHES, `data/matches`, read only). For each case the parent is posed the way the scene
 * poses it (`makeAvatar`, `wearSpartan`, `placeBody` with the `Motion3d` mix) at the detonation
 * frame, and the detonation point is expressed in the frame of skeleton bone `node` (the skin's
 * joints are the render model's nodes in tag order). It then fits, per bone axis, the raw pose
 * against that local point, and reports the residuals.
 *
 * USAGE (from web/): IT3D_ATTACH_CASES=... IT3D_SPARTAN_GLB=... IT3D_MATCHES=... npx vitest run
 *   src/features/match-replay/scene3d/attachCalibration.research.test.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { describe, expect, it, vi } from 'vitest'

import type { ReplayDocument } from '@/lib/api/types'
import { normalizeReplayDocument } from '@/lib/replay/replayNormalize'

import type { Action3dInputs } from './action3dInputs'
import type { ActionContext } from './actionScene3d'
import { makeAvatar, placeBody, wearSpartan } from './avatar3d'
import { clipsOf, registerSpartanClips, type GltfAnimationJson, type WeaponClips } from './clips3d'
import { measureSyncPhases } from './clipSample3d'
import { heldWeaponAt } from './heldWeapon3d'
import { Motion3d } from './motion3d'
import { buildTracks3d, toThree } from './tracks3d'

interface Case {
  match: string
  attachFrame: number
  detoFrame: number
  deto: [number, number, number]
  parentSlot: number
  node: number
  pose: [number, number, number]
}

const CASES = process.env.IT3D_ATTACH_CASES
const GLB = process.env.IT3D_SPARTAN_GLB
const MATCHES = process.env.IT3D_MATCHES

interface Row {
  c: Case
  bone: string
  local: THREE.Vector3
  q: [number, number, number]
  frame: number
}

/**
 * withoutTextures: the GLB with its images and texture references dropped. jsdom never fires an
 * image's load, so GLTFLoader would wait forever on them; the bones and clips do not need them.
 */
function withoutTextures(raw: Buffer): ArrayBuffer {
  const jsonLen = raw.readUInt32LE(12)
  const json = JSON.parse(raw.subarray(20, 20 + jsonLen).toString('utf8')) as Record<string, unknown>
  delete json.images
  delete json.textures
  delete json.samplers
  const strip = (o: Record<string, unknown>) => {
    for (const k of Object.keys(o)) if (k.endsWith('Texture')) delete o[k]
  }
  for (const m of (json.materials ?? []) as Record<string, unknown>[]) {
    strip(m)
    if (m.pbrMetallicRoughness) strip(m.pbrMetallicRoughness as Record<string, unknown>)
    delete m.extensions
  }
  let text = JSON.stringify(json)
  while (Buffer.byteLength(text) % 4 !== 0) text += ' '
  const jsonChunk = Buffer.from(text, 'utf8')
  const rest = raw.subarray(20 + jsonLen)
  const head = Buffer.alloc(20)
  head.writeUInt32LE(0x46546c67, 0)
  head.writeUInt32LE(2, 4)
  head.writeUInt32LE(20 + jsonChunk.length + rest.length, 8)
  head.writeUInt32LE(jsonChunk.length, 12)
  head.writeUInt32LE(0x4e4f534a, 16)
  return new Uint8Array(Buffer.concat([head, jsonChunk, rest])).buffer
}

async function loadSpartan(path: string): Promise<THREE.Object3D> {
  URL.createObjectURL = () => 'blob:it3d-research'
  URL.revokeObjectURL = () => {}
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const gltf = await new GLTFLoader().parseAsync(withoutTextures(readFileSync(path)), '')
  const json = gltf.parser.json as { animations?: GltfAnimationJson[]; asset?: { extras?: { weaponClips?: WeaponClips } } }
  const clips = clipsOf(gltf.animations, json.animations ?? [], json.asset?.extras?.weaponClips)
  measureSyncPhases(gltf.scene, clips)
  registerSpartanClips(gltf.scene, clips)
  return gltf.scene
}

function rowsOfMatch(source: THREE.Object3D, dir: string, cases: Case[]): Row[] {
  const raw = JSON.parse(gunzipSync(readFileSync(join(dir, 'replay.json.gz'))).toString('utf8')) as ReplayDocument
  const doc = normalizeReplayDocument(raw)
  const tracks = buildTracks3d(doc)
  const fps = 1000 / (doc.frameIntervalMs || 100)
  const inputs = { framesPerSecond: fps, kills: [], locale: 'en' } as unknown as Action3dInputs
  const ctx = {
    doc, tracks, inputs: () => inputs, spartanModel: () => source, dressOf: () => null,
    slotState: (slot: number, f: number) => tracks.sampleSlot(slot, f),
  } as unknown as ActionContext
  const motion = new Motion3d(ctx, (slot, frame) => heldWeaponAt(doc, slot, frame, 'en'))
  const scene = new THREE.Scene()
  const avatar = makeAvatar(scene, 'parent', new THREE.Color(1, 1, 1))
  wearSpartan(avatar, source)
  const bones = avatar.spartan?.skeletons[0]?.bones ?? []
  const out: Row[] = []
  for (const c of cases) {
    const player = tracks.players.find((p) => {
      const life = tracks.life(p.xuid, c.attachFrame)
      return life?.slot === c.parentSlot
    })
    if (!player || !bones[c.node]) continue
    // The parent often dies of this very detonation: pose him at his last frame alive before it.
    const life = tracks.life(player.xuid, c.attachFrame)
    if (!life) continue
    const frame = Math.min(c.detoFrame, life.t1)
    const s = tracks.sample(player.xuid, frame)
    if (!s) continue
    const [x, , z] = toThree(s.x, s.y, s.z)
    const feet = new THREE.Vector3(x, s.z, z)
    const mix = motion.at(player.xuid, frame, false, avatar.mix)
    placeBody(avatar, feet, { h: s.h, p: s.p, crouch: s.crouch, eyeDrop: s.dropOeil, mix }, false)
    scene.updateMatrixWorld(true)
    const bone = bones[c.node]
    const p = new THREE.Vector3(...toThree(c.deto[0], c.deto[1], c.deto[2]))
    const local = p.clone().applyMatrix4(bone.matrixWorld.clone().invert())
    out.push({ c, bone: bone.name, local, q: [c.pose[0] - 32768, c.pose[1] - 32768, c.pose[2] - 32768], frame })
  }
  return out
}

function fit(q: number[], d: number[]): { k: number; r: number; res: number[] } {
  // Through the origin: a Quant16 over [-R, R] is (q + 0.5) * 2R / 65536 - R, i.e. k * (q - 32768).
  let sqd = 0
  let sqq = 0
  let sdd = 0
  for (let i = 0; i < q.length; i++) {
    sqd += q[i] * d[i]
    sqq += q[i] * q[i]
    sdd += d[i] * d[i]
  }
  const k = sqq > 0 ? sqd / sqq : 0
  return { k, r: sqq > 0 && sdd > 0 ? sqd / Math.sqrt(sqq * sdd) : 0, res: q.map((v, i) => Math.abs(d[i] - k * v)) }
}

const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) / 2)] ?? NaN

describe.skipIf(!CASES || !GLB || !MATCHES)('attach calibration (research)', () => {
  it('fits the pose in the bone frame', async () => {
    const cases = JSON.parse(readFileSync(CASES as string, 'utf8')) as Case[]
    const source = await loadSpartan(GLB as string)
    const byMatch = new Map<string, Case[]>()
    for (const c of cases) byMatch.set(c.match, [...(byMatch.get(c.match) ?? []), c])
    const rows: Row[] = []
    for (const [match, list] of byMatch) rows.push(...rowsOfMatch(source, join(MATCHES as string, match), list))
    const log: string[] = [`${rows.length} cases on a player (of ${cases.length})`]
    for (const r of rows) {
      log.push(`${r.c.match.slice(0, 8)} node=${r.c.node} ${r.bone} f=${r.frame.toFixed(2)}/${r.c.detoFrame.toFixed(2)} ` +
        `local=(${r.local.toArray().map((v) => v.toFixed(3)).join(' ')}) |local|=${r.local.length().toFixed(3)} q=(${r.q.join(' ')})`)
    }
    const axes = ['x', 'y', 'z'] as const
    for (let qa = 0; qa < 3; qa++) {
      const corr = axes.map((ax) => fit(rows.map((r) => r.q[qa]), rows.map((r) => r.local[ax])).r.toFixed(2))
      log.push(`corr pose[${qa}] vs local x/y/z: ${corr.join(' ')}`)
    }
    for (let qa = 0; qa < 3; qa++) {
      for (const ax of axes) {
        const f = fit(rows.map((r) => r.q[qa]), rows.map((r) => r.local[ax]))
        log.push(`fit local.${ax} = k * pose[${qa}] : k=${f.k.toExponential(3)} r=${f.r.toFixed(2)} residual median ${median(f.res).toFixed(3)} max ${Math.max(...f.res).toFixed(3)}`)
      }
    }
    // The GLB's axes are halo(x, z, -y) (asset extras): the bone's frame in Halo's convention is
    // (x, -z, y) of the three local point. One symmetric Quant16 range R for all three axes.
    const halo = rows.map((r) => [r.local.x, -r.local.z, r.local.y])
    let sqd = 0
    let sqq = 0
    for (let i = 0; i < rows.length; i++) for (let a = 0; a < 3; a++) { sqd += rows[i].q[a] * halo[i][a]; sqq += rows[i].q[a] ** 2 }
    const kFree = sqd / sqq
    const err3 = (k: number) => rows.map((r, i) => Math.hypot(...[0, 1, 2].map((a) => halo[i][a] - k * r.q[a])))
    const free = err3(kFree)
    log.push(`joint fit halo-local = k * (q - 32768): k=${kFree.toExponential(3)} (R=${(kFree * 32768).toFixed(2)}) |residual| median ${median(free).toFixed(3)} max ${Math.max(...free).toFixed(3)}`)
    for (const R of [1, 2, 3, 4, 5, 8]) {
      const e = err3((2 * R) / 65536)
      log.push(`  R=${R}: |residual| median ${median(e).toFixed(3)} max ${Math.max(...e).toFixed(3)}`)
    }
    for (const r of rows.map((r, i) => ({ r, e: free[i], h: halo[i] }))) {
      log.push(`  ${r.r.c.match.slice(0, 8)} ${r.r.bone.padEnd(18)} halo-local=(${r.h.map((v) => v.toFixed(3)).join(' ')}) pred=(${r.r.q.map((v) => (kFree * v).toFixed(3)).join(' ')}) |res|=${r.e.toFixed(3)} |local|=${r.r.local.length().toFixed(3)}`)
    }
    log.push(`bone origin as the place: |local| median ${median(rows.map((r) => r.local.length())).toFixed(3)} max ${Math.max(...rows.map((r) => r.local.length())).toFixed(3)}`)
    process.stdout.write(log.join('\n') + '\n')
    expect(rows.length).toBeGreaterThan(0)
  }, 600_000)
})
