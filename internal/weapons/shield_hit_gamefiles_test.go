// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build gamefiles

package weapons

// shield_hit_gamefiles_test.go — the Spartan shield's impact generator, read from the installed
// game into the library entry the view draws.

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

func TestShieldHitFromGame(t *testing.T) {
	root, err := himap.DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	module := filepath.Join(root, "pc", "levels", "multi", "sgh_blueprint", "sgh_blueprint-rtx-new.module")
	if _, err := os.Stat(module); err != nil {
		t.Skip(err)
	}
	a, err := himap.OuvreArsenal(root, module)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = a.Close() }()
	dir := t.TempDir()
	g, err := readShieldHit(context.Background(), a, root, module, dir)
	if err != nil || g == nil {
		t.Fatalf("shield hit: %+v, %v", g, err)
	}
	if g.Generator != "70e04608" || !g.Additive || g.HitColorMode != 3 || g.UseHitBlob {
		t.Errorf("generator %+v", g)
	}
	if g.HitIntensity.Input != "impactTime" || g.EdgeGlowIntensity.Constant == nil || *g.EdgeGlowIntensity.Constant != 0 {
		t.Errorf("properties: hit %+v, edge %+v", g.HitIntensity, g.EdgeGlowIntensity)
	}
	in, rad := g.HitIntensity.Curve, g.HitRadius.Curve
	if in == nil || rad == nil || g.InverseHitTime != 1 {
		t.Fatalf("curves: intensity %+v, radius %+v, inverse hit time %g", in, rad, g.InverseHitTime)
	}
	if got := curveAt(in, 0); got != 90 {
		t.Errorf("intensity at impact %g, want 90", got)
	}
	if got := curveAt(in, 1); got > 1e-3 {
		t.Errorf("intensity at 1 s %g, want 0", got)
	}
	if got := curveAt(rad, 0); got < 0.0999 || got > 0.1001 {
		t.Errorf("radius at impact %g, want 0.1", got)
	}
	if got := curveAt(rad, 1); got < 0.0499 || got > 0.0501 {
		t.Errorf("radius at 1 s %g, want 0.05", got)
	}
	if g.PlasmaTileScale != 2 || g.PlasmaScrollSpeed != 0.1 || g.EdgeInnerFadeRadius != 0.75 {
		t.Errorf("parameters %+v", g)
	}
	if g.Noise1.File != "fx-83a84c7e.png" || !g.Noise1.SRGB || g.Noise2.File != "fx-00003b45.png" || g.HitBlob.File != "fx-00002520.png" {
		t.Errorf("textures %+v %+v %+v", g.Noise1, g.Noise2, g.HitBlob)
	}
	for _, tx := range []GeneratorTexture{g.Noise1, g.Noise2, g.HitBlob} {
		if _, err := os.Stat(filepath.Join(dir, tx.File)); err != nil {
			t.Errorf("%s: %v", tx.File, err)
		}
	}
}
