//go:build gamefiles

package firstperson

// effectmarkers_gamefiles_test.go — the Shock Rifle's idle-effect markers on its first-person rig.

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// TestShockEffectMarkersFromGame — the three locations its idle effect emits at (the arcs' and
// shell's, the bolts', the muzzle's), each on the weapon's root bone, in GLB axes (the rig's bone
// frames are the nodes' turned by the axis change).
func TestShockEffectMarkersFromGame(t *testing.T) {
	root, err := himap.DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	a, err := himap.OuvreArsenal(root, filepath.Join(root, "pc", "levels", "multi", "sgh_blueprint", "sgh_blueprint-rtx-new.module"))
	if err != nil {
		t.Skip(err)
	}
	defer func() { _ = a.Close() }()
	s, err := a.SourcesArme(0x1a22fee6)
	if err != nil {
		t.Fatal(err)
	}
	ms := effectMarkers(context.Background(), a, s)
	par := map[string]EffectMarker{}
	for _, m := range ms {
		par[m.Marker] = m
	}
	for name, x := range map[string]float32{"55990be4": 0.3058, "af9ed4c5": 0.1770} {
		m, ok := par[name]
		if !ok || m.Bone == "" || m.Position[0] < x-1e-3 || m.Position[0] > x+1e-3 || m.Position[1] < 0.043 || m.Position[1] > 0.045 {
			t.Errorf("marker %s = %+v (%v)", name, m, ok)
		}
	}
	t.Logf("markers %+v", ms)
}
