// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package spartanpieces

import (
	"encoding/json"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

func TestFirstPersonArmIndex(t *testing.T) {
	r := &himap.Armurerie{Noms: []string{"arm"}, Regions: []himap.Region{{Name: 0x62059329}}}
	pieces := []PieceIndex{{Key: "62059329-16a12dd4", Region: "62059329", Permutation: "16a12dd4", File: "piece-62059329-16a12dd4.glb", Triangles: 3}}
	raw, err := json.Marshal(firstPersonArmIndex(r, pieces, []FailureIndex{}))
	if err != nil {
		t.Fatal(err)
	}
	var got armIndex
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got.Schema != SchemaPieces ||got.Skeleton.Bones[0] != "arm" || len(got.Pieces) != 1 || got.Pieces[0] != pieces[0] || got.Default["62059329"] != "13d24f1f" || got.Failures == nil {
		t.Fatalf("arm catalog: %s", raw)
	}
}
