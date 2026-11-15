import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ReplayExportScene3d, exportStepSeconds } from './replayExportScene3d'

/** A scene double that records the calls of an exported frame. */
function sceneDouble() {
  const calls: string[] = []
  const steps: number[] = []
  const sky: (number | null)[] = []
  const canvas = document.createElement('canvas')
  const scene = {
    hasTracks: true,
    renderer: { domElement: canvas, getSize: (v: THREE.Vector2) => v.set(100, 50), getPixelRatio: () => 1, setPixelRatio: () => {}, setSize: () => {} },
    camera: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), updateProjectionMatrix: () => {}, aspect: 1 },
    orbit: { target: new THREE.Vector3(), enabled: false },
    labels: { setSize: () => {} },
    mode: 'tp',
    view: 'perspective',
    povXuid: null,
    lastFrame: 0,
    applyPov: () => {},
    applyMode: () => {},
    placeAvatars: () => calls.push('avatars'),
    placeCamera: (_f: number, dt: number) => { calls.push('camera'); steps.push(dt) },
    placeFirstPerson: () => calls.push('arms'),
    setSkyClock: (s: number | null) => sky.push(s),
    action: { settle: () => calls.push('settle'), update: () => calls.push('effects') },
    lighting: { updateShadows: () => calls.push('shadows') },
    post: { composer: { render: () => calls.push('render'), setPixelRatio: () => {}, setSize: () => {} } },
  }
  return { exported: new ReplayExportScene3d(scene as never), calls, steps, sky, canvas }
}

describe('ReplayExportScene3d', () => {
  it('settles the bodies, then places the camera and first-person rig before updating effects', () => {
    const { exported, calls, canvas } = sceneDouble()
    expect(exported.exportFrame(42)).toBe(canvas)
    expect(calls).toEqual(['settle', 'avatars', 'camera', 'arms', 'effects', 'shadows', 'render'])
  })

  it('steps the camera ease and the clouds on MATCH time, never the wall clock', () => {
    const { exported, steps, sky } = sceneDouble()
    // A 33.3 ms film exported at 60 fps: half a frame per step, 1/60 s of match.
    exported.beginExport({ width: 1920, height: 1080, camera: 'tp', pov: null, frame: 100, frameMs: 100 / 3 })
    exported.exportFrame(100)
    exported.exportFrame(100.5)
    exported.exportFrame(101)
    exported.exportFrame(101) // the held last frame
    expect(steps[0]).toBe(0)
    expect(steps[1]).toBeCloseTo(1 / 60, 9)
    expect(steps[2]).toBeCloseTo(1 / 60, 9)
    expect(steps[3]).toBe(0)
    expect(sky[1]).toBeCloseTo((100.5 * 100) / 3 / 1000, 9)
    exported.endExport()
    expect(sky[sky.length - 1]).toBeNull()
  })

  it('exportStepSeconds never runs backward', () => {
    expect(exportStepSeconds(10, 9, 33)).toBe(0)
    expect(exportStepSeconds(10, 11, 33)).toBeCloseTo(0.033, 9)
  })
})
