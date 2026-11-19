// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build windows

package main

import (
	"encoding/json"
	"testing"

	"golang.org/x/sys/windows"
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

// TestPlacementFromDataKeepsDPI — the DPI a placement was captured at survives the JSON
// round trip (needed for applyWindowPlacement's cross-DPI rescale), and an older save
// without the field (omitempty, so it is simply absent) loads with DPI 0, not an error.
func TestPlacementFromDataKeepsDPI(t *testing.T) {
	p := windowPlacement{X: 10, Y: 10, Width: 1600, Height: 900, DPI: 144}
	data, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got, ok := placementFromData(data, func(l, t, r, b int) bool { return true })
	if !ok || got.DPI != 144 {
		t.Fatalf("round trip: got %+v, ok=%v, want DPI 144", got, ok)
	}
	old := []byte(`{"x":10,"y":10,"width":1600,"height":900,"maximized":false}`)
	got2, ok := placementFromData(old, func(l, t, r, b int) bool { return true })
	if !ok || got2.DPI != 0 {
		t.Fatalf("placement without a dpi field: got %+v, ok=%v, want DPI 0", got2, ok)
	}
}

// TestScaleForDpi — a DIP measurement scales linearly with DPI (96 is the identity), with
// ordinary rounding, not truncation.
func TestScaleForDpi(t *testing.T) {
	cases := []struct {
		dip  int
		dpi  uint32
		want int
	}{
		{1600, 96, 1600},
		{1600, 192, 3200}, // 200%
		{1600, 144, 2400}, // 150%
		{900, 120, 1125},  // 125%
		{7, 96, 7},        // identity, odd value
		{1, 144, 2},       // 1 * 1.5 = 1.5, rounds up
	}
	for _, c := range cases {
		if got := scaleForDpi(c.dip, c.dpi); got != c.want {
			t.Errorf("scaleForDpi(%d, %d) = %d, want %d", c.dip, c.dpi, got, c.want)
		}
	}
}

// TestRescaleDimension — a dimension rescales proportionally between two known DPIs, and is
// left alone when either DPI is unknown (<= 0) or they are equal (the common case: nothing
// changed since the placement was saved).
func TestRescaleDimension(t *testing.T) {
	if got := rescaleDimension(1600, 96, 192); got != 3200 {
		t.Errorf("96 -> 192: got %d, want 3200", got)
	}
	if got := rescaleDimension(3200, 192, 96); got != 1600 {
		t.Errorf("192 -> 96: got %d, want 1600", got)
	}
	if got := rescaleDimension(1600, 96, 96); got != 1600 {
		t.Errorf("same DPI: got %d, want unchanged 1600", got)
	}
	if got := rescaleDimension(1600, 0, 192); got != 1600 {
		t.Errorf("unknown source DPI: got %d, want unchanged 1600", got)
	}
	if got := rescaleDimension(1600, 96, 0); got != 1600 {
		t.Errorf("unknown target DPI: got %d, want unchanged 1600", got)
	}
}

// TestDefaultPlacementForFits — when the 16:9 default (scaled to dpi, plus chrome) fits the
// monitor's work area outright, it is used unshrunk and centered on that work area.
func TestDefaultPlacementForFits(t *testing.T) {
	work := windows.Rect{Left: 0, Top: 0, Right: 3840, Bottom: 2160}
	got := defaultPlacementFor(144, 24, 92, work)
	want := windowPlacement{X: 468, Y: 224, Width: 2904, Height: 1712, DPI: 144}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	// 16:9, exactly: client (outer minus chrome) width*9 == height*16.
	clientW, clientH := got.Width-24, got.Height-92
	if clientW*9 != clientH*16 {
		t.Errorf("client %dx%d is not 16:9", clientW, clientH)
	}
}

// TestDefaultPlacementForShrinksWidthBound — a work area narrower (relative to its height)
// than 16:9 shrinks the default keeping 16:9, width-bound (the outer window's width lands
// exactly on the work area's).
func TestDefaultPlacementForShrinksWidthBound(t *testing.T) {
	work := windows.Rect{Left: 0, Top: 0, Right: 1280, Bottom: 1024}
	got := defaultPlacementFor(96, 16, 61, work)
	want := windowPlacement{X: 0, Y: 126, Width: 1280, Height: 772, DPI: 96}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	clientW, clientH := got.Width-16, got.Height-61
	if clientW*9 != clientH*16 {
		t.Errorf("client %dx%d is not 16:9", clientW, clientH)
	}
}

// TestDefaultPlacementForShrinksHeightBound — a work area shorter (relative to its width)
// than 16:9 shrinks the default keeping 16:9, height-bound.
func TestDefaultPlacementForShrinksHeightBound(t *testing.T) {
	work := windows.Rect{Left: 0, Top: 0, Right: 2000, Bottom: 700}
	got := defaultPlacementFor(96, 16, 61, work)
	want := windowPlacement{X: 424, Y: 0, Width: 1152, Height: 700, DPI: 96}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	clientW, clientH := got.Width-16, got.Height-61
	if clientW*9 != clientH*16 {
		t.Errorf("client %dx%d is not 16:9", clientW, clientH)
	}
}

// TestBelowMinimum — a remembered size under the minimum (the 553x543 window 0.1.0 saved,
// against a 1560x1030 minimum at 150 % scale) is below it; one at or above it is not; on a
// work area smaller than the minimum, filling the work area is enough.
func TestBelowMinimum(t *testing.T) {
	work := windows.Rect{Left: 0, Top: 0, Right: 3840, Bottom: 2100}
	if !belowMinimum(553, 543, 1560, 1030, work) {
		t.Errorf("553x543 not below a 1560x1030 minimum")
	}
	if !belowMinimum(1600, 900, 1560, 1030, work) {
		t.Errorf("1600x900 not below a 1560x1030 minimum (too short)")
	}
	if belowMinimum(1560, 1030, 1560, 1030, work) {
		t.Errorf("exactly the minimum counted as below it")
	}
	small := windows.Rect{Left: -1366, Top: 0, Right: 0, Bottom: 728}
	if belowMinimum(1366, 728, 1560, 1030, small) {
		t.Errorf("a window filling a small work area counted as below the minimum")
	}
}
