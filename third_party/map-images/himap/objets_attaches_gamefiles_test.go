// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build gamefiles

// LOCAL-CHANGE (infinite-theater-3d): ported from The Library with objets_attaches.go.

package himap

import (
	"context"
	"testing"
)

// TestMachineSansSectionsPoseSesAttaches: the BTB weapon pod mover (machine b5683e48 of kit
// 26c22119), whose `mode` 37406072 has no section, draws as kit pieces the two `bloc` objects its
// model variant attaches (42207405 and 9938e34e), each with meshes. Read-only on the default and
// Forge modules.
func TestMachineSansSectionsPoseSesAttaches(t *testing.T) {
	racine, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	chemins, err := GeometrySearchPathMonde(racine, "")
	if err != nil {
		t.Fatal(err)
	}
	idx, err := NewModuleIndex(chemins[1:]...)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = idx.Close() }()
	ctx := context.Background()
	const machine = 0xb5683e48
	o := objetKit{ref: machine, groupe: GroupeMachine, pose: Instance{Scale: [3]float64{1, 1, 1},
		Forward: [3]float64{1, 0, 0}, Left: [3]float64{0, 1, 0}, Up: [3]float64{0, 0, 1}}}
	assets := map[uint32]*RuntimeGeoAsset{}
	if modeleObjetKit(ctx, idx, o, assets) != nil {
		t.Fatal("the machine's own model opened: its mode was expected to have no section")
	}
	pieces := modelesObjetKit(ctx, idx, o, assets)
	if len(pieces) != 2 {
		t.Fatalf("%d pieces, want the 2 attached `bloc` objects", len(pieces))
	}
	vertices, triangles := 0, 0
	for i, p := range pieces {
		if len(p.mv.maillages) == 0 {
			t.Errorf("piece %d has no mesh", i)
		}
		for _, k := range p.mv.maillages {
			if m := p.mv.asset.Mesh(k); m != nil {
				vertices, triangles = vertices+len(m.Vertices), triangles+len(m.Triangles)
			}
		}
	}
	t.Logf("machine %08x: %d pieces, %d vertices, %d triangles", machine, len(pieces), vertices, triangles)
	if triangles == 0 {
		t.Error("the attached pieces draw no triangle")
	}
}
