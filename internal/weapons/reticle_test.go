package weapons

import (
	"encoding/json"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"
)

// TestReticleRangeOf — the index entry of a weapon: its unscoped autoaim range, per zoom level
// that range times the level's magnification (unchanged when the tag does not scale it), and the
// tag's own magnifications carried next to it; no entry for a weapon whose tag gives no range.
func TestReticleRangeOf(t *testing.T) {
	r, ok := reticleRangeOf(weaponicons.AimAssist{AutoaimRange: 17, Magnifications: []float64{4, 9}, ScalesWithZoom: true})
	if !ok || r.Unscoped != 17 || len(r.Zoomed) != 2 || r.Zoomed[0] != 68 || r.Zoomed[1] != 153 ||
		len(r.Magnifications) != 2 || r.Magnifications[0] != 4 || r.Magnifications[1] != 9 {
		t.Fatalf("scaled zoom: %+v, %v", r, ok)
	}
	r, ok = reticleRangeOf(weaponicons.AimAssist{AutoaimRange: 18, Magnifications: []float64{2}})
	if !ok || len(r.Zoomed) != 1 || r.Zoomed[0] != 18 || len(r.Magnifications) != 1 || r.Magnifications[0] != 2 {
		t.Fatalf("unscaled zoom: %+v, %v", r, ok)
	}
	r, ok = reticleRangeOf(weaponicons.AimAssist{AutoaimRange: float64(float32(0.85)), ScalesWithZoom: true})
	if !ok || r.Unscoped != 0.85 || r.Zoomed == nil || len(r.Zoomed) != 0 || r.Magnifications != nil || len(r.Magnifications) != 0 {
		t.Fatalf("no zoom: %+v, %v (want 0.85 rounded and empty zoom and magnification lists)", r, ok)
	}
	if _, ok := reticleRangeOf(weaponicons.AimAssist{ScalesWithZoom: true, Magnifications: []float64{2}}); ok {
		t.Fatal("no autoaim range: want no entry")
	}
}

// TestIndexReticleRanges — a new index reads as current; an index written before the field or
// before its magnifications existed reads as stale (it is rebuilt to add them).
func TestIndexReticleRanges(t *testing.T) {
	raw, err := json.Marshal(NewIndex([]string{"2b1824d5"}, "test"))
	if err != nil {
		t.Fatal(err)
	}
	if !IndexHasReticleRanges(raw) {
		t.Fatalf("new index %s: field missing", raw)
	}
	for _, old := range []string{
		`{"schema":1,"weapons":["2b1824d5"]}`,
		`{"reticle_ranges":{"2b1824d5":{"unscoped":18,"zoomed":[36]}}}`, // no magnifications yet
		`not json`,
	} {
		if IndexHasReticleRanges([]byte(old)) {
			t.Errorf("%s: reported current", old)
		}
	}
	idx := NewIndex(nil, "test")
	idx.ReticleRanges["2b1824d5"] = ReticleRange{Unscoped: 18, Zoomed: []float64{36}, Magnifications: []float64{2}}
	raw, _ = json.Marshal(idx)
	if !IndexHasReticleRanges(raw) {
		t.Fatalf("index with magnifications %s: reported stale", raw)
	}
	var back struct {
		R map[string]ReticleRange `json:"reticle_ranges"`
	}
	if err := json.Unmarshal(raw, &back); err != nil || back.R["2b1824d5"].Zoomed[0] != 36 || back.R["2b1824d5"].Magnifications[0] != 2 {
		t.Fatalf("round trip: %s, %v", raw, err)
	}
}
