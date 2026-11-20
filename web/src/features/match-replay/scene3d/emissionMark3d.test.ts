// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { BASIC_MARK, EMISSION_ALPHA, installEmissionMarks, markAfter, markEmissive, STANDARD_MARK } from './emissionMark3d'

const lib = THREE.ShaderLib as Record<string, { fragmentShader: string }>

describe('installEmissionMarks — the emission mark in three\'s shaders', () => {
  it('marks the standard and physical shaders after their premultiplied-alpha step, where outgoingLight is known', () => {
    installEmissionMarks()
    installEmissionMarks() // once only
    for (const name of ['standard', 'physical']) {
      const s = lib[name].fragmentShader
      expect(s.split(STANDARD_MARK).length).toBe(2)
      const at = s.indexOf(STANDARD_MARK)
      expect(at).toBeGreaterThan(s.indexOf('#include <premultiplied_alpha_fragment>'))
      expect(at).toBeLessThan(s.indexOf('#include <dithering_fragment>'))
      expect(s.indexOf('vec3 outgoingLight')).toBeLessThan(at)
      expect(s.indexOf('totalEmissiveRadiance')).toBeLessThan(at)
    }
    const basic = lib.basic.fragmentShader
    expect(basic.split(BASIC_MARK).length).toBe(2)
    expect(basic.indexOf(BASIC_MARK)).toBeGreaterThan(basic.indexOf('#include <premultiplied_alpha_fragment>'))
  })

  it('writes the mark only for OPAQUE materials (blending off: the alpha changes no color)', () => {
    expect(STANDARD_MARK.trim().startsWith('#ifdef OPAQUE')).toBe(true)
    expect(BASIC_MARK.trim().startsWith('#ifdef OPAQUE')).toBe(true)
    expect(BASIC_MARK).toContain(`gl_FragColor.a = ${EMISSION_ALPHA.toFixed(1)};`)
    // A lit surface with no emission writes exactly 1, however bright its received light.
    expect(STANDARD_MARK).toContain('1.0 + (hmEmit > 0.0 ?')
  })

  it('leaves a shader without the anchor alone', () => {
    expect(markAfter('void main() {}', '// x')).toBeNull()
  })
})

describe('markEmissive', () => {
  it('sets the alpha at the end of main', () => {
    const out = markEmissive('void main() {\n  gl_FragColor = vec4(1.0);\n}\n')
    expect(out).toBe('void main() {\n  gl_FragColor = vec4(1.0);\n\tgl_FragColor.a = 2.0;\n}\n')
  })
})
