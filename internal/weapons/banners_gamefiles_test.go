//go:build gamefiles

package weapons

// banners_gamefiles_test.go — the CTF flag's team banner, read from the installed game.

import (
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// flagKey is the CTF flag's `weap` family.
const flagKey = "2a392328"

// TestFlagBannerFromGame — the flag attaches a banner: its cloth quad (twice 0.125 x 1.5 by twice
// 0.125 x 1.125, anchored at its edge), an emblem per team (8 layers: one per team designator)
// moved 0.175 across to the cloth's middle, at the team marker near the top of the pole; an
// ordinary weapon has none.
func TestFlagBannerFromGame(t *testing.T) {
	root, err := himap.DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	module := filepath.Join(root, "pc", "levels", "multi", "ctf_aquarius", "ctf_aquarius-rtx-new.module")
	if _, err := os.Stat(module); err != nil {
		t.Skip(err)
	}
	a, err := himap.OuvreArsenal(root, module)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = a.Close() }()
	paths, err := himap.GeometrySearchPathMonde(root, module)
	if err != nil {
		t.Fatal(err)
	}
	ix, err := himap.NewModuleIndex(paths...)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = ix.Close() }()
	dir := t.TempDir()
	b, ok, err := bannerOfKey(a, ix, flagKey, dir)
	if err != nil || !ok {
		t.Fatalf("flag banner: ok=%v err=%v", ok, err)
	}
	t.Logf("banner %+v emblem %+v", b, *b.Emblem)
	near := func(got, want float64) bool { return math.Abs(got-want) < 1e-4 }
	if !near(b.Cloth.Width, 0.375) || !near(b.Cloth.Height, 0.28125) || !near(b.Cloth.Pivot[0], -0.475) || b.Cloth.Additive {
		t.Errorf("cloth = %+v", b.Cloth)
	}
	if b.Emblem == nil || len(b.Emblem.Files) != 8 || !b.Emblem.Additive {
		t.Fatalf("emblem = %+v", b.Emblem)
	}
	if b.Emblem.Offset != [3]float64{0, -0.01, -0.175} || b.Emblem.Across != [3]float64{0, 0, -1} {
		t.Errorf("emblem offset %v across %v", b.Emblem.Offset, b.Emblem.Across)
	}
	if !near(b.Marker[1], 0.553963) {
		t.Errorf("marker = %v, want the pole-top team marker", b.Marker)
	}
	for _, f := range append(b.Cloth.Files, b.Emblem.Files...) {
		if _, err := os.Stat(filepath.Join(dir, f)); err != nil {
			t.Errorf("image %s: %v", f, err)
		}
	}
	if _, ok, _ := bannerOfKey(a, ix, "2b1824d5", t.TempDir()); ok {
		t.Error("an ordinary weapon reported a banner")
	}
}
