package meshbuild

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
	"github.com/JGtm/halo-infinite-map-images/himap"
)

// TestIsForgeCanvas: the eight installed canvases are Forge canvases; a native module and a map
// asset id are not.
func TestIsForgeCanvas(t *testing.T) {
	for _, c := range []string{himap.CanevasAcademy, himap.CanevasBlank, himap.CanevasFrost, himap.CanevasDeadland} {
		if !IsForgeCanvas(c) {
			t.Errorf("%s not a canvas", c)
		}
	}
	for _, k := range []string{"sgh_blueprint", "0d1c9255-d912-416c-befc-5f3e5e176df2", ""} {
		if IsForgeCanvas(k) {
			t.Errorf("%q taken for a canvas", k)
		}
	}
}

// TestResolveForgeTarget: the variant's level_id names its canvas, its objectives (deduplicated)
// are the anchors, and the frame is their box widened by himap.MargeCadreAncres.
func TestResolveForgeTarget(t *testing.T) {
	levels := t.TempDir()
	canvas := himap.CanevasAcademy
	if err := os.MkdirAll(filepath.Join(levels, canvas), 0o755); err != nil {
		t.Fatal(err)
	}
	module := filepath.Join(levels, canvas, canvas+"-rtx-new.module")
	if err := os.WriteFile(module, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	flag := []int32{mapvar.LabelHash("ctf_include"), mapvar.LabelHash("strongholds_zone")}
	v := &mapvar.Variant{LevelID: 1437677928, Objects: []mapvar.Object{
		{Pos: mapvar.Vec3{X: 10, Y: -20, Z: 3}, Labels: []int32{mapvar.LabelHash("strongholds_zone"), mapvar.LabelHash("strongholds_include")}},
		{Pos: mapvar.Vec3{X: 40, Y: 5, Z: 3}, Labels: flag},
		{Pos: mapvar.Vec3{X: 900, Y: 900, Z: 0}},
	}}
	target, err := ResolveForgeTarget("asset", []string{"Map"}, v, levels)
	if err != nil {
		t.Fatal(err)
	}
	if target.Module != module || target.MapModule != module || target.Key != "asset" {
		t.Errorf("target %+v", target)
	}
	if len(target.Anchors) != 2 {
		t.Fatalf("anchors %v, want the two objectives once each", target.Anchors)
	}
	m := himap.MargeCadreAncres
	if want := [4]float64{10 - m, -20 - m, 40 + m, 5 + m}; target.Frame != want {
		t.Errorf("frame %v, want %v", target.Frame, want)
	}
	v.LevelID = 7
	if _, err := ResolveForgeTarget("asset", nil, v, levels); err == nil {
		t.Error("a level_id that names no canvas resolved")
	}
	v.LevelID = 1437677928
	v.Objects = v.Objects[2:]
	if _, err := ResolveForgeTarget("asset", nil, v, levels); err == nil {
		t.Error("a variant without objectives resolved")
	}
}
