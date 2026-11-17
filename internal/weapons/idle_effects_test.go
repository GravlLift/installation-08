// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weapons

import (
	"encoding/hex"
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
		0x8fb04cfa: "fx_reload", 0xb2461bde: "fx_camo_off", 0xa0f2fb11: "animation_event_function_variant_switch", 0xe56b152f: "alt_fire",
	} {
		if got := functionName(v); got != want {
			t.Errorf("functionName(%08x) = %q, want %q", v, got, want)
		}
	}
}

// TestMappingOf: the identity 0..1 reads as no mapping; the Heatwave's `fx_camo_off` mapping
// (2ac9c2ff, function 10: a one-piece multi-spline, -x + 1) decodes to its line; an undecoded kind
// is reported.
func TestMappingOf(t *testing.T) {
	hexBytes := func(s string) []byte {
		b, err := hex.DecodeString(s)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	if m, ok := mappingOf(hexBytes("00340000000000000000803f0000000000000000000000000000000000000000")); m != nil || !ok {
		t.Errorf("identity: %+v, %v", m, ok)
	}
	if m, ok := mappingOf(nil); m != nil || !ok {
		t.Errorf("none: %+v, %v", m, ok)
	}
	m, ok := mappingOf(hexBytes("08340000000000000000803f00000000000000006f12833a77be7f3f14000000010000000400003fffff7f7f000080bf0000803f"))
	if !ok || m == nil || m.Type != 8 || m.Min != 0 || m.Max != 1 || len(m.Curves) != 1 || len(m.Curves[0]) != 1 ||
		len(m.Curves[0][0].Coefs) != 2 || m.Curves[0][0].Coefs[0] != -1 || m.Curves[0][0].Coefs[1] != 1 {
		t.Fatalf("fx_camo_off: %+v, %v", m, ok)
	}
	if _, ok := mappingOf(hexBytes("03340000000000000000803f0000000000000000000000000000000000000000")); ok {
		t.Error("a periodic mapping read")
	}
}
