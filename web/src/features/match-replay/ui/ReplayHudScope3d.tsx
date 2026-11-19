// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * ReplayHudScope3d — THE AIM-DOWN-SIGHTS OVERLAY in first person, redrawn procedurally from the
 * in-game captures of each weapon's real ADS view (the game files hold no scope bitmap: Infinite's
 * HUD is CUI screens). Which overlay a weapon shows comes from `model/adsOverlay`.
 *
 * GEOMETRY: one SVG over the whole view, its user unit is 1/720 of the screen height and its origin
 * the screen center (`viewBox` 2880x720 with `slice`: the height always fits, the width is cropped,
 * any aspect up to 4:1). The numbers below are therefore pixels of the 1280x720 captures, measured
 * from the center, and they scale with the screen. The captures were taken at the viewer's default
 * FOV (`ADS_REFERENCE_FOV_DEG`); the overlays are screen-space and do not follow the FOV.
 * COLORS are the `--replay-ads-*` tokens of `index.css`.
 */
import { useId, type CSSProperties, type ReactElement } from 'react'
import type { AdsDesign, AdsLevel, AdsOverlaySpec } from '../model/adsOverlay'

const ink = (token: string) => `var(--replay-ads-${token})`
const SHADE = ink('shade')
const DARK = ink('ink')
const WHITE = ink('white')

/**
 * Where an overlay prints the magazine count (`spec.ammo`): its baseline point, anchor, size,
 * opacity, weight and `--replay-ads-*` ink. The video export prints the same text at the same
 * place (`export/adsOverlayRaster`), the count being the one value that changes every shot.
 */
export interface AdsAmmoText {
  x: number
  y: number
  anchor: 'middle' | 'end'
  size: number
  opacity: number
  weight: number
  ink: string
}

export const ADS_AMMO_TEXT: Readonly<Partial<Record<AdsDesign, AdsAmmoText>>> = {
  smartLink: { x: 152, y: -119, anchor: 'middle', size: 17, opacity: 0.85, weight: 400, ink: 'smartlink' },
  commando: { x: 155, y: -117, anchor: 'middle', size: 17, opacity: 1, weight: 600, ink: 'white' },
  bandit: { x: 344, y: 13.5, anchor: 'end', size: 27, opacity: 1, weight: 500, ink: 'amber' },
}

/** AmmoText: the magazine count of the overlay `design`, at its `ADS_AMMO_TEXT` place. */
function AmmoText({ design, ammo }: { design: AdsDesign; ammo: string | null }) {
  const t = ADS_AMMO_TEXT[design]
  if (!t || !ammo) return null
  return <text x={t.x} y={t.y} textAnchor={t.anchor} style={textStyle(ink(t.ink), t.size, t.opacity, t.weight)}>{ammo}</text>
}

/** The outer box every shade covers, well past any screen. */
const OUTER = 'M-2200,-1100H2200V1100H-2200Z'

interface DrawProps {
  /** The SVG id prefix (filters, gradients). */
  id: string
  level: AdsLevel
  /** All the levels of the overlay (a selector shows them all). */
  levels: readonly AdsLevel[]
  levelIndex: number
  ammo: string | null
  /** The center reticle color (the hostile red over an enemy), white otherwise. */
  reticle: string
}

export function ReplayHudScope3d({ spec, levelIndex, amount, reticleColor, ammo }: { spec: AdsOverlaySpec; levelIndex: number; amount: number; reticleColor?: string; ammo: string | null }) {
  const id = `ads${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const index = Math.max(0, Math.min(levelIndex, spec.levels.length - 1))
  const Draw = DESIGNS[spec.design]
  return (
    <svg
      aria-hidden="true"
      data-ads={spec.design}
      data-ads-level={index + 1}
      viewBox="-1440 -360 2880 720"
      preserveAspectRatio="xMidYMid slice"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden', opacity: amount, pointerEvents: 'none' }}
    >
      <defs>
        {[2, 5, 9, 16, 28].map((sd) => (
          <filter key={sd} id={`${id}-b${sd}`} filterUnits="userSpaceOnUse" x="-2300" y="-1200" width="4600" height="2400">
            <feGaussianBlur stdDeviation={sd} />
          </filter>
        ))}
      </defs>
      <Draw id={id} level={spec.levels[index]} levels={spec.levels} levelIndex={index} ammo={spec.ammo ? ammo : null} reticle={reticleColor ?? WHITE} />
    </svg>
  )
}

// --- Shared pieces ---------------------------------------------------------------------------

const blur = (id: string, sd: 2 | 5 | 9 | 16 | 28) => `url(#${id}-b${sd})`

function line(stroke: string, width: number, opacity = 1): CSSProperties {
  return { fill: 'none', stroke, strokeWidth: width, opacity, strokeLinecap: 'round', strokeLinejoin: 'round' }
}

function textStyle(fill: string, size: number, opacity = 1, weight = 600): CSSProperties {
  return { fill, fontSize: size, opacity, fontFamily: 'var(--display)', fontWeight: weight }
}

/** Shade: darkens everything outside `window` (a closed path), with a soft edge. */
function Shade({ id, window, opacity, soft, color = SHADE }: { id: string; window: string; opacity: number; soft: 2 | 5 | 9 | 16 | 28; color?: string }) {
  return <path d={`${OUTER} ${window}`} fillRule="evenodd" filter={blur(id, soft)} style={{ fill: color, opacity }} />
}

/** A center reticle drawn twice: a dark halo, then the color, so it reads over any scene. */
function Reticle({ d, color, width = 1.3, dot = 0, ring = 0 }: { d?: string; color: string; width?: number; dot?: number; ring?: number }) {
  return (
    <g>
      {d && <path d={d} style={line(DARK, width + 1.6, 0.55)} />}
      {ring > 0 && <circle r={ring} style={line(DARK, width + 1.6, 0.55)} />}
      {d && <path d={d} style={line(color, width)} />}
      {ring > 0 && <circle r={ring} style={line(color, width)} />}
      {dot > 0 && <circle r={dot} style={{ fill: color }} />}
    </g>
  )
}

/** Sym: the path `d` (drawn on the left) and its mirror across the vertical center line. */
function Sym({ d, style, filter }: { d: string; style: CSSProperties; filter?: string }) {
  return (
    <g filter={filter}>
      <path d={d} style={style} />
      <path d={d} style={style} transform="scale(-1 1)" />
    </g>
  )
}

/** Rounded rectangle path, centered. */
function roundRect(hw: number, hh: number, r: number): string {
  return `M${-hw + r},${-hh}H${hw - r}A${r},${r} 0 0 1 ${hw},${-hh + r}V${hh - r}A${r},${r} 0 0 1 ${hw - r},${hh}H${-hw + r}A${r},${r} 0 0 1 ${-hw},${hh - r}V${-hh + r}A${r},${r} 0 0 1 ${-hw + r},${-hh}Z`
}

// --- Smart-link frame (Sidekick, MA40, Bulldog, Disruptor, Mangler, Plasma Pistol) -------------

/** The thin cyan frame at 1.40x: no blackout, the weapon stays on screen, the hip reticle stays. */
function SmartLink({ level, ammo }: DrawProps) {
  const c = ink('smartlink')
  const thin = line(c, 1.2, 0.7)
  const faint = line(c, 1.1, 0.42)
  const dashes: string[] = []
  for (let x = 160; x <= 345; x += 18) dashes.push(`M${-x},0H${-x - 7} M${x},0H${x + 7}`)
  return (
    <g>
      {/* The four corner ticks, corners toward the center. */}
      <path d="M-328,-132V-122H-336 M328,-132V-122H336 M-336,122H-328V132 M336,122H328V132" style={thin} />
      {/* The outer top corners and the bottom strokes. */}
      <path d="M-343,-204V-210H-275 M343,-204V-210H275 M-195,152H-128V146 M195,152H128V146" style={faint} />
      {/* The rails above the labels. */}
      <path d="M-208,-166H-130 M130,-166H208 M-180,-141H-138 M138,-141H180 M-153,-111H-138 M138,-111H153" style={thin} />
      <path d="M-108,-146H-100 M100,-146H108" style={line(c, 3, 0.35)} />
      {level.label && <text x={-116} y={-119} textAnchor="middle" style={textStyle(c, 17, 0.85, 400)}>{level.label}</text>}
      <AmmoText design="smartLink" ammo={ammo} />
      {/* The side columns with their end caps. */}
      <path d="M-231,-71V66 M-235,-71H-227 M-235,66H-227 M231,-71V66 M227,-71H235 M227,66H235" style={thin} />
      <path d="M-223,-55V52 M223,-55V52" style={line(c, 0.9, 0.35)} />
      {/* The center row: dashes and a diamond on each column. */}
      <path d={dashes.join(' ')} style={line(c, 1.1, 0.4)} />
      <path d="M-231,-3L-228,0L-231,3L-234,0Z M231,-3L234,0L231,3L228,0Z" style={{ fill: c, opacity: 0.6 }} />
    </g>
  )
}

// --- BR75 ------------------------------------------------------------------------------------

/** The BR75: a round etched scope, a soft dark vignette past its ring, heavy posts and a mil ladder. */
function Br75({ id, reticle }: DrawProps) {
  const ticks: string[] = []
  for (let i = 1; i <= 14; i++) {
    const p = i * 6
    const h = i % 4 === 0 ? 4 : 2
    ticks.push(`M${p},${-h}V${h} M${-p},${-h}V${h} M${-h},${p}H${h} M${-h},${-p}H${h}`)
  }
  return (
    <g>
      <defs>
        <radialGradient id={`${id}-v`} gradientUnits="userSpaceOnUse" cx="0" cy="0" r="760">
          <stop offset="0.27" stopOpacity="0" style={{ stopColor: SHADE }} />
          <stop offset="0.31" stopOpacity="0.12" style={{ stopColor: SHADE }} />
          <stop offset="0.42" stopOpacity="0.45" style={{ stopColor: SHADE }} />
          <stop offset="0.6" stopOpacity="0.6" style={{ stopColor: SHADE }} />
          <stop offset="1" stopOpacity="0.72" style={{ stopColor: SHADE }} />
        </radialGradient>
      </defs>
      <rect x="-2200" y="-1100" width="4400" height="2200" fill={`url(#${id}-v)`} />
      <circle r="215" style={line(DARK, 2.4, 0.5)} />
      <path d="M0,-150V-89 M0,89V150 M-150,0H-90 M90,0H150" style={line(DARK, 2.4, 0.9)} />
      <path d="M-89,0H89 M0,-89V89" style={line(DARK, 0.7, 0.45)} />
      <path d={ticks.join(' ')} style={line(DARK, 0.8, 0.65)} />
      <Reticle d="M0,-16V-4 M0,4V16 M-16,0H-4 M4,0H16" ring={9} color={reticle} />
    </g>
  )
}

// --- VK78 Commando ---------------------------------------------------------------------------

/** The Commando: an octagonal glass housing, MAG/AMMO readouts, amber range bars. */
function Commando({ id, level, ammo, reticle }: DrawProps) {
  const amber = ink('amber')
  const glass = ink('glass')
  const win = 'M-230,-215H230L305,-150V90L190,275H-190L-305,90V-150Z'
  const dots: string[] = []
  for (let x = 35; x <= 73; x += 4) dots.push(`M${x},-1.5V1.5 M${-x},-1.5V1.5`)
  return (
    <g>
      <Shade id={id} window={win} opacity={0.5} soft={16} />
      <path d={win} filter={blur(id, 5)} style={line(glass, 8, 0.3)} />
      {/* The housing: glass top bar and chamfers, dark posts. */}
      <path d="M-230,-188H230 M-230,-188L-278,-152 M230,-188L278,-152" style={line(glass, 2.5, 0.45)} />
      <path d="M-278,-152V-60 M278,-152V-60 M-143,-188V-150 M143,-188V-150 M-145,240V275 M145,240V275" style={line(DARK, 4, 0.55)} />
      <path d="M-175,225V265 M175,225V265" style={line(glass, 3, 0.35)} />
      <path d="M-53,-188V240 M53,-188V240" style={line(WHITE, 0.8, 0.22)} />
      <path d="M-53,-139V-133 M53,-139V-133 M-53,115V121 M53,115V121" style={line(DARK, 2.5, 0.75)} />
      {/* Readouts. */}
      <path d="M-278,-136H-75 M75,-136H278" style={line(WHITE, 0.8, 0.3)} />
      <text x={-150} y={-140} textAnchor="middle" style={textStyle(amber, 6, 0.8)}>MAG</text>
      {level.label && <text x={-184} y={-117} style={textStyle(amber, 17)}>{level.label}</text>}
      <text x={153} y={-140} textAnchor="middle" style={textStyle(WHITE, 6, 0.75)}>AMMO</text>
      <AmmoText design="commando" ammo={ammo} />
      {/* Amber range bars and the dark ladder on the center row. */}
      <path d="M-189,0H-133 M-105,0H-100 M100,0H105 M133,0H189" filter={blur(id, 2)} style={line(amber, 3, 0.5)} />
      <path d="M-189,0H-133 M-105,0H-100 M100,0H105 M133,0H189" style={line(amber, 1.6, 0.95)} />
      <path d={dots.join(' ')} style={line(DARK, 0.8, 0.55)} />
      <path d="M0,24V28 M0,34V38 M0,44V48 M-10,30H-6 M6,30H10" style={line(DARK, 0.9, 0.45)} />
      <Reticle d="M0,-8A8,8 0 0 1 8,0 M0,8A8,8 0 0 1 -8,0" color={reticle} dot={1.2} />
      <Reticle d="M5.7,-5.7A8,8 0 0 1 5.7,5.7 M-5.7,5.7A8,8 0 0 1 -5.7,-5.7" color={reticle} />
    </g>
  )
}

// --- Bandit ----------------------------------------------------------------------------------

/**
 * The Bandit housing, measured on the owner's 1450x819 capture of the Bandit Evo at 1.6x
 * (2026-11-19; units of 1/720 of the height from the center). The outer edge is a rounded box
 * 374 x 247 (radius 45); its four corners are thick blue pieces (24 wide on the sides, 21 on top,
 * inner radius 30) that run to y = +-109 down the sides and to x = +-294 along the top and bottom,
 * joined by a thin edge (4). The blue is rgb(64, 87, 114) over near-black, read here as
 * BANDIT_RIM at BANDIT_RIM_OPACITY. Outside the window the scene keeps 0.3 of its light (top
 * and bottom-left edges, measured), so the shade is 0.7.
 */
const BANDIT = { hw: 374, hh: 247, r: 45, side: 24, top: 21, innerR: 30, cornerY: 109, cornerX: 294, thin: 4 } as const
const BANDIT_SHADE = 0.7
const BANDIT_RIM = 'rgb(100, 150, 215)'
const BANDIT_RIM_OPACITY = 0.6
/** The three light bars outside the window (y from, to), out to x = +-589 where they fade, measured
 *  as about rgb(95, 140, 185) at 0.25 over the shade. */
const BANDIT_BARS: readonly (readonly [number, number])[] = [[-172, -155], [-29, 29], [155, 173]]
const BANDIT_BAR_END = 589
/** The reticle's brackets read lighter than the readouts: a pale yellow (inferred from 2 px lines
 *  over a known background, about rgb(255, 255, 190) at partial coverage). */
const BANDIT_BRACKET = '#fbf59b'

/** The Bandit: a rounded window in a blue housing, light bars outside, yellow MAG/AMMO readouts. */
function Bandit({ id, level, ammo, reticle }: DrawProps) {
  const amber = ink('amber')
  const B = BANDIT
  const win = roundRect(B.hw, B.hh, B.r)
  const thick = `${win} ${roundRect(B.hw - B.side, B.hh - B.top, B.innerR)}`
  const thin = `${win} ${roundRect(B.hw - B.thin, B.hh - B.thin, B.r - B.thin)}`
  const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => ({ sx, sy })))
  return (
    <g>
      <defs>
        <clipPath id={`${id}-corners`}>
          {corners.map(({ sx, sy }) => <rect key={`${sx}${sy}`} x={sx < 0 ? -B.hw - 10 : B.cornerX} y={sy < 0 ? -B.hh - 10 : B.cornerY} width={B.hw + 10 - B.cornerX} height={B.hh + 10 - B.cornerY} />)}
        </clipPath>
        <linearGradient id={`${id}-barL`} gradientUnits="userSpaceOnUse" x1={-BANDIT_BAR_END} x2={-BANDIT_BAR_END + 24} y1="0" y2="0">
          <stop offset="0" stopColor="rgb(95, 140, 185)" stopOpacity="0" />
          <stop offset="1" stopColor="rgb(95, 140, 185)" stopOpacity="0.25" />
        </linearGradient>
      </defs>
      <Shade id={id} window={win} opacity={BANDIT_SHADE} soft={2} />
      {/* The light bars outside, mirrored. */}
      {BANDIT_BARS.map(([y0, y1]) => <Sym key={y0} d={`M${-BANDIT_BAR_END},${y0}H${-B.hw + 2}V${y1}H${-BANDIT_BAR_END}Z`} style={{ fill: `url(#${id}-barL)` }} />)}
      {/* The housing: thick corners, thin edge between them, a soft glow. */}
      <path d={thick} fillRule="evenodd" clipPath={`url(#${id}-corners)`} filter={blur(id, 2)} style={{ fill: BANDIT_RIM, opacity: 0.35 }} />
      <path d={thick} fillRule="evenodd" clipPath={`url(#${id}-corners)`} style={{ fill: BANDIT_RIM, opacity: BANDIT_RIM_OPACITY }} />
      <path d={thin} fillRule="evenodd" style={{ fill: BANDIT_RIM, opacity: BANDIT_RIM_OPACITY }} />
      {/* The inner vertical lines, through the readouts. */}
      <path d={`M-316,${-B.hh + B.top}V${B.hh - B.top} M316,${-B.hh + B.top}V${B.hh - B.top}`} style={line(WHITE, 1.5, 0.45)} />
      {/* Readouts: a dim filled tab with its label, the box's top and bottom lines, the thick post. */}
      <Sym d="M-365,-39H-284V-25H-365Z M-365,34H-284V39H-365Z" style={{ fill: amber, opacity: 0.35 }} />
      <Sym d="M-365,-25H-284 M-365,34H-284" style={line(amber, 1, 1)} />
      <Sym d="M-359.5,-25V34" style={{ ...line(amber, 4.5, 1), strokeLinecap: 'butt' }} />
      <text x={-324.5} y={-28.5} textAnchor="middle" style={textStyle(amber, 9, 1)}>MAG</text>
      {level.label && <text x={-343} y={13.5} style={textStyle(amber, 27, 1, 500)}>{level.label}</text>}
      <text x={324.5} y={-28.5} textAnchor="middle" style={textStyle(amber, 9, 1)}>AMMO</text>
      <AmmoText design="bandit" ammo={ammo} />
      {/* The faint range lines on the center row. */}
      <Sym d="M-228,-2H-123" style={line(amber, 1.8, 0.25)} />
      {/* The parentheses around the reticle and the corner marks. */}
      <path d="M-43,-36C-56,-24 -60,-12 -60,0C-60,12 -56,24 -43,36 M-60,0H-57 M43,-36C56,-24 60,-12 60,0C60,12 56,24 43,36 M60,0H57" style={line(BANDIT_BRACKET, 2.2, 1)} />
      <path d="M-98,-64V-68H-93 M95,-64V-68H90 M-98,61V65H-93 M95,61V65H90" style={line(amber, 1.2, 0.7)} />
      <path d="M-6,72Q0,66 6,72 M0,84V86 M0,104V106 M0,130V150" style={line(amber, 1, 0.35)} />
      {/* The reticle: a ring and four short arcs around the diagonals (gaps up, down and sideways). */}
      <Reticle ring={12.7} d={BANDIT_RETICLE_ARCS} color={reticle} width={2} />
    </g>
  )
}

/** The Bandit's inner arcs: radius 4.2, each spanning 60 degrees centered on a diagonal. */
const BANDIT_RETICLE_ARCS = [45, 135, 225, 315].map((deg) => {
  const r = 4.2
  const a0 = ((deg - 30) * Math.PI) / 180
  const a1 = ((deg + 30) * Math.PI) / 180
  const p = (a: number) => `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`
  return `M${p(a0)}A${r},${r} 0 0 1 ${p(a1)}`
}).join(' ')

// --- S7 sniper -------------------------------------------------------------------------------

interface S7Level {
  /** Window half width, top and bottom. */
  w: number
  t: number
  b: number
  /** Half gap of the dark bracket lines, their inner and outer ends. */
  g: number
  xIn: number
  xOut: number
  /** The colored center-row segment (inner, outer). */
  seg: [number, number]
  /** The dark center posts (from, to). */
  post: [number, number]
  /** The 5x|10x selector row and the bottom arrows row. */
  pill: number
  arrows: number
  /** The dark dots (x; y above and below). */
  dot: [number, number, number]
  /** The cyan side tick columns. */
  col: number
}

const S7_LEVELS: readonly S7Level[] = [
  { w: 500, t: -195, b: 188, g: 64, xIn: 60, xOut: 237, seg: [160, 231], post: [63, 84], pill: -188, arrows: 185, dot: [53, -99, 96], col: 460 },
  { w: 540, t: -210, b: 200, g: 36, xIn: 63, xOut: 248, seg: [168, 244], post: [65, 88], pill: -198, arrows: 195, dot: [55, -103, 102], col: 485 },
]

/** The S7: a near-black vignette around a barrel-shaped window, an etched reticle, a 5x|10x selector. */
function S7({ id, levels, levelIndex, reticle }: DrawProps) {
  const L = S7_LEVELS[Math.min(levelIndex, S7_LEVELS.length - 1)]
  const c = ink(levelIndex === 0 ? 's7' : 's7-far')
  const { w, t, b } = L
  const mid = (t + b) / 2
  const win = `M${-(w - 120)},${t}H${w - 120}C${w - 30},${t} ${w},${t + 70} ${w},${mid}C${w},${b - 70} ${w - 30},${b} ${w - 120},${b}H${-(w - 120)}C${-(w - 30)},${b} ${-w},${b - 70} ${-w},${mid}C${-w},${t + 70} ${-(w - 30)},${t} ${-(w - 120)},${t}Z`
  const brackets = `M${-L.xIn},${-L.g}H${-L.xOut}V${-L.g + 5} M${L.xIn},${-L.g}H${L.xOut}V${-L.g + 5} M${-L.xIn},${L.g}H${-L.xOut}V${L.g - 5} M${L.xIn},${L.g}H${L.xOut}V${L.g - 5}`
  const ticks: string[] = []
  for (let x = 40; x <= 150; x += 9.5) ticks.push(`M${x},-1.5V1.5 M${-x},-1.5V1.5`)
  const cols: string[] = []
  for (let y = -90; y <= 90; y += 30) cols.push(`M${-L.col},${y}H${-L.col - 6} M${L.col},${y}H${L.col + 6}`)
  const arrows = [-40, -20, 0, 20].map((x) => `M${x},${L.arrows}L${x + 5},${L.arrows - 2.5}H${x + 17}V${L.arrows + 2.5}H${x + 5}Z`).join(' ')
  return (
    <g>
      <Shade id={id} window={win} opacity={0.86} soft={16} />
      {/* The zoom selector: the active level filled. */}
      {levels.map(({ label }, i) => {
        const x = i === 0 ? -44 : 1
        const active = i === levelIndex
        return (
          <g key={i}>
            <rect x={x} y={L.pill - 5} width={43} height={10} style={{ fill: active ? c : 'rgba(8, 18, 26, 0.75)', opacity: active ? 0.9 : 1 }} />
            <text x={x + 21.5} y={L.pill + 3} textAnchor="middle" style={{ ...textStyle(active ? '#08141c' : c, 7.5), letterSpacing: 1 }}>{label}</text>
          </g>
        )
      })}
      <path d={`M-55,${L.pill - 7}V${L.pill + 7} M55,${L.pill - 7}V${L.pill + 7} M-55,${L.pill + 19}V${L.pill + 25} M55,${L.pill + 19}V${L.pill + 25} M-55,${L.arrows - 12}V${L.arrows + 4} M55,${L.arrows - 12}V${L.arrows + 4}`} style={line(c, 1.6, 0.8)} />
      <path d={arrows} style={{ fill: c, opacity: 0.8 }} />
      {/* The etched reticle. */}
      <path d={brackets} style={line(DARK, 1.1, 0.75)} />
      <path d={`M0,${-L.post[1]}V${-L.post[0]} M0,${L.post[0]}V${L.post[1]}`} style={line(DARK, 1.8, 0.8)} />
      <path d={ticks.join(' ')} style={line(DARK, 0.8, 0.55)} />
      <path d={`M${-L.dot[0]},${L.dot[1] - 2}V${L.dot[1] + 2} M${L.dot[0]},${L.dot[1] - 2}V${L.dot[1] + 2} M${-L.dot[0]},${L.dot[2] - 2}V${L.dot[2] + 2} M${L.dot[0]},${L.dot[2] - 2}V${L.dot[2] + 2}`} style={line(DARK, 2, 0.75)} />
      <path d={`M${-L.seg[1]},0H${-L.seg[0]} M${L.seg[0]},0H${L.seg[1]}`} style={line(c, 1.4, 0.9)} />
      <path d={`M${-L.seg[1] - 40},0h1 M${L.seg[1] + 40},0h1 M-318,-100h1 M318,-100h1 M-318,96h1 M318,96h1`} style={line(c, 2.4, 0.7)} />
      <path d={cols.join(' ')} style={line(c, 1.1, 0.6)} />
      <Reticle ring={3} color={reticle} width={1.1} />
    </g>
  )
}

// --- Shock Rifle -----------------------------------------------------------------------------

/** The Shock Rifle: its out-of-focus red sight housing, orange angled brackets and hatched fins. */
function Shock({ id, reticle }: DrawProps) {
  const orange = ink('orange')
  const red = ink('red')
  const fin = 'M-188,89L-175,118L-200,174L-213,145Z'
  return (
    <g>
      <defs>
        <radialGradient id={`${id}-v`} gradientUnits="userSpaceOnUse" cx="0" cy="-40" r="900">
          <stop offset="0.45" stopOpacity="0" style={{ stopColor: SHADE }} />
          <stop offset="1" stopOpacity="0.75" style={{ stopColor: SHADE }} />
        </radialGradient>
        <pattern id={`${id}-h`} patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(-35)">
          <rect width="2" height="4" style={{ fill: orange }} />
        </pattern>
      </defs>
      <rect x="-2200" y="-1100" width="4400" height="2200" fill={`url(#${id}-v)`} />
      {/* The blurred red housing of the sight, close to the eye. */}
      <g filter={blur(id, 9)} style={{ opacity: 0.55 }}>
        <Sym d="M-215,-360C-280,-200 -320,-80 -400,90 M-150,-360C-205,-210 -235,-80 -265,60" style={line(red, 14)} />
        <Sym d="M-250,-25C-245,-60 -215,-60 -210,-25V60 M-240,250L-215,215H-120" style={line(red, 7)} />
      </g>
      <path d="M-200,-120Q0,-170 200,-120" filter={blur(id, 28)} style={line(red, 120, 0.18)} />
      {/* The brackets, their caps, the short bar under the reticle and the readout glyphs. */}
      <Sym d="M-105,-50L-133,47L-125,50 M-170,-44H-138" style={line(orange, 1.4, 0.85)} />
      <path d="M-11,36H11 M-4,44H4" style={line(orange, 1.2, 0.6)} />
      <path d="M-166,44H-156V50H-166Z M-162,42V44 M150,47H156V44H162V41 M148,44H152V41" style={line(orange, 1, 0.8)} />
      <Sym d={fin} style={{ fill: `url(#${id}-h)`, opacity: 0.55 }} />
      <Reticle ring={7} d="M0,-11V-8 M0,8V11 M-9.5,-5.5L-7,-4 M9.5,-5.5L7,-4 M-9.5,5.5L-7,4 M9.5,5.5L7,4" color={reticle} width={1.2} dot={1.2} />
    </g>
  )
}

// --- Skewer ----------------------------------------------------------------------------------

interface SkewerLevel {
  bracket: string
  /** The x of the tick columns and their y. */
  col: number
  ticks: number[]
  /** The chevrons, the round outline (from, to) and the glowing box (from, to), right side. */
  chevrons: [number, number]
  round: [number, number]
  box: [number, number]
  /** The left glyph x, the arrow x. */
  glyph: number
  arrow: number
}

const SKEWER_LEVELS: readonly SkewerLevel[] = [
  {
    bracket: 'M-1,-104Q-1,-117 -9,-114L-110,-84Q-118,-81 -118,-73V78Q-118,86 -110,89L-9,114Q-1,117 -1,105',
    col: 136,
    ticks: [-87, -38, 11, 60, 109],
    chevrons: [87, 102],
    round: [115, 140],
    box: [150, 170],
    glyph: -94,
    arrow: -232,
  },
  {
    bracket: 'M-50,-81L-73,-73Q-80,-71 -80,-63V63Q-80,70 -73,72L-50,80',
    col: 164,
    ticks: [-104, -45, 12, 70, 127],
    chevrons: [104, 124],
    round: [142, 167],
    box: [202, 227],
    glyph: -108,
    arrow: -268,
  },
]

/** The Skewer: an orange bracket and range ticks, the round's readout, under the red sight haze. */
function Skewer({ id, levelIndex, reticle }: DrawProps) {
  const L = SKEWER_LEVELS[Math.min(levelIndex, SKEWER_LEVELS.length - 1)]
  const orange = ink('orange')
  const red = ink('red')
  const ticks = L.ticks.map((y) => `M${-L.col - 4},${y}H${-L.col + 4} M${L.col - 4},${y}H${L.col + 4}`).join(' ')
  const [c1, c2] = L.chevrons
  const [r1, r2] = L.round
  const [b1, b2] = L.box
  const arrow = `M${L.arrow},-30L${L.arrow + 6},-16H${L.arrow + 3}V28H${L.arrow - 3}V-16H${L.arrow - 6}Z`
  return (
    <g>
      {/* The red haze of the sight housing, out of focus, heavier on the right. */}
      <g filter={blur(id, 28)} style={{ opacity: 0.24 }}>
        <ellipse cx="330" cy="-60" rx="150" ry="300" style={{ fill: red }} />
        <ellipse cx="-300" cy="0" rx="70" ry="160" style={{ fill: red }} />
        <ellipse cx="-80" cy="-280" rx="260" ry="70" style={{ fill: red }} />
      </g>
      <rect x="-2200" y="-1100" width="4400" height="2200" style={{ fill: SHADE, opacity: 0.12 }} />
      <path d={L.bracket} filter={blur(id, 2)} style={line(orange, 4, 0.45)} />
      <path d={L.bracket} style={line(orange, 1.8, 0.95)} />
      <path d={ticks} style={line(orange, 1.4, 0.75)} />
      <path d={`M${c1 + 4},-4L${c1},0L${c1 + 4},4 M${c2 + 4},-4L${c2},0L${c2 + 4},4 M${r2},-4H${r1 + 8}L${r1},0L${r1 + 8},4H${r2}`} style={line(orange, 1.1, 0.7)} />
      <rect x={b1} y={-5} width={b2 - b1} height={10} rx={2} filter={blur(id, 2)} style={{ fill: orange, opacity: 0.8 }} />
      <path d={`M${L.glyph - 9},0H${L.glyph} M${L.glyph},-4V4 M${L.glyph},-3H${L.glyph + 4}V3`} style={line(orange, 1.4, levelIndex === 0 ? 0.35 : 0.85)} />
      <path d={arrow} filter={blur(id, 5)} style={{ fill: orange, opacity: 0.8 }} />
      <path d={arrow} style={{ fill: orange, opacity: 0.85 }} />
      {levelIndex === 0 && <path d="M-9,-147H-1V-143H3 M-9,140V146H-1V142" style={line(orange, 1.3, 0.8)} />}
      <Reticle d="M-3,-7H3L7,-2L3,3H-3L-7,-2Z" color={reticle} width={1.2} />
      <path d="M-5,10Q0,13 5,10 M-4,17Q0,19 4,17 M-2.5,23Q0,24.5 2.5,23" style={line(WHITE, 1, 0.55)} />
    </g>
  )
}

// --- Stalker Rifle ---------------------------------------------------------------------------

/** The Stalker Rifle: a violet octagonal rim, orange line art, magenta range dots and icons. */
function Stalker({ id, levelIndex, reticle }: DrawProps) {
  const orange = ink('orange')
  const violet = ink('violet')
  const magenta = ink('magenta')
  // The dots and icons spread with the zoom (x1.5 at level 2); the rim opens wider.
  const k = levelIndex === 0 ? 1 : 1.53
  const r = levelIndex === 0 ? 1 : 1.18
  const win = `M${-290 * r},${-279 * r}H${290 * r}L${615 * r},${-98 * r}V${140 * r}L${340 * r},${265 * r}H${-340 * r}L${-615 * r},${140 * r}V${-98 * r}Z`
  const art =
    'M-340,-210H-70L-64,-215H-62L-59,-206 M-338,-205H-72 M-46,-171L-42,-176H0 M-340,-210L-279,-185 M-203,-279L-340,-185L-421,-123 M-340,-182L-128,-98 M-421,-123L-315,-79 M-440,109L-321,65 M-324,140L-134,80 M-321,134L-265,159L-60,177L-56,172 M-46,152L-42,157H0'
  const dots = [-371, -318, -228, 228, 318, 371].map((x) => <ellipse key={x} cx={x * k} cy={0} rx={4} ry={1.6} style={{ fill: magenta }} />)
  return (
    <g>
      <Shade id={id} window={win} opacity={0.88} soft={28} color="#0c0414" />
      <path d={win} filter={blur(id, 16)} style={line(violet, 34, 0.7)} />
      <path d={win} filter={blur(id, 28)} style={line(orange, 60, 0.12)} />
      <Sym d="M-490,-120V140 M-560,-60V150" filter={blur(id, 9)} style={line(orange, 8, 0.25)} />
      <Sym d={art} style={line(orange, 1.3, 0.85)} />
      <g filter={blur(id, 2)} style={{ opacity: 0.9 }}>{dots}</g>
      <g transform={`translate(0 ${-245 * k})`} style={{ fill: magenta, opacity: 0.85 }}>
        <path d="M0,-8L7,6L0,2L-7,6Z" />
        <path d="M-40,-4L-35,5H-45Z M40,-4L45,5H35Z" />
      </g>
      <g transform={`translate(0 ${230 * k})`} style={line(magenta, 1.4, 0.8)}>
        <path d="M-15,-8H15L0,22Z M-7,-6H7L0,8Z M0,-18L5,-11H-5Z" />
        <circle cy={50} r={2.5} style={{ fill: magenta }} />
      </g>
      <Reticle d="M-7,-7L-2.5,-2.5 M7,-7L2.5,-2.5 M-7,7L-2.5,2.5 M7,7L2.5,2.5" color={reticle} width={1.2} />
    </g>
  )
}

// --- Vestige Carbine -------------------------------------------------------------------------

/** The Vestige Carbine: green Forerunner line art over a soft light vignette, three triangles below. */
function Vestige({ id, reticle }: DrawProps) {
  const green = ink('green')
  const art =
    'M-223,-206L-210,-211H-65L-55,-203 M-45,-175L-40,-180H0 M-350,-200L-220,-252 M-55,177L-62,184H-245L-272,168 M-305,128Q-320,128 -320,134Q-320,140 -305,140 M-45,148L-40,154H0'
  return (
    <g>
      <defs>
        <radialGradient id={`${id}-v`} gradientUnits="userSpaceOnUse" cx="0" cy="0" r="720" gradientTransform="scale(1 0.72)">
          <stop offset="0.55" stopOpacity="0" style={{ stopColor: SHADE }} />
          <stop offset="1" stopOpacity="0.42" style={{ stopColor: SHADE }} />
        </radialGradient>
      </defs>
      <rect x="-2200" y="-1100" width="4400" height="2200" fill={`url(#${id}-v)`} />
      <path d="M-640,-200V260 M640,-200V260" filter={blur(id, 28)} style={line(green, 70, 0.3)} />
      <Sym d={art} style={line(green, 1.3, 0.8)} />
      <path d="M-30,208L-48,219L-30,230Z M-11,231L0,210L11,231Z M30,208L48,219L30,230Z" style={{ ...line(green, 2.2, 0.55), fill: green, fillOpacity: 0.15 }} />
      <circle r={9} style={line(WHITE, 0.8, 0.3)} />
      <Reticle d="M-9,-5L-3,0L-9,5 M9,-5L3,0L9,5" color={reticle} width={1.2} />
    </g>
  )
}

// --- Minimal fallback ------------------------------------------------------------------------

/** The neutral overlay of a scoped weapon nobody captured: a thin open cross and a dot. */
function Minimal({ reticle }: DrawProps) {
  return <Reticle d="M0,-11V-4 M0,4V11 M-11,0H-4 M4,0H11" color={reticle} width={1} dot={0.9} />
}

const DESIGNS: Readonly<Record<AdsDesign, (props: DrawProps) => ReactElement>> = {
  smartLink: SmartLink,
  br75: Br75,
  commando: Commando,
  bandit: Bandit,
  s7: S7,
  shock: Shock,
  skewer: Skewer,
  stalker: Stalker,
  vestige: Vestige,
  minimal: Minimal,
}
