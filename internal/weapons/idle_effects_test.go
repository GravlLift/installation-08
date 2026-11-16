package weapons

import (
	"encoding/json"
	"strconv"
	"testing"
)

func TestEffectFile(t *testing.T) {
	for name, want := range map[string]bool{
		"fx-a119e9dd.png": true, "fx-3c8e80bc.bin": true,
		"fx-a119e9dd.glb": false, "fx-A119E9DD.png": false, "fx-a119e9d.png": false,
		"banner-a119e9dd-cloth.png": false, "../fx-a119e9dd.png": false,
	} {
		if got := EffectFile(name); got != want {
			t.Errorf("EffectFile(%q) = %v, want %v", name, got, want)
		}
	}
}

// TestIndexStaleWithoutIdleEffects: an index of the current schema without idle_effects predates
// the field and is stale; a new index (the field empty) is current.
func TestIndexStaleWithoutIdleEffects(t *testing.T) {
	old := `{"schema":` + strconv.Itoa(SchemaCurrent) + `,"reticle_ranges":{},"banners":{},"equipment":{},"equipment_rule":` +
		strconv.Itoa(EquipmentRuleCurrent) + `}`
	if IndexCurrent([]byte(old)) {
		t.Fatal("an index without idle_effects is current")
	}
	raw, err := json.Marshal(NewIndex(nil, "test"))
	if err != nil {
		t.Fatal(err)
	}
	if !IndexCurrent(raw) {
		t.Fatalf("a new index is stale: %s", raw)
	}
}

// TestFunctionName: the engine names the Shock Rifle's functions use resolve; another StringID is
// written as #<hex>.
func TestFunctionName(t *testing.T) {
	for v, want := range map[uint32]string{
		0x4e2fc981: "ready", 0x675ab858: "is_reloading", 0x90c79b38: "primary_ammunition", 0x734ac9f4: "camo",
		0xa4878874: "fx_ready", 0x0fe77f9b: "fx_reloading", 0x822d49f9: "fx_ammo", 0x118a9c27: "#118a9c27", 0: "",
	} {
		if got := functionName(v); got != want {
			t.Errorf("functionName(%08x) = %q, want %q", v, got, want)
		}
	}
}
