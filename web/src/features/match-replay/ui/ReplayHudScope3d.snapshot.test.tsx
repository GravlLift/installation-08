// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * A VISUAL CHECK of the ADS overlays, off by default: with `ADS_SNAPSHOT_DIR` set, it writes one
 * 1280x720 HTML page per weapon and level, the overlay alone over a flat gray scene, and with
 * `ADS_REFERENCE_DIR` set (a folder of in-game captures named like `REFERENCES` below, never
 * committed) a second page with the overlay over its capture. A headless browser screenshot of
 * each page puts the drawing next to the real ADS view.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it } from 'vitest'
import { ADS_MINIMAL, ADS_OVERLAYS } from '../model/adsOverlay'
import { ReplayHudScope3d } from './ReplayHudScope3d'

const OUT = process.env.ADS_SNAPSHOT_DIR
const REFS = process.env.ADS_REFERENCE_DIR

/** weapon label key, level (1-based), capture file name, magazine shown in the capture. */
const REFERENCES: [string, number, string | null, string | null][] = [
  ['hinf_sidekick', 1, 'sidekick.jpg', '12'],
  ['hinf_ma40_ar', 1, 'assault_rifle.jpg', '36'],
  ['hinf_cqs48_bulldog', 1, 'bulldog.jpg', '07'],
  ['hinf_disruptor', 1, 'disruptor.jpg', '12'],
  ['hinf_mangler', 1, 'mangler.jpg', '08'],
  ['hinf_plasma_pistol', 1, 'plasma_pistol.jpg', null],
  ['hinf_br75', 1, 'br75.jpg', null],
  ['hinf_vk78_commando', 1, 'commando.jpg', '20'],
  ['hinf_bandit', 1, 'bandit.jpg', '15'],
  ['hinf_s7_sniper', 1, 's7_1.jpg', null],
  ['hinf_s7_sniper', 2, 's7_2.jpg', null],
  ['hinf_shock_rifle', 1, 'shock_rifle.jpg', null],
  ['hinf_skewer', 1, 'skewer_1.jpg', null],
  ['hinf_skewer', 2, 'skewer_2.jpg', null],
  ['hinf_stalker_rifle', 1, 'stalker_1.jpg', null],
  ['hinf_stalker_rifle', 2, 'stalker_2.jpg', null],
  ['hinf_vestige_carbine', 1, 'vestige_carbine.jpg', null],
  ['minimal', 1, null, null],
]

/** The `--replay-ads-*` tokens and the display font, read from the app's own stylesheet (run from web/). */
function tokens(): string {
  const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8')
  return css.split('\n').filter((l) => /^\s*--(replay-ads-|display:)/.test(l)).join('\n')
}

function page(svg: string, background: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>:root{${tokens()}}html,body{margin:0;width:1280px;height:720px;overflow:hidden}#v{position:relative;width:1280px;height:720px;${background}}</style></head><body><div id="v">${svg}</div></body></html>`
}

describe.skipIf(!OUT)('ADS overlay snapshots', () => {
  it('writes one page per weapon and level', () => {
    mkdirSync(OUT!, { recursive: true })
    for (const [key, level, ref, ammo] of REFERENCES) {
      const spec = key === 'minimal' ? ADS_MINIMAL : ADS_OVERLAYS[key]
      const svg = renderToStaticMarkup(<ReplayHudScope3d spec={spec} levelIndex={level - 1} amount={1} ammo={ammo} />)
      const name = `${key}_${level}`
      const grid = 'background-color:#8d9296;background-image:linear-gradient(#7d8286 1px,transparent 1px),linear-gradient(90deg,#7d8286 1px,transparent 1px);background-size:40px 40px;background-position:0 0'
      writeFileSync(join(OUT!, `${name}_alone.html`), page(svg, grid))
      if (REFS && ref) {
        const url = pathToFileURL(join(REFS, ref)).href
        writeFileSync(join(OUT!, `${name}_over.html`), page(svg, `background:url('${url}') center/cover`))
      }
    }
  })
})
