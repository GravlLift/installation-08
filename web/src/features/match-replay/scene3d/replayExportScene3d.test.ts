import { expect, it } from 'vitest'
import { ReplayExportScene3d } from './replayExportScene3d'

it('places the camera and first-person rig before updating effects for each exported frame', () => {
  const calls: string[] = []
  const canvas = document.createElement('canvas')
  const scene = {
    hasTracks: true,
    renderer: { domElement: canvas },
    placeAvatars: () => calls.push('avatars'),
    placeCamera: () => calls.push('camera'),
    placeFirstPerson: () => calls.push('arms'),
    action: { update: () => calls.push('effects') },
    lighting: { updateShadows: () => calls.push('shadows') },
    post: { composer: { render: () => calls.push('render') } },
  }
  const exported = new ReplayExportScene3d(scene as never)
  expect(exported.exportFrame(42)).toBe(canvas)
  expect(calls).toEqual(['avatars', 'camera', 'arms', 'effects', 'shadows', 'render'])
})
