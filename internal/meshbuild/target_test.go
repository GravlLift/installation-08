package meshbuild

import (
	"strings"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/mapref"
)

// TestGeometryOverride: Live Fire keeps its geometry in the shared module, other maps in their
// own (real embedded data: sgh_interlock is the one native map with a deported module).
func TestGeometryOverride(t *testing.T) {
	if m, err := mapref.GeometryOverride("sgh_interlock"); err != nil || !strings.HasSuffix(m, "common-rtx-new.module") {
		t.Errorf("sgh_interlock: %q, %v", m, err)
	}
	if m, err := mapref.GeometryOverride("sgh_blueprint"); err != nil || m != "" {
		t.Errorf("sgh_blueprint: %q, %v", m, err)
	}
}

// TestAnchorsCoverTheBake: for every published native background, the anchors this tool
// recovers from the embedded reference data are at least as many as the background's own bake
// recorded (stats.anchors, resolved from the map variant repository at bake time). Fewer anchors
// could mean a different bsp; more is fine (a map's ranked and unranked variants share most of
// their objectives).
func TestAnchorsCoverTheBake(t *testing.T) {
	catalog, err := mapref.LoadObjectives()
	if err != nil {
		t.Fatal(err)
	}
	keys, err := mapref.BackgroundKeys()
	if err != nil {
		t.Fatal(err)
	}
	native := 0
	for _, key := range keys {
		background, err := mapref.LoadBackground(key)
		if err != nil {
			t.Fatalf("%s: %v", key, err)
		}
		if IsForge(background.Module) || background.Stats.Anchors == 0 {
			continue
		}
		native++
		if n := len(anchorsFor(background.MapNames, catalog)); n < background.Stats.Anchors {
			t.Errorf("%s: found %d anchors, the background's own bake has %d", background.Module, n, background.Stats.Anchors)
		}
	}
	if native == 0 {
		t.Fatal("no native background read: this test watches nothing")
	}
	t.Logf("%d native backgrounds covered", native)
}
