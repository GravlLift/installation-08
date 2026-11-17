// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package ekurport

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/JGtm/halo-infinite-map-images/himap"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
)

// TestWriteExportMatchesEkur writes a full export to a fresh folder and checks it against
// the oracle: the five contract entries are present, the file counts per part match, and
// the builder-read fields of a 200-file sample per folder (and both singletons) match.
// Skips cleanly when the game or IT3D_EKUR_ORACLE is absent.
func TestWriteExportMatchesEkur(t *testing.T) {
	oracle := os.Getenv("IT3D_EKUR_ORACLE")
	if oracle == "" {
		t.Skip("IT3D_EKUR_ORACLE not set; no Ekur oracle to compare against")
	}
	deploy, err := himap.DeployRoot()
	if err != nil {
		t.Skipf("no installed game to index: %v", err)
	}

	debug := os.Getenv("IT3D_WRITE_DEBUG")
	var dir string
	if debug != "" {
		dir = debug
	} else {
		dir = filepath.Join(t.TempDir(), "ekur")
	}
	start := time.Now()
	stats, err := WriteExport(context.Background(), deploy, dir)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("WriteExport: %v", err)
	}
	if missing := spartanpieces.EkurMissing(dir); len(missing) > 0 {
		t.Errorf("EkurMissing: %v", missing)
	}
	if !spartanpieces.EkurValid(dir) {
		t.Error("EkurValid is false")
	}

	counts := [][3]any{
		{"materials", countJSON(t, filepath.Join(dir, "materials")), countJSON(t, filepath.Join(oracle, "materials"))},
		{"stylelists", countJSON(t, filepath.Join(dir, "stylelists")), countJSON(t, filepath.Join(oracle, "stylelists"))},
		{"styles", countJSON(t, filepath.Join(dir, "styles")), countJSON(t, filepath.Join(oracle, "styles"))},
	}
	for _, c := range counts {
		if c[1] != c[2] {
			t.Errorf("%s: %d files, oracle has %d", c[0], c[1], c[2])
		}
	}
	if stats.Globals != 1 || stats.Visor != 1 {
		t.Errorf("singletons: globals=%d visor=%d, want 1/1", stats.Globals, stats.Visor)
	}

	// Sampled-field comparisons: 200 per folder plus both singletons.
	diffs := compareExportSample(t, dir, oracle)
	if len(diffs) > 0 {
		t.Errorf("%d sampled fields differ from the oracle", len(diffs))
		for _, d := range diffSummary(diffs) {
			t.Logf("  %s", d)
		}
	}

	t.Logf("WriteExport: materials=%d stylelists=%d styles=%d globals=%d visor=%d bytes=%d in %s",
		stats.Materials, stats.StyleLists, stats.Styles, stats.Globals, stats.Visor, stats.Bytes, elapsed)
}

// countJSON counts the .json files directly under a directory.
func countJSON(t *testing.T, dir string) int {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("count %s: %v", dir, err)
	}
	n := 0
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			n++
		}
	}
	return n
}

// compareExportSample samples up to 200 files from each of the three folders (and checks
// both singletons) and reports the builder-read fields that differ from the oracle.
func compareExportSample(t *testing.T, dir, oracle string) []string {
	t.Helper()
	acc := []string{}
	add := func(file string, diff string) {
		if len(acc) < 10 {
			acc = append(acc, file+" "+diff)
		}
	}

	// Singletons: compare the full parsed JSON.
	for _, name := range []string{"globals.json", "visor_data.json"} {
		got := readExportAny(t, dir, name)
		want := readOracleAny(t, oracle, name)
		for _, d := range deepDiffs(got, want) {
			add(name, d)
		}
	}

	// materials: the builder-read fields (style_info and the Asg/Mask0/Mask1 textures).
	for _, id := range sampleNames(t, filepath.Join(oracle, "materials"), 200) {
		got := readExportAny(t, dir, "materials/"+id)
		want := readOracleAny(t, oracle, "materials/"+id)
		for _, d := range materialDiffs(got, want) {
			add("materials/"+id, d)
		}
	}

	// stylelists: the reference the builders read (default reference, keys, per-style
	// reference). The display name is not one of them (no game string table).
	for _, id := range sampleNames(t, filepath.Join(oracle, "stylelists"), 200) {
		got := readExportAny(t, dir, "stylelists/"+id)
		want := readOracleAny(t, oracle, "stylelists/"+id)
		for _, d := range styleListDiffs(got, want) {
			add("stylelists/"+id, d)
		}
	}

	// styles: compare the full parsed JSON.
	for _, name := range sampleNames(t, filepath.Join(oracle, "styles"), 200) {
		got := readExportAny(t, dir, "styles/"+name)
		want := readOracleAny(t, oracle, "styles/"+name)
		for _, d := range deepDiffs(got, want) {
			add("styles/"+name, d)
		}
	}

	return acc
}

// sampleNames lists up to n .json file names in dir, in lexical order.
func sampleNames(t *testing.T, dir string, n int) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("sample %s: %v", dir, err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	if len(names) > n {
		names = names[:n]
	}
	return names
}

// readExportAny parses one file under the export dir into any.
func readExportAny(t *testing.T, dir, name string) any {
	t.Helper()
	var out any
	data, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Fatalf("export %s: %v", name, err)
	}
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("export %s: %v", name, err)
	}
	return out
}

// materialDiffs compares the builder-read fields of two parsed material files.
func materialDiffs(got, want any) []string {
	acc := []string{}
	g, ok := got.(map[string]any)
	if !ok {
		return []string{"materials: not an object"}
	}
	w, ok := want.(map[string]any)
	if !ok {
		return []string{"materials: oracle not an object"}
	}
	if gHas := g["style_info"] != nil; gHas != (w["style_info"] != nil) {
		acc = append(acc, fmt.Sprintf("style_info: got null=%v, want null=%v", !gHas, w["style_info"] == nil))
	} else if g["style_info"] != nil {
		acc = append(acc, deepDiffs(g["style_info"], w["style_info"])...)
	}
	for _, key := range []string{"Asg", "Mask0", "Mask1"} {
		gv, gOK := numFromTextures(g["textures"], key)
		wv, wOK := numFromTextures(w["textures"], key)
		gNone := !gOK || gv == 0 || gv == -1
		wNone := !wOK || wv == 0 || wv == -1
		if gNone != wNone || (!gNone && gv != wv) {
			acc = append(acc, fmt.Sprintf("textures.%s: got %v (present=%v), want %v (present=%v)", key, gv, gOK, wv, wOK))
		}
	}
	return acc
}

// styleListDiffs compares the builder-read reference fields of two parsed style lists.
func styleListDiffs(got, want any) []string {
	acc := []string{}
	g, ok := got.(map[string]any)
	if !ok {
		return []string{"stylelist: not an object"}
	}
	w, ok := want.(map[string]any)
	if !ok {
		return []string{"stylelist: oracle not an object"}
	}
	gdef, _ := g["default_style"].(map[string]any)
	wdef, _ := w["default_style"].(map[string]any)
	if gdef["reference"] != wdef["reference"] {
		acc = append(acc, fmt.Sprintf("default_style.reference: got %v, want %v", gdef["reference"], wdef["reference"]))
	}
	gstyles, _ := g["styles"].(map[string]any)
	wstyles, _ := w["styles"].(map[string]any)
	if len(gstyles) != len(wstyles) {
		acc = append(acc, fmt.Sprintf("styles: got %d entries, want %d", len(gstyles), len(wstyles)))
	}
	for k, wv := range wstyles {
		wentry, _ := wv.(map[string]any)
		gentry, ok := gstyles[k].(map[string]any)
		if !ok {
			acc = append(acc, fmt.Sprintf("styles[%s]: missing", k))
			continue
		}
		if gentry["reference"] != wentry["reference"] {
			acc = append(acc, fmt.Sprintf("styles[%s].reference: got %v, want %v", k, gentry["reference"], wentry["reference"]))
		}
	}
	for k := range gstyles {
		if _, ok := wstyles[k]; !ok {
			acc = append(acc, fmt.Sprintf("styles[%s]: extra", k))
		}
	}
	return acc
}

// numFromTextures reads a texture key from a parsed textures map as a number.
func numFromTextures(tex any, key string) (float64, bool) {
	m, _ := tex.(map[string]any)
	v, ok := m[key]
	if !ok {
		return 0, false
	}
	n, _ := v.(float64)
	return n, true
}
