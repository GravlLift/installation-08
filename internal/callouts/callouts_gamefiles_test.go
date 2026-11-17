// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build gamefiles

package callouts

import (
	"encoding/json"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// TestRechargeFromTheInstalledGame reads Recharge's (sgh_blueprint) named areas: 24 named
// locations in its level tag, all shaped and named (measured 2026-11-15), Overhang among them.
func TestRechargeFromTheInstalledGame(t *testing.T) {
	root, err := himap.DeployRoot()
	if err != nil {
		t.Skipf("no installed game: %v", err)
	}
	c := &Cache{GameRoot: func() (string, error) { return root, nil }}
	s, err := c.Native("sgh_blueprint")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(s)
	t.Logf("%d zones, %d bytes of JSON", len(s.Zones), len(raw))
	if len(s.Zones) != 24 {
		t.Fatalf("%d zones, want 24", len(s.Zones))
	}
	for _, z := range s.Zones {
		if z.EN == "Overhang" {
			if z.ZBottom != 4.31 || z.ZTop != 6.31 || len(z.Polygon) != 6 {
				t.Errorf("overhang %+v", z)
			}
			return
		}
	}
	t.Error("no Overhang")
}
