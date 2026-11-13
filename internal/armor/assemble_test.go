package armor

import (
	"errors"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
)

func TestAssembleSelectionOrder(t *testing.T) {
	c := &haloapi.ArmorCustomizationDTO{
		CoreID: "core", ThemePath: "theme.json", HelmetPath: "helmet.json",
		ChestAttachmentPath: "chest.json", CoatingPath: "coat.json",
		Body: haloapi.SpartanBodyDTO{BodyType: "Large", RightArm: "Transfemoral"},
	}
	files := Files{
		Theme: &haloapi.ArmorThemeDTO{
			ID: "t", TagID: 7,
			Base:      []haloapi.ArmorRegionDTO{{RegionID: 1, PermutationID: 2}, {RegionID: 3, PermutationID: 4}},
			BodyLarge: []haloapi.ArmorRegionDTO{{RegionID: 3, PermutationID: 40}},
			RightArm:  haloapi.ProstheticOverridesDTO{Full: []haloapi.ArmorRegionDTO{{RegionID: 5, PermutationID: 6}}},
		},
		Items: map[string]*haloapi.ArmorItemDTO{
			"helmet.json": {RegionData: []haloapi.ArmorRegionDTO{{RegionID: 1, PermutationID: 20}}},
			"chest.json":  {TagID: 99, MeshIndex: func() *int { v := 3; return &v }()},
			"coat.json":   {StyleID: func() *haloapi.StringID { v := haloapi.StringID(42); return &v }()},
		},
	}
	m, err := Assemble(c, files)
	if err != nil {
		t.Fatal(err)
	}
	want := map[haloapi.StringID]struct {
		perm int32
		src  string
	}{
		1: {20, "helmet"},    // the piece wins over the theme base
		3: {40, "body_type"}, // the body size wins over the piece order
		5: {6, "prosthetic_right_arm"},
	}
	if len(m.Regions) != len(want) {
		t.Fatalf("regions: %+v", m.Regions)
	}
	for _, r := range m.Regions {
		w, ok := want[haloapi.StringID(r.Region)]
		if !ok || r.Permutation != w.perm || r.Source != w.src {
			t.Fatalf("region %d: %+v", r.Region, r)
		}
	}
	if len(m.Unresolved) != 0 {
		t.Fatalf("unresolved: %v", m.Unresolved)
	}
	if len(m.Attachments) != 1 || m.Attachments[0].Slot != "chest_attachment" ||
		m.Attachments[0].TagID == nil || *m.Attachments[0].TagID != 99 ||
		m.Attachments[0].TagKey != "00000063" || m.Attachments[0].MeshIndex == nil {
		t.Fatalf("attachments: %+v", m.Attachments)
	}
	if m.Coating == nil || m.Coating.StyleID == nil || *m.Coating.StyleID != 42 {
		t.Fatalf("coating: %+v", m.Coating)
	}
	// The geometry hash is shared with the same geometry under another
	// coating, and differs when a region permutation changes.
	c2 := *c
	c2.CoatingPath = "other-coat.json"
	files2 := files
	files2.Items = map[string]*haloapi.ArmorItemDTO{"helmet.json": files.Items["helmet.json"], "chest.json": files.Items["chest.json"]}
	m2, err := Assemble(&c2, files2)
	if err != nil {
		t.Fatal(err)
	}
	if m2.ConfigHash != m.ConfigHash {
		t.Fatalf("hash not shared: %s vs %s", m.ConfigHash, m2.ConfigHash)
	}
	files3 := files
	files3.Items = map[string]*haloapi.ArmorItemDTO{
		"helmet.json": {RegionData: []haloapi.ArmorRegionDTO{{RegionID: 1, PermutationID: 21}}},
	}
	m3, err := Assemble(c, files3)
	if err != nil {
		t.Fatal(err)
	}
	if m3.ConfigHash == m.ConfigHash {
		t.Fatal("hash unchanged after a region permutation change")
	}
	if _, err = Assemble(nil, files); !errors.Is(err, ErrThemeMissing) {
		t.Fatalf("expected ErrThemeMissing, got %v", err)
	}
	if _, err = Assemble(c, Files{Items: files.Items}); !errors.Is(err, ErrThemeMissing) {
		t.Fatalf("expected ErrThemeMissing, got %v", err)
	}
}
