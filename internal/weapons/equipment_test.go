package weapons

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/refdata"
)

// TestPlanEquipment: every manifest object is built under its GlobalID; only a family named by
// one object gets a family -> key entry.
func TestPlanEquipment(t *testing.T) {
	plan := planEquipment(map[uint32]string{
		0xe7be9f5c: "powerup_camo",
		0x8c77ffe7: "grapple",
		0x273fe0eb: "grapple",
	})
	if want := []string{"273fe0eb", "8c77ffe7", "e7be9f5c"}; !slices.Equal(plan.Keys, want) {
		t.Fatalf("keys %v, want %v", plan.Keys, want)
	}
	if len(plan.FamilyOf) != 1 || plan.FamilyOf["e7be9f5c"] != "powerup_camo" {
		t.Fatalf("families %v, want only e7be9f5c -> powerup_camo", plan.FamilyOf)
	}
}

// TestPlanEquipmentPowerups: the title's manifest names each power-up a pad publishes by a single
// object, so each has a model key.
func TestPlanEquipmentPowerups(t *testing.T) {
	plan := planEquipment(refdata.Labels().EquipmentFamilies)
	byFamily := map[string]string{}
	for key, family := range plan.FamilyOf {
		byFamily[family] = key
	}
	for family, key := range map[string]string{"powerup_camo": "e7be9f5c", "powerup_overshield": "b781197a"} {
		if byFamily[family] != key {
			t.Errorf("%s -> %q, want %q", family, byFamily[family], key)
		}
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
