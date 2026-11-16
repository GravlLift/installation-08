import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

import { LOOK3D_DEFAULT } from './look3d'
import { buildPostFx } from './postFx3d'
import { placeTag } from './nameTags3d'
import { ReplayExportScene3d, exportStepSeconds } from './replayExportScene3d'
import { ReplayScene3d } from './replayScene3d'

/** A scene double that records the calls of an exported frame. */
function sceneDouble() {
  const calls: string[] = []
  const steps: number[] = []
  const sky: (number | null)[] = []
  const glow: number[] = []
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
    retagTags: () => calls.push('retag'),
    setSkyClock: (s: number | null) => sky.push(s),
    setGlowClock: (s: number) => glow.push(s),
    action: { settle: () => calls.push('settle'), update: () => calls.push('effects') },
    lighting: { updateShadows: () => calls.push('shadows') },
    post: { composer: { render: () => { drawn++; calls.push('render') }, setPixelRatio: () => {}, setSize: () => {} } },
  }
  return { exported: new ReplayExportScene3d(scene as never), calls, steps, sky, glow, canvas, scene }
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

  it('settles the bodies, places the camera and first-person rig, retags, then updates effects', () => {
    const { exported, calls } = sceneDouble()
    exported.exportFrame(42)
    expect(calls).toEqual(['settle', 'avatars', 'camera', 'arms', 'retag', 'effects', 'shadows', 'render', 'screen', 'read'])
  })

  it('exports the tags the SCREEN shows at the frame\'s camera: full at 8 u, faded at 12 u, gone at 15 u, the followed player always', () => {
    // Four players directly in front of a camera that the frame moves to the origin. The export
    // poses the avatars FIRST (tags measured from the previous, far camera) and places the camera
    // SECOND: without the retag the exported set would be the stale one.
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(0, 0, -1000)
    const at = (name: string, xuid: string, z: number) => ({
      name, xuid,
      tag: new CSS2DObject(document.createElement('div')),
      tagOpacity: 0,
      color: '#fff',
      feet: new THREE.Vector3(0, 0, z),
    })
    const players = [at('P8', '8', -8), at('P12', '12', -12), at('P15', '15', -15), at('PF', 'f', -15)]
    const avatars = new Map(players.map((p) => [p.xuid, p]))
    const pose = {
      placeAvatars: () => { for (const p of players) p.tagOpacity = placeTag(p.tag, p.feet, camera.position, false) },
      placeCamera: () => { camera.position.set(0, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld() },
      retagTags: () => { for (const p of players) p.tagOpacity = placeTag(p.tag, p.feet, camera.position, p.xuid === 'f') },
    }
    const exported = new ReplayExportScene3d({
      hasTracks: true,
      renderer: { getSize: (v: THREE.Vector2) => v.set(100, 50) },
      camera,
      avatars,
      povXuid: 'f',
      ...pose,
    } as never)
    // The export's own order: avatars posed (tags measured from the previous camera), then the
    // camera, then the retag, then the tags are read.
    pose.placeAvatars()
    pose.placeCamera()
    pose.retagTags()
    const tags = exported.exportTags()
    expect(tags.map((t) => t.name)).toEqual(['P8', 'P12', 'PF']) // the 15 u player is absent
    expect(tags[0].opacity).toBe(1) // 8 u: full
    expect(tags[1].opacity).toBeGreaterThan(0.4)
    expect(tags[1].opacity).toBeLessThan(0.6) // 12 u: mid-fade
    expect(tags[2].opacity).toBe(1) // followed at 15 u: always
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

  it('poses the animated self-lit surfaces at the frame\'s match time, as the screen does', () => {
    const { exported, glow, sky } = sceneDouble()
    exported.beginExport({ width: 1920, height: 1080, camera: 'tp', pov: null, frame: 100, frameMs: 100 / 3 })
    exported.exportFrame(100)
    exported.exportFrame(100.5)
    exported.exportFrame(100.5)
    const at = (frame: number) => (frame * (100 / 3)) / 1000 // the exporter's own formula, bit for bit
    expect(glow).toEqual([at(100), at(100.5), at(100.5)])
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

  it("renders the video through the viewer's own composer: bloom in the file exactly when the viewer has it", () => {
    // The real compositor on a renderer double; every pass but the bloom is switched off so the
    // composer's own render loop runs without a GL context, and the bloom's draw is recorded.
    const drawnBloom = vi.spyOn(UnrealBloomPass.prototype, 'render').mockImplementation(() => {})
    const renderer = { getPixelRatio: () => 1, getRenderTarget: () => null, setRenderTarget: () => {}, info: { render: { calls: 0, triangles: 0 } } }
    const fx = buildPostFx(renderer as never, new THREE.Scene(), new THREE.PerspectiveCamera())
    try {
      for (const pass of fx.composer.passes) pass.enabled = false
      fx.bloom!.enabled = true
      const { exported, scene } = sceneDouble()
      Object.assign(scene, { post: fx })
      // The viewer's own `setLook` (ambient occlusion off: its pass needs a GL context).
      const look = (bloom: boolean) => ReplayScene3d.prototype.setLook.call({ lighting: { setLook: () => {} }, post: fx } as never, { ...LOOK3D_DEFAULT, ambientOcclusion: false, bloom })
      exported.exportFrame(10)
      expect(drawnBloom).toHaveBeenCalledTimes(1)
      look(false) // the drawer turns bloom off: the viewer's composer loses the pass, the file too
      expect(fx.bloom).toBeNull()
      exported.exportFrame(11)
      expect(drawnBloom).toHaveBeenCalledTimes(1)
      look(true)
      exported.exportFrame(12)
      expect(drawnBloom).toHaveBeenCalledTimes(2)
    } finally {
      fx.dispose()
    }
  })

  it('exportStepSeconds never runs backward', () => {
    expect(exportStepSeconds(10, 9, 33)).toBe(0)
    expect(exportStepSeconds(10, 11, 33)).toBeCloseTo(0.033, 9)
  })
})
