/**
 * TextureQualityToggle — the match select page's compact texture-quality switch (Standard /
 * High), styled like the page's tabs. It reads and writes the same stored preference as the
 * player's settings drawer (`useTextureQuality`, key `replay-texture-quality`), so a choice here
 * is the quality the next match opens with, and every mounted reader moves with it.
 */
import { TEXTURE_QUALITIES, useTextureQuality } from '../features/match-replay/settings/useTextureQuality'
import { QUALITY_BUILD_COST } from './preGameModel'

export function TextureQualityToggle() {
  const { quality, setQuality } = useTextureQuality()
  return (
    <div
      className="bc-quality"
      role="radiogroup"
      aria-label="Texture quality"
      title="Which map textures matches open with. High looks sharper; a map's first High build takes longer and uses more space."
    >
      <span className="bc-quality-label">Textures</span>
      {TEXTURE_QUALITIES.map((q) => (
        <button
          key={q}
          type="button"
          role="radio"
          aria-checked={quality === q}
          data-testid={`select-texture-quality-${q}`}
          className={'bc-tab' + (quality === q ? ' on' : '')}
          onClick={() => setQuality(q)}
        >
          {QUALITY_BUILD_COST[q].name}
        </button>
      ))}
    </div>
  )
}
