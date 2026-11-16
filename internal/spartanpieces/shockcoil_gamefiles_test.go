//go:build gamefiles

package spartanpieces

// shockcoil_gamefiles_test.go — where the Shock Rifle's coil light comes from, read on the
// game's own coating reference (IT3D_EKUR_DIR).
//
// The coil inside the barrel housing is material c56eb325 (hinf_shock_rifle, model families
// 1a22fee6 and 9387a8b9; the first-person rigs carry the same material id). Its shader is the
// layered hard-surface 4dac018a, with no self-light of its own (Ekur: illum_info null; the
// material reader finds no emissive parameter). The glow is in its paint: the seventh zone
// (mask 1 blue) names intention 46ec02bd, and the list's default style 328bf027 resolves that
// intention (through the any-region 0b7e328b; the coil's own region 3abaa00a does not name it)
// to a blue swatch whose emissive amount is 6. The viewer's paint shader (armorMaterial3d.ts)
// lights each zone at its color times that amount, blended by the zone's mask.

import (
	"math"
	"os"
	"testing"
)

func TestShockRifleCoilGlowSwatch(t *testing.T) {
	folder := os.Getenv(EkurEnv)
	if folder == "" || !EkurValid(folder) {
		t.Skipf("%s unset or not an Ekur export", EkurEnv)
	}
	r := ekurRef{folder: folder}
	m, err := r.material(0xc56eb325)
	if err != nil {
		t.Fatal(err)
	}
	if m.StyleInfo == nil {
		t.Fatal("coil material without style")
	}
	st := styleOf(*m.StyleInfo)
	if st.List != "eaf484fa" || st.Region != "3abaa00a" || st.LayerCount != 7 {
		t.Fatalf("coil style: %+v", st)
	}
	const glowIntention, anyRegion = "46ec02bd", RegionCommon
	if st.Intentions[6] != glowIntention {
		t.Fatalf("coil zone 7 intention %s, want %s", st.Intentions[6], glowIntention)
	}
	l, err := r.list(st.List)
	if err != nil {
		t.Fatal(err)
	}
	key, old, err := referenceStyle(l.DefaultStyle.Reference)
	if err != nil || key != "328bf027" || old {
		t.Fatalf("default style %q -> %s old=%v err=%v", l.DefaultStyle.Reference, key, old, err)
	}
	raw, err := r.style(l.DefaultStyle.Reference)
	if err != nil {
		t.Fatal(err)
	}
	style, err := coatingStyleOf(raw, old, map[uint32]bool{})
	if err != nil {
		t.Fatal(err)
	}
	if _, own := style.Regions[st.Region][glowIntention]; own {
		t.Fatalf("region %s names %s itself; the lookup order this test pins has changed", st.Region, glowIntention)
	}
	s, ok := style.Regions[anyRegion][glowIntention]
	if !ok || s.Disabled {
		t.Fatalf("any-region swatch %s: %+v", glowIntention, s)
	}
	if s.Emissive != 6 {
		t.Fatalf("coil emissive amount %v, want 6", s.Emissive)
	}
	near := func(a, b [3]float32) bool {
		for k := range a {
			if math.Abs(float64(a[k]-b[k])) > 1e-4 {
				return false
			}
		}
		return true
	}
	if !near(s.Top, [3]float32{0.3052, 0.4838, 0.8626}) || !near(s.Mid, [3]float32{0.1168, 0.4455, 0.9114}) ||
		!near(s.Bot, [3]float32{0.1795, 0.4542, 0.9114}) {
		t.Fatalf("coil swatch colors top %v mid %v bot %v", s.Top, s.Mid, s.Bot)
	}
}
