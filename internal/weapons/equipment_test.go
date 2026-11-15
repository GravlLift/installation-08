package weapons

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"slices"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/refdata"
)

// TestPlanEquipment: every manifest object is built under its GlobalID, deployed ones included;
// each family lists its pickup objects in key order, a deployed object never.
func TestPlanEquipment(t *testing.T) {
	plan := planEquipment(map[uint32]string{
		0xe7be9f5c: "powerup_camo",
		0x8c77ffe7: "grapple",
		0x273fe0eb: "grapple",
		0x528fce46: "wall",
		0x2974c233: "wall",
	}, map[uint32]bool{0x528fce46: true})
	if want := []string{"273fe0eb", "2974c233", "528fce46", "8c77ffe7", "e7be9f5c"}; !slices.Equal(plan.Keys, want) {
		t.Fatalf("keys %v, want %v", plan.Keys, want)
	}
	want := map[string][]string{
		"powerup_camo": {"e7be9f5c"},
		"grapple":      {"273fe0eb", "8c77ffe7"},
		"wall":         {"2974c233"},
	}
	if len(plan.Families) != len(want) {
		t.Fatalf("families %v, want %v", plan.Families, want)
	}
	for family, keys := range want {
		if !slices.Equal(plan.Families[family], keys) {
			t.Errorf("%s: %v, want %v", family, plan.Families[family], keys)
		}
	}
}

// TestEquipmentFamilies: a family maps to its lowest built key when its built objects print the
// same; it is left out when they differ or none was built.
func TestEquipmentFamilies(t *testing.T) {
	a, b := [sha256.Size]byte{1}, [sha256.Size]byte{2}
	got := equipmentFamilies(context.Background(), map[string][]string{
		"grapple":  {"273fe0eb", "8c77ffe7"}, // same model
		"sensor":   {"72199cba", "72b63d69"}, // different models
		"thruster": {"430dda48", "eef5d48d"}, // only the second built
		"missing":  {"00000001"},             // nothing built
	}, map[string][sha256.Size]byte{
		"273fe0eb": a, "8c77ffe7": a,
		"72199cba": a, "72b63d69": b,
		"eef5d48d": b,
	})
	want := map[string]string{"grapple": "273fe0eb", "thruster": "eef5d48d"}
	if len(got) != len(want) {
		t.Fatalf("families %v, want %v", got, want)
	}
	for family, key := range want {
		if got[family] != key {
			t.Errorf("%s -> %q, want %q", family, got[family], key)
		}
	}
}

// TestEquipmentPrint: two objects of the same model print the same once their own key is taken
// out of the extras; another model prints differently.
func TestEquipmentPrint(t *testing.T) {
	glb := func(key, body string) []byte {
		return []byte(`{"asset":{"extras":{"axes":"x","eqip":"` + key + `"}}}` + body)
	}
	if equipmentPrint("273fe0eb", glb("273fe0eb", "mesh")) != equipmentPrint("8c77ffe7", glb("8c77ffe7", "mesh")) {
		t.Fatal("same model, different prints")
	}
	if equipmentPrint("273fe0eb", glb("273fe0eb", "mesh")) == equipmentPrint("8c77ffe7", glb("8c77ffe7", "other")) {
		t.Fatal("different models, same print")
	}
}

// TestPlanEquipmentPadItems: every item a power-up or equipment pad publishes by family has
// pickup objects in the title's manifest; the deployed wall panels are not among the wall's.
func TestPlanEquipmentPadItems(t *testing.T) {
	labels := refdata.Labels()
	plan := planEquipment(labels.EquipmentFamilies, labels.DeployedEquipment)
	for family, keys := range map[string][]string{
		"powerup_camo":        {"e7be9f5c"},
		"powerup_overshield":  {"b781197a"},
		"repulsor":            {"7ca85adc"},
		"translocator_beacon": {"730dc70f"},
		"grapple":             {"273fe0eb", "8c77ffe7"},
		"wall":                {"2974c233", "8e2dc574"},
		"sensor":              {"72199cba", "72b63d69"},
		"thruster":            {"430dda48", "eef5d48d"},
	} {
		if !slices.Equal(plan.Families[family], keys) {
			t.Errorf("%s: %v, want %v", family, plan.Families[family], keys)
		}
	}
}

// TestIndexEquipmentRule: an index whose equipment table predates the current rule is stale.
func TestIndexEquipmentRule(t *testing.T) {
	old := `{"reticle_ranges":{},"banners":{},"equipment":{"repulsor":"7ca85adc"}}`
	if IndexCurrent([]byte(old)) {
		t.Fatal("an index without equipment_rule is current")
	}
	raw, err := json.Marshal(NewIndex(nil, "test"))
	if err != nil {
		t.Fatal(err)
	}
	if !IndexCurrent(raw) {
		t.Fatalf("a new index is stale: %s", raw)
	}
}

// TestIndexEquipmentField: the field is written, empty included.
func TestIndexEquipmentField(t *testing.T) {
	raw, err := json.Marshal(NewIndex(nil, "test"))
	if err != nil {
		t.Fatal(err)
	}
	var back map[string]json.RawMessage
	if err := json.Unmarshal(raw, &back); err != nil || string(back["equipment"]) != "{}" {
		t.Fatalf("index %s: equipment field %q", raw, back["equipment"])
	}
}
