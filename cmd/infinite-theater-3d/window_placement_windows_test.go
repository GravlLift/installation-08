//go:build windows

package main

import (
	"encoding/json"
	"testing"
)

// TestPlacementFromDataRoundTrip — a placement survives the JSON trip: the saved bytes
// load back to the same placement when the monitor contains it.
func TestPlacementFromDataRoundTrip(t *testing.T) {
	p := windowPlacement{X: 100, Y: 50, Width: 1280, Height: 760, Maximized: false}
	data, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got, ok := placementFromData(data, func(left, top, right, bottom int) bool { return true })
	if !ok {
		t.Fatalf("round trip: ok = false, want true")
	}
	if got != p {
		t.Errorf("round trip: got %+v, want %+v", got, p)
	}
}

// TestPlacementFromDataOffScreen — a placement whose rect is on no connected monitor
// falls back (ok=false), as do a zero rect and a corrupt file; a contained placement
// loads.
func TestPlacementFromDataOffScreen(t *testing.T) {
	p := windowPlacement{X: 3000, Y: 2000, Width: 1280, Height: 760}
	data, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	// A monitor covering only the primary work area: the off-screen rect is outside it.
	containsPrimary := func(left, top, right, bottom int) bool {
		return left >= 0 && top >= 0 && right <= 2000 && bottom <= 1400
	}
	if _, ok := placementFromData(data, containsPrimary); ok {
		t.Errorf("off-screen placement loaded, want the fallback")
	}
	// The same rect on a monitor that contains it loads.
	if _, ok := placementFromData(data, func(l, t, r, b int) bool { return true }); !ok {
		t.Errorf("on-screen placement did not load")
	}
	// A zero rect is unusable even where a monitor "contains" it.
	if _, ok := placementFromData([]byte(`{"x":0,"y":0,"width":0,"height":0}`), func(l, t, r, b int) bool { return true }); ok {
		t.Errorf("zero placement loaded, want the fallback")
	}
	// A corrupt file is the fallback.
	if _, ok := placementFromData([]byte(`{not json`), func(l, t, r, b int) bool { return true }); ok {
		t.Errorf("corrupt placement loaded, want the fallback")
	}
}
