// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weapons

// banners_test.go — the banner images the weapon route serves, and the axis change of the read
// banner values (the reading itself is covered on the installed game, banners_gamefiles_test.go).

import (
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

func TestBannerFile(t *testing.T) {
	for name, want := range map[string]bool{
		"banner-2a392328-cloth.png":    true,
		"banner-2a392328-emblem0.png":  true,
		"banner-2a392328-emblem12.png": true,
		"banner-2a392328-emblem.png":   false,
		"banner-2A392328-cloth.png":    false,
		"banner-2a392328-cloth.glb":    false,
		"../banner-2a392328-cloth.png": false,
		"2a392328.glb":                 false,
	} {
		if got := BannerFile(name); got != want {
			t.Errorf("BannerFile(%q) = %v, want %v", name, got, want)
		}
	}
}

// TestBannerLayerAxes — a layer read in Halo axes (x forward, y left, z up) lands in the GLB's
// axes (x, z, -y): the emblem moved 0.175 along the marker's +Y runs along -Z, as does Across.
func TestBannerLayerAxes(t *testing.T) {
	l := layerOf(himap.CoucheBanniere{
		Largeur: 0.2, Hauteur: 0.2, Decalage: [3]float64{0, 0.175, -0.01}, Alpha: 0.5, Additif: true,
	}, []string{"banner-2a392328-emblem0.png"})
	if l.Offset != [3]float64{0, -0.01, -0.175} {
		t.Errorf("offset = %v", l.Offset)
	}
	if l.Across != [3]float64{0, 0, -1} {
		t.Errorf("across = %v", l.Across)
	}
	if got := gltfOf([3]float64{0.0037, 0, 0.554}); got[2] != 0 || got[1] != 0.554 {
		t.Errorf("marker = %v, want no negated zero and the height on Y", got)
	}
}
