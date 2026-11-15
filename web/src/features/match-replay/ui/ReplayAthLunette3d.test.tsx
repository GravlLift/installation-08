import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ADS_MINIMAL, ADS_OVERLAYS } from '../model/adsOverlay'
import { ReplayAthLunette3d } from './ReplayAthLunette3d'

const draw = (key: string, levelIndex: number, ammo: string | null = null) =>
  renderToStaticMarkup(<ReplayAthLunette3d spec={ADS_OVERLAYS[key]} levelIndex={levelIndex} amount={1} ammo={ammo} />)

describe('ReplayAthLunette3d', () => {
  it('draws every captured overlay at every level', () => {
    for (const [key, spec] of Object.entries(ADS_OVERLAYS)) {
      spec.levels.forEach((_, i) => {
        const html = draw(key, i)
        expect(html).toContain(`data-ads="${spec.design}"`)
        expect(html).toContain(`data-ads-level="${i + 1}"`)
      })
    }
  })

  it('prints the zoom label and the magazine of the smart-link frame', () => {
    const html = draw('hinf_sidekick', 0, '12')
    expect(html).toContain('1.40x')
    expect(html).toContain('>12<')
  })

  it('leaves the magazine out of an overlay that does not print it', () => {
    expect(draw('hinf_br75', 0, '36')).not.toContain('>36<')
  })

  it('shows both S7 levels in its selector', () => {
    const html = draw('hinf_s7_sniper', 1)
    expect(html).toContain('>5x<')
    expect(html).toContain('>10x<')
  })

  it('clamps a level past the last one', () => {
    expect(draw('hinf_br75', 3)).toContain('data-ads-level="1"')
  })

  it('draws the minimal fallback as a reticle only, no shade', () => {
    const html = renderToStaticMarkup(<ReplayAthLunette3d spec={ADS_MINIMAL} levelIndex={0} amount={1} ammo={null} />)
    expect(html).toContain('data-ads="minimal"')
    expect(html).not.toContain('evenodd')
    expect(html).not.toContain('<text')
  })
})
