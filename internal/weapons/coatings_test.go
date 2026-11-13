// coatings_test.go — the weapon coating file contract, driven by a small Ekur
// fixture in a temp directory (no game install, no network): the route's
// whitelist, the material annotation from the reference, and the coating files
// the build writes beside the model GLBs.

package weapons

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
)

// TestCoatingFileWhitelist — the route serves only the library's coating file
// names beside the model GLBs.
func TestCoatingFileWhitelist(t *testing.T) {
	good := []string{"coatings.json", "coating-f56ee213.json", "swatch-0b000001.png"}
	for _, name := range good {
		if !CoatingFile(name) {
			t.Errorf("CoatingFile(%q) = false, want true", name)
		}
	}
	bad := []string{
		"",
		"index.json",
		"spartan.glb",
		"coating-f56ee21.json",
		"coating-f56ee21g.json",
		"swatch-0b000001.jpg",
		"coating-f56ee213.json.tmp",
		"sub/coatings.json",
		"../coatings.json",
	}
	for _, name := range bad {
		if CoatingFile(name) {
			t.Errorf("CoatingFile(%q) = true, want false", name)
		}
	}
}

// ekurNoGradient is a minimal Ekur reference (the five contract entries) whose
// styles name no gradient image: Finish writes no swatches and needs no game
// arsenal.
func ekurNoGradient(t *testing.T, folder string) {
	t.Helper()
	mustWrite := func(rel, body string) {
		t.Helper()
		p := filepath.Join(folder, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	mustWrite("materials/123.json", `{"textures":{"Asg":7},"style_info":{"texel_density":[4,4],"material_offset":[0,0],"stylelist":456,"region_name":789,"base_intention":1,"mask0_red_intention":2,"mask0_green_intention":3,"mask0_blue_intention":4,"mask1_red_intention":5,"mask1_green_intention":6,"mask1_blue_intention":7,"supported_layers":7}}`)
	mustWrite("stylelists/456.json", `{"default_style":{"reference":"-177284589","name":"default"},"styles":{"-177284589":{"reference":"-177284589","name":"s"}}}`)
	mustWrite("styles/-177284589.json", `{"grime_amount":0.5,"scratch_amount":0.25,"grime_swatch":{"index":0,"gradient_transform":[1,1],"roughness":4,"roughness_white":1,"roughness_black":3,"metallic":0.1,"emissive_amount":0,"top_color":[1,1,1],"mid_color":[0.5,0.5,0.5],"bot_color":[0,0,0],"scratch_roughness":1,"scratch_metallic":0,"scratch_color":[1,1,1]}}`)
	mustWrite("globals.json", `{}`)
	mustWrite("visor_data.json", `{"patterns":{},"colors":{}}`)
}

// TestWeaponCoatingWork — the weapon library's coating distillation: the
// painted materials receive extras.style from the reference; Finish writes
// coatings.json and one coating file per style list, with no game arsenal.
func TestWeaponCoatingWork(t *testing.T) {
	folder := t.TempDir()
	ekurNoGradient(t, folder)
	coats, err := spartanpieces.OpenCoatingWork(folder)
	if err != nil || coats == nil {
		t.Fatalf("OpenCoatingWork = %v, %v", coats, err)
	}

	annotate := coats.Annotate(context.Background())
	extras := map[string]any{"id": json.Number("123"),
		"surfaceBrute": map[string]any{"asg": json.Number("0"),
			"bitmaps": map[string]any{"asg": json.Number("7")}}}
	if !annotate(extras) {
		t.Fatal("annotate: known painted material not annotated")
	}
	style, ok := extras[spartanpieces.ExtrasStyleKey].(spartanpieces.ExtrasStyleMaterial)
	if !ok {
		t.Fatalf("extras[style] = %T", extras[spartanpieces.ExtrasStyleKey])
	}
	if style.List != "000001c8" || style.Region != "00000315" {
		t.Fatalf("style = %+v", style)
	}
	if style.LayerCount != 7 || style.Intentions[0] != "00000001" || style.Intentions[6] != "00000007" {
		t.Fatalf("intentions = %v", style.Intentions)
	}

	// A material unknown to the reference stays without style (neutral render).
	unknown := map[string]any{"id": json.Number("456"), "surfaceBrute": map[string]any{}}
	if annotate(unknown) {
		t.Fatal("annotate: unknown material annotated")
	}
	// A material without surfaceBrute is not painted: not annotated.
	plain := map[string]any{"id": json.Number("123")}
	if annotate(plain) {
		t.Fatal("annotate: unpainted material annotated")
	}

	out := t.TempDir()
	idx, err := coats.Finish(context.Background(), nil, out)
	if err != nil {
		t.Fatalf("Finish: %v", err)
	}
	if idx.Materials != 1 || idx.Missing != 1 || idx.MasksAgree != 1 {
		t.Fatalf("index = %+v", idx)
	}
	if idx.Lists != 1 || idx.Coatings != 1 || idx.Swatches != 0 {
		t.Fatalf("index lists/coatings/swatches = %d/%d/%d", idx.Lists, idx.Coatings, idx.Swatches)
	}
	if _, err := os.Stat(filepath.Join(out, "coatings.json")); err != nil {
		t.Errorf("coatings.json not written: %v", err)
	}
	// One coating file per style list named by the materials.
	if _, err := os.Stat(filepath.Join(out, "coating-000001c8.json")); err != nil {
		t.Errorf("coating file of the list not written: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(out, "coatings.json"))
	if err != nil {
		t.Fatal(err)
	}
	var table map[string]any
	if err := json.Unmarshal(raw, &table); err != nil {
		t.Fatal(err)
	}
	if _, ok := table["default_styles"]; !ok {
		t.Errorf("coatings.json missing default_styles: %s", raw)
	}
}

// TestIndexCoatingsKey — the library index carries its coatings section only
// when the build distilled one.
func TestIndexCoatingsKey(t *testing.T) {
	with := NewIndex([]string{"0000abcd"}, "test")
	with.Coatings = &spartanpieces.CoatingsIndex{Source: "ekur"}
	raw, err := json.Marshal(with)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	if _, ok := m["coatings"]; !ok {
		t.Errorf("index JSON missing coatings: %s", raw)
	}
	plain := NewIndex([]string{"0000abcd"}, "test")
	raw, err = json.Marshal(plain)
	if err != nil {
		t.Fatal(err)
	}
	var plainMap map[string]any
	if err := json.Unmarshal(raw, &plainMap); err != nil {
		t.Fatal(err)
	}
	if _, ok := plainMap["coatings"]; ok {
		t.Errorf("index JSON carries coatings without one: %s", raw)
	}
}
