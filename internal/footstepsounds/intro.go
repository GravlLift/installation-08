// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package footstepsounds

// intro.go extracts the multiplayer theme the replay's intro plays the rise of.
//
// The shipped intro (internal/sounds/files/halo_infinite/intro_music_01.ogg) is a three-second
// excerpt of this theme, [R - 1 s, R + 2 s] around its resolution R (3.19 s): it stops at about
// -21 dB, while the theme itself rings out after R (measured 2026-11-19 on the install's copy,
// 500 ms windows: -17 dB at 4 s, -36 dB at 12.5 s, silent by 14 s). The viewer plays this whole
// file from R - 1 s when it is there, so the intro ends on the game's own decay.

const (
	// introThemeMedia is the theme's media id (sb_130_mus_multiplayer_global, 16 s, 4 channels).
	introThemeMedia = 402178411
	// introThemeBank is the tag of the bank that names it.
	introThemeBank = 0x69327a6f
)

// SilentNoIntro records an install whose bank does not hold the theme.
const SilentNoIntro = "intro_missing"

// intro extracts the theme into the manifest; an install without it keeps the shipped excerpt.
func (b *builder) intro() error {
	bk, err := b.media.Bank(introThemeBank)
	if err != nil {
		b.res.Silent[SilentNoIntro] = append(b.res.Silent[SilentNoIntro], "bank")
		return nil //nolint:nilerr // an install without the bank keeps the shipped excerpt
	}
	t, ok, err := b.extract(bk, introThemeMedia)
	if err != nil {
		b.res.Silent[SilentNoIntro] = append(b.res.Silent[SilentNoIntro], err.Error())
		return nil //nolint:nilerr // same: the excerpt stays
	}
	if ok {
		b.res.Manifest.Intro = &t
	}
	return nil
}
