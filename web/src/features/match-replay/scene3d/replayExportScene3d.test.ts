import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { ReplayExportScene3d, exportStepSeconds } from './replayExportScene3d'

/** A scene double that records the calls of an exported frame. */
function sceneDouble() {
  const calls: string[] = []
  const steps: number[] = []
  const sky: (number | null)[] = []
  const canvas = document.createElement('canvas')
  // The drawing buffer: one byte value per render, read back by `readPixels`.
  let drawn = 0
  const gl = {
    drawingBufferWidth: 4, drawingBufferHeight: 2, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
    isContextLost: () => false,
    readPixels: (_x: number, _y: number, _w: number, _h: number, _f: number, _t: number, out: Uint8Array) => { calls.push('read'); out.fill(drawn) },
  }
  const scene = {
    hasTracks: true,
    renderer: {
      domElement: canvas, getSize: (v: THREE.Vector2) => v.set(100, 50), getPixelRatio: () => 1, setPixelRatio: () => {}, setSize: () => {},
      getContext: () => gl,
      setRenderTarget: (target: unknown) => calls.push(target === null ? 'screen' : 'target'),
    },
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
    post: { composer: { render: () => { drawn++; calls.push('render') }, setPixelRatio: () => {}, setSize: () => {} } },
  }
  return { exported: new ReplayExportScene3d(scene as never), calls, steps, sky, canvas, scene }
}

/** jsdom has no ImageData nor 2D context: doubles that keep the first byte put into the canvas. */
class FakeImageData {
  readonly data: Uint8ClampedArray
  constructor(width: number, height: number) { this.data = new Uint8ClampedArray(width * height * 4) }
}
const put: number[] = []

describe('ReplayExportScene3d', () => {
  beforeEach(() => {
    put.length = 0
    vi.stubGlobal('ImageData', FakeImageData)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return { canvas: this, putImageData: (image: FakeImageData) => put.push(image.data[0]) } as never
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('settles the bodies, then places the camera and first-person rig before updating effects', () => {
    const { exported, calls } = sceneDouble()
    exported.exportFrame(42)
    expect(calls).toEqual(['settle', 'avatars', 'camera', 'arms', 'effects', 'shadows', 'render', 'screen', 'read'])
  })

  it('hands out the drawing buffer read right after its render, never the WebGL canvas (frozen export, 2026-11-15)', () => {
    // In a hidden tab the WebGL canvas kept serving its first image to drawImage while the scene
    // moved on: the 11-minute export showed its first frame for the whole clip.
    const { exported, canvas } = sceneDouble()
    exported.beginExport({ width: 1920, height: 1080, camera: 'fp', pov: null, frame: 10, frameMs: 100 / 3 })
    const first = exported.exportFrame(10)
    const second = exported.exportFrame(11)
    expect(first).not.toBe(canvas)
    expect(second).not.toBe(canvas)
    expect(put).toEqual([1, 2]) // each frame carries its own render
    exported.endExport()
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

  it('exports the perspective view even from the top-down view, and gives the screen its view back', () => {
    const { exported, scene } = sceneDouble()
    scene.view = 'top'
    let hidden = 0
    Object.assign(scene, { hideTopDown: () => hidden++ })
    exported.beginExport({ width: 1920, height: 1080, camera: 'fp', pov: null, frame: 10, frameMs: 100 / 3 })
    expect(scene.view).toBe('3d')
    expect(hidden).toBe(1) // the top-down markers leave the frame
    exported.endExport()
    expect(scene.view).toBe('top')
  })

  it('exportStepSeconds never runs backward', () => {
    expect(exportStepSeconds(10, 9, 33)).toBe(0)
    expect(exportStepSeconds(10, 11, 33)).toBeCloseTo(0.033, 9)
  })
})
