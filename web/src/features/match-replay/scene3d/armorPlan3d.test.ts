// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import type { SpartanArmorManifest } from '@/lib/replay/spartanArmor'

import { chooseInstance, DEFAULT_CORE, planOutfit, stageOf, variantKey, type ArmorIndex, type ArmorPose } from './armorPlan3d'

const POSE: ArmorPose = { translation: [0, 0, 0], rotation: [0, 0, 0, 1] }
const CHIMERA = '101f4ba9'

function piece(region: string, permutation: string) {
  const key = `${region}-${permutation}`
  return { key, region, permutation, file: `piece-${key}.glb`, triangles: 10 }
}

function index(over: Partial<ArmorIndex> = {}): ArmorIndex {
  return {
    schema: 2,
    skeleton: { bones: ['b_pelvis'], root: 0 },
    pieces: [
      piece('e5f7f02b', '71a1b127'), piece('e5f7f02b', 'aaaaaaaa'), piece('e5f7f02b', CHIMERA),
      piece('62059329', '16a12dd4'), piece('3f91af6a', CHIMERA), piece('3f91af6a', DEFAULT_CORE),
      piece('dcb69b0f', DEFAULT_CORE),
    ],
    attachments: [
      { key: '906738a5', tag: '906738a5', entry: 0, file: 'attachment-906738a5.glb', triangles: 5, marker: '2a9d85f1', offset: POSE },
      { key: 'da13a153', tag: 'da13a153', entry: 0, file: 'attachment-da13a153.glb', triangles: 5, marker: 'fb5b5f83', offset: POSE },
      { key: 'da13a153-1', tag: 'da13a153', entry: 1, file: 'attachment-da13a153-1.glb', triangles: 5, marker: 'nope', offset: POSE },
    ],
    markers: [
      { name: '2a9d85f1', instances: [
        { region: 'e5f7f02b', permutation: 'ffffffff', bone: 'b_head', node: 1, ...POSE },
        { region: 'e5f7f02b', permutation: '71a1b127', bone: 'b_head', node: 1, translation: [1, 2, 3], rotation: [0, 0, 0, 1] },
        { region: '', permutation: '', bone: 'b_head', node: 1, ...POSE },
      ] },
      { name: 'fb5b5f83', instances: [{ region: '', permutation: '', bone: 'b_pelvis', node: 0, ...POSE }] },
    ],
    themes: [
      { name: 'chimera', ocur: 'x', permutation: CHIMERA, read: true, base_regions: [{ region: 'e5f7f02b', permutation: CHIMERA }] },
      { name: 'mark7', ocur: 'y', permutation: DEFAULT_CORE, read: true, base_regions: [{ region: '3f91af6a', permutation: DEFAULT_CORE }, { region: 'dcb69b0f', permutation: DEFAULT_CORE }] },
    ],
    failures: [],
    ...over,
  }
}

function region(region_key: string, permutation_key: string, source: string) {
  return { region: 0, permutation: 0, region_key, permutation_key, source }
}

function manifest(over: Partial<SpartanArmorManifest> = {}): SpartanArmorManifest {
  return {
    core_id: '017-001-fwl-c13d0b38', theme_path: 't', theme_tag_id: 1, variant_id: 0x101f4ba9, is_kit: false,
    config_hash: 'h', body: { body_type: 'Large', left_arm: 'Half', right_arm: 'None', left_leg: 'None', right_leg: 'None' },
    regions: [
      region('62059329', '16a12dd4', 'prosthetic_left_arm'),
      region('e5f7f02b', '71a1b127', 'helmet'),
      region('3f91af6a', CHIMERA, 'theme'),
      region('006f42a8', '1f6b0ea7', 'left_shoulder_pad'),
    ],
    attachments: [{ slot: 'helmet_attachment', path: 'p/helmet', resolved: true, tag_key: '906738a5' }],
    ...over,
  }
}

describe('planOutfit', () => {
  it('reads the manifest final selection, one piece per region, in the game stage order', () => {
    const plan = planOutfit(manifest(), index())
    expect(plan.pieces.map((p) => [p.key, p.source])).toEqual([
      [`3f91af6a-${CHIMERA}`, 'theme'],
      ['e5f7f02b-71a1b127', 'helmet'],
      ['62059329-16a12dd4', 'prosthetic_left_arm'],
    ])
    expect(plan.issues).toEqual([])
  })

  it('a key missing from the index and outside the failures draws nothing: empty region, not a deviation', () => {
    const plan = planOutfit(manifest(), index())
    expect(plan.empty).toEqual(['006f42a8-1f6b0ea7'])
  })

  it('a piece fallback: the player core base, then the default armor, never itself', () => {
    const plan = planOutfit(manifest(), index())
    const helmet = plan.pieces.find((p) => p.source === 'helmet')
    expect(helmet?.fallback).toEqual({ key: `e5f7f02b-${CHIMERA}`, file: `piece-e5f7f02b-${CHIMERA}.glb`, from: 'core' })
    // The core base is the piece itself: the default armor takes the fallback.
    const theme = plan.pieces.find((p) => p.source === 'theme')
    expect(theme?.fallback).toEqual({ key: `3f91af6a-${DEFAULT_CORE}`, file: `piece-3f91af6a-${DEFAULT_CORE}.glb`, from: 'default' })
    // Neither the core nor the default armor names the hand region.
    expect(plan.pieces.find((p) => p.region === '62059329')?.fallback).toBeNull()
  })

  it('a piece whose build failed: its fallback is placed and the deviation named; without a fallback, nothing, named', () => {
    const failures = [{ key: 'e5f7f02b-71a1b127', reason: 'unreadable section' }, { key: '62059329-16a12dd4', reason: 'x' }]
    const plan = planOutfit(manifest(), index({ failures }))
    expect(plan.pieces.map((p) => p.key)).toEqual([`3f91af6a-${CHIMERA}`, `e5f7f02b-${CHIMERA}`])
    expect(plan.issues).toEqual([
      { kind: 'piece_build_failed', what: 'e5f7f02b-71a1b127', detail: 'unreadable section' },
      { kind: 'piece_build_failed', what: '62059329-16a12dd4', detail: 'x' },
      { kind: 'piece_no_fallback', what: '62059329-16a12dd4', detail: 'no fallback piece for the region' },
    ])
  })

  it('an accessory: the marker instance tied to the worn permutation, at its offset', () => {
    const plan = planOutfit(manifest(), index())
    expect(plan.attachments).toEqual([{
      key: '906738a5', file: 'attachment-906738a5.glb', slot: 'helmet_attachment', tag: '906738a5', bone: 'b_head',
      instance: { translation: [1, 2, 3], rotation: [0, 0, 0, 1] }, offset: POSE,
    }])
  })

  it('accessories not placed, each named: unresolved, absent, marker absent; the manifest unresolved objects too', () => {
    const plan = planOutfit(manifest({
      unresolved: ['p/gloves'],
      attachments: [
        { slot: 'wrist_attachment', path: 'p/wrist', resolved: false },
        { slot: 'chest_attachment', path: 'p/chest', resolved: true, tag_key: '00000001' },
        { slot: 'hip_attachment', path: 'p/hip', resolved: true, tag_key: 'da13a153' },
      ],
    }), index({ failures: [{ key: '00000001', reason: 'unreadable model' }] }))
    expect(plan.attachments.map((a) => a.key)).toEqual(['da13a153'])
    expect(plan.issues).toEqual([
      { kind: 'manifest_unresolved', what: 'p/gloves', detail: 'not resolved by the server' },
      { kind: 'attachment_unresolved', what: 'p/wrist', detail: 'wrist_attachment' },
      { kind: 'attachment_absent', what: '00000001', detail: 'unreadable model' },
      { kind: 'marker_absent', what: 'da13a153-1', detail: 'nope' },
    ])
  })
})

describe('chooseInstance', () => {
  const inst = (region: string, permutation: string, bone: string) => ({ region, permutation, bone })
  it('the first tied to a worn region (empty permutation: any permutation), else the first without a region', () => {
    const list = [inst('r1', 'p9', 'a'), inst('', '', 'generic'), inst('r1', '', 'any'), inst('r2', 'p2', 'b')]
    expect(chooseInstance(list, new Map([['r1', 'p1']]))?.bone).toBe('any')
    expect(chooseInstance(list, new Map([['r2', 'p2']]))?.bone).toBe('b')
    expect(chooseInstance(list, new Map([['r3', 'p3']]))?.bone).toBe('generic')
    expect(chooseInstance([inst('r1', 'p9', 'a')], new Map())).toBeNull()
  })
})

describe('keys', () => {
  it('variantKey: the unsigned 32 bits as 8 digits', () => {
    expect(variantKey(-436735957)).toBe('e5f7f02b')
    expect(variantKey(0x101f4ba9)).toBe('101f4ba9')
    expect(variantKey(5)).toBe('00000005')
  })
  it('stageOf: base, pieces, build, prosthetics', () => {
    const order = ['prosthetic_left_leg', 'body_type', 'knee_pads', 'theme', 'helmet'].sort((a, b) => stageOf(a) - stageOf(b))
    expect(order).toEqual(['theme', 'helmet', 'knee_pads', 'body_type', 'prosthetic_left_leg'])
  })
})
