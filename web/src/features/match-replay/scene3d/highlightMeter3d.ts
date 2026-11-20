// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * highlightMeter3d.ts — THE HIGHLIGHT CEILING ON THE GPU (the rule: `highlightCeiling3d.ts`).
 *
 * Two small passes per drawn frame, on the scene's linear HDR image as the output pass receives
 * it (after bloom and depth of field), nothing read back to the CPU:
 *  1. Cells: the frame reduced to `CELLS_X` x `CELLS_Y` cells (64 x 36). Each cell is the mean
 *     luminance of 16 bilinear taps (4 x 4, 64 pixels at 1080p) and the share of those taps
 *     that do NOT glow (brightest channel above `BLOOM_THRESHOLD`: lamps, signs, energy, which are
 *     meant to bloom, not to be metered).
 *  2. Ceiling: one fragment reads the 2304 cells, takes the 97th percentile of the metered cells'
 *     luminance from a 48-bin log histogram (interpolated inside its bin, so it moves smoothly as
 *     the frame changes), looks the ceiling up in the chain's table, and eases it from the previous
 *     state (`MeterClock`). It writes the ceiling in stops (R), its gain exp2(stops) (G) and the
 *     metered level log2(P) (B) to a 1 x 1 float target, one of two the clock alternates.
 * The output pass multiplies the HDR color by that gain before tone mapping (`postFx3d`).
 */
import * as THREE from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'

import { BLOOM_THRESHOLD } from './bloom3d'
import { ceilingTable, MeterClock, METER_PERCENTILE, TABLE_LOG_MIN, TABLE_SIZE, TABLE_STEP, type ToneChain } from './highlightCeiling3d'

/** The metering grid (16:9). */
export const CELLS_X = 64
export const CELLS_Y = 36
/** Histogram range and bin size (log2 luminance). */
const HIST_LOG_MIN = TABLE_LOG_MIN
const HIST_BINS = 48
const HIST_STEP = 0.25
/** At least this share of cells must be metered (not glowing) for a ceiling; fewer, it stays 0. */
const MIN_METERED_SHARE = 0.05

const f = (v: number) => v.toFixed(4)

const VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'

const CELLS_FRAGMENT = /* glsl */ `
uniform sampler2D tHdr;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
void main() {
  vec2 cell = vec2(1.0 / ${CELLS_X}.0, 1.0 / ${CELLS_Y}.0);
  vec2 origin = floor(gl_FragCoord.xy) * cell;
  float sum = 0.0;
  float n = 0.0;
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec3 c = texture2D(tHdr, origin + (vec2(float(i), float(j)) + 0.5) * 0.25 * cell).rgb;
      if (any(isnan(c)) || any(isinf(c))) continue;
      c = max(c, vec3(0.0));
      if (max(c.r, max(c.g, c.b)) > ${f(BLOOM_THRESHOLD)}) continue;
      sum += dot(c, LUMA);
      n += 1.0;
    }
  }
  gl_FragColor = vec4(n > 0.0 ? sum / n : 0.0, n / 16.0, 0.0, 1.0);
}
`

const CEILING_FRAGMENT = /* glsl */ `
uniform sampler2D tCells;
uniform sampler2D tPrev;
uniform float uHasPrev;
uniform float uAlpha;
uniform float uTable[${TABLE_SIZE}];
void main() {
  float hist[${HIST_BINS}];
  for (int b = 0; b < ${HIST_BINS}; b++) hist[b] = 0.0;
  float total = 0.0;
  for (int y = 0; y < ${CELLS_Y}; y++) {
    for (int x = 0; x < ${CELLS_X}; x++) {
      vec2 v = texelFetch(tCells, ivec2(x, y), 0).rg;
      if (v.g < 0.5) continue;
      float l = log2(max(v.r, 1e-6));
      int b = int(clamp(floor((l - ${f(HIST_LOG_MIN)}) / ${f(HIST_STEP)}), 0.0, ${f(HIST_BINS - 1)}));
      hist[b] += 1.0;
      total += 1.0;
    }
  }
  float stops = 0.0;
  float level = ${f(HIST_LOG_MIN)};
  if (total >= ${f(MIN_METERED_SHARE * CELLS_X * CELLS_Y)}) {
    float want = total * ${f(METER_PERCENTILE)};
    float cum = 0.0;
    for (int b = 0; b < ${HIST_BINS}; b++) {
      float h = hist[b];
      if (h > 0.0 && cum + h >= want) {
        level = ${f(HIST_LOG_MIN)} + (float(b) + (want - cum) / h) * ${f(HIST_STEP)};
        break;
      }
      cum += h;
    }
    float u = clamp((level - ${f(TABLE_LOG_MIN)}) / ${f(TABLE_STEP)}, 0.0, ${f(TABLE_SIZE - 1)});
    int i0 = int(floor(u));
    int i1 = min(i0 + 1, ${TABLE_SIZE - 1});
    stops = mix(uTable[i0], uTable[i1], u - float(i0));
  }
  if (uHasPrev > 0.5) stops = mix(texelFetch(tPrev, ivec2(0, 0), 0).r, stops, uAlpha);
  gl_FragColor = vec4(stops, exp2(stops), level, 1.0);
}
`

/** tableKey: what the ceiling table depends on, to rebuild it only when the chain changes. */
function tableKey(chain: ToneChain): string {
  return JSON.stringify(chain)
}

/** HighlightMeter3d — meters a frame, eases and holds its ceiling (see the file header). */
export class HighlightMeter3d {
  private readonly cells = new THREE.WebGLRenderTarget(CELLS_X, CELLS_Y, {
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
  })
  private readonly states: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget]
  private readonly cellsQuad: FullScreenQuad
  private readonly ceilingQuad: FullScreenQuad
  private readonly cellsMaterial: THREE.ShaderMaterial
  private readonly ceilingMaterial: THREE.ShaderMaterial
  private readonly clock = new MeterClock()
  private key = ''
  private readonly pixel = new Float32Array(4)

  constructor() {
    const state = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false })
    this.states = [state(), state()]
    this.cellsMaterial = new THREE.ShaderMaterial({
      name: 'HighlightCells',
      uniforms: { tHdr: { value: null } },
      vertexShader: VERTEX,
      fragmentShader: CELLS_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    this.ceilingMaterial = new THREE.ShaderMaterial({
      name: 'HighlightCeiling',
      uniforms: {
        tCells: { value: this.cells.texture },
        tPrev: { value: null },
        uHasPrev: { value: 0 },
        uAlpha: { value: 1 },
        uTable: { value: new Float32Array(TABLE_SIZE) },
      },
      vertexShader: VERTEX,
      fragmentShader: CEILING_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    this.cellsQuad = new FullScreenQuad(this.cellsMaterial)
    this.ceilingQuad = new FullScreenQuad(this.ceilingMaterial)
  }

  /** The 1 x 1 target holding the last drawn ceiling: R stops, G gain, B log2 of the metered level. */
  get texture(): THREE.Texture { return this.states[this.clock.current].texture }

  /** setChain sets the chain the frame is drawn through; the ceiling table is rebuilt when it changes. */
  setChain(chain: ToneChain): void {
    const key = tableKey(chain)
    if (key === this.key) return
    this.key = key
    const base: ToneChain = { exposure: chain.exposure, grade: chain.grade, film: null }
    ;(this.ceilingMaterial.uniforms.uTable.value as Float32Array).set(ceilingTable(chain, base))
  }

  /** reset: the next frame takes its own ceiling at once (no easing from the last one). */
  reset(): void { this.clock.reset() }

  /** update meters `hdr` (the frame about to be tone mapped) at clock time `clockMs` and writes the eased ceiling. */
  update(renderer: THREE.WebGLRenderer, hdr: THREE.Texture, clockMs: number): void {
    const step = this.clock.step(clockMs)
    const previous = renderer.getRenderTarget()
    this.cellsMaterial.uniforms.tHdr.value = hdr
    renderer.setRenderTarget(this.cells)
    this.cellsQuad.render(renderer)
    const u = this.ceilingMaterial.uniforms
    u.uHasPrev.value = step.read === null ? 0 : 1
    u.tPrev.value = this.states[step.read ?? (1 - step.write)].texture
    u.uAlpha.value = step.alpha
    renderer.setRenderTarget(this.states[step.write])
    this.ceilingQuad.render(renderer)
    renderer.setRenderTarget(previous)
  }

  /** readStops reads the last ceiling back (stops; a GPU sync, for the export's record only). */
  readStops(renderer: THREE.WebGLRenderer): number {
    renderer.readRenderTargetPixels(this.states[this.clock.current], 0, 0, 1, 1, this.pixel)
    return this.pixel[0]
  }

  dispose(): void {
    this.cells.dispose()
    for (const s of this.states) s.dispose()
    this.cellsMaterial.dispose()
    this.ceilingMaterial.dispose()
    this.cellsQuad.dispose()
    this.ceilingQuad.dispose()
  }
}
