package ekurport

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// The piece 4a export tests compare every value Ekur writes for globals.json,
// visor_data.json, stylelists/, and styles/ against a real Ekur dump (oracle), one game
// test per part. Each test skips cleanly when the game or IT3D_EKUR_ORACLE is absent.

// openExportTestFixture opens the tag index the export tests build on.
func openExportTestFixture(t *testing.T) (*TagIndex, string) {
	t.Helper()
	oracle := os.Getenv("IT3D_EKUR_ORACLE")
	if oracle == "" {
		t.Skip("IT3D_EKUR_ORACLE not set; no Ekur oracle to compare against")
	}
	deploy, err := himap.DeployRoot()
	if err != nil {
		t.Skipf("no installed game to index: %v", err)
	}
	idx, err := OpenTagIndex(deploy)
	if err != nil {
		t.Fatalf("OpenTagIndex(%s): %v", deploy, err)
	}
	t.Cleanup(func() { _ = idx.Close() })
	return idx, oracle
}

// coatingSwatchMap decodes every "cmsw" tag in the index.
func coatingSwatchMap(t *testing.T, idx *TagIndex) map[int32]*CoatingSwatchLayout {
	t.Helper()
	ids := idx.IDs("cmsw")
	out := make(map[int32]*CoatingSwatchLayout, len(ids))
	for _, id := range ids {
		root, err := rootStruct(idx, id)
		if err != nil {
			t.Fatalf("cmsw %d: %v", id, err)
		}
		lay, err := ReadCoatingSwatch(root)
		if err != nil {
			t.Fatalf("cmsw %d: %v", id, err)
		}
		out[id] = lay
	}
	return out
}

// materialSwatchMap decodes every "mwsw" tag in the index.
func materialSwatchMap(t *testing.T, idx *TagIndex) map[int32]*MaterialSwatchLayout {
	t.Helper()
	ids := idx.IDs("mwsw")
	out := make(map[int32]*MaterialSwatchLayout, len(ids))
	for _, id := range ids {
		root, err := rootStruct(idx, id)
		if err != nil {
			t.Fatalf("mwsw %d: %v", id, err)
		}
		lay, err := ReadMaterialSwatch(root)
		if err != nil {
			t.Fatalf("mwsw %d: %v", id, err)
		}
		out[id] = lay
	}
	return out
}

// paletteMap decodes every "mwpl" tag in the index.
func paletteMap(t *testing.T, idx *TagIndex) map[int32]*MaterialPaletteLayout {
	t.Helper()
	ids := idx.IDs("mwpl")
	out := make(map[int32]*MaterialPaletteLayout, len(ids))
	for _, id := range ids {
		root, err := rootStruct(idx, id)
		if err != nil {
			t.Fatalf("mwpl %d: %v", id, err)
		}
		lay, err := ReadMaterialPalette(root)
		if err != nil {
			t.Fatalf("mwpl %d: %v", id, err)
		}
		out[id] = lay
	}
	return out
}

// oracleStyleListNames derives the string-id -> name map Ekur used from the oracle's own
// stylelist files: an entry whose name is not its key as a decimal must have come from
// the strings map. The name field is the only field this affects; everything else is
// compared strictly.
func oracleStyleListNames(t *testing.T, oracle string) map[int32]string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(oracle, "stylelists"))
	if err != nil {
		t.Fatalf("stylelists: read oracle dir: %v", err)
	}
	stringMap := map[int32]string{}
	add := func(id int32, name string) {
		if name != strconv.FormatInt(int64(id), 10) {
			stringMap[id] = name
		}
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		id, err := strconv.Atoi(strings.TrimSuffix(e.Name(), ".json"))
		if err != nil {
			continue
		}
		var v struct {
			DefaultStyle struct {
				Name string `json:"name"`
			} `json:"default_style"`
			Styles map[string]struct {
				Name string `json:"name"`
			} `json:"styles"`
		}
		if err := readOracleJSON(oracle, "stylelists/"+e.Name(), &v); err != nil {
			t.Fatalf("stylelists/%s: %v", e.Name(), err)
		}
		add(int32(id), v.DefaultStyle.Name)
		for k, entry := range v.Styles {
			key, err := strconv.Atoi(k)
			if err != nil {
				t.Fatalf("stylelists/%s: key %q is not an id", e.Name(), k)
			}
			add(int32(key), entry.Name)
		}
	}
	return stringMap
}

// marshalRoundTrip marshals v with encoding/json and parses it back to any, so the
// comparison sees exactly what the JSON carries (floats as float64, keys as strings).
func marshalRoundTrip(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return out
}

// deepDiffs reports up to 10 differences between two JSON-parsed values, as
// "path: got X, want Y" lines. Integer-valued numbers compare as exact int64 (string ids
// can exceed the float32 mantissa); other numbers compare as float32, matching Ekur's
// f32 arithmetic.
func deepDiffs(got, want any) []string {
	acc := []string{}
	return deepDiffsAt(got, want, "", &acc)
}

func deepDiffsAt(got, want any, path string, acc *[]string) []string {
	report := func() {
		if len(*acc) < 10 {
			*acc = append(*acc, fmt.Sprintf("%s: got %v, want %v", path, got, want))
		}
	}
	switch g := got.(type) {
	case map[string]any:
		w, ok := want.(map[string]any)
		if !ok {
			report()
			return *acc
		}
		for k := range w {
			if _, ok := g[k]; !ok {
				deepDiffsAt(nil, w[k], path+"."+k, acc)
			}
		}
		for k, gv := range g {
			wv, ok := w[k]
			if !ok {
				deepDiffsAt(gv, nil, path+"."+k, acc)
				continue
			}
			deepDiffsAt(gv, wv, path+"."+k, acc)
		}
	case []any:
		w, ok := want.([]any)
		if !ok || len(g) != len(w) {
			report()
			return *acc
		}
		for i := range g {
			deepDiffsAt(g[i], w[i], fmt.Sprintf("%s[%d]", path, i), acc)
		}
	case float64:
		w, ok := want.(float64)
		if !ok {
			report()
			return *acc
		}
		if g == math.Trunc(g) && w == math.Trunc(w) && math.Abs(g) < 1<<63 && math.Abs(w) < 1<<63 {
			if int64(g) != int64(w) {
				report()
			}
		} else if float32(g) != float32(w) {
			report()
		}
	case bool:
		if wb, _ := want.(bool); wb != g {
			report()
		}
	case string:
		if ws, _ := want.(string); ws != g {
			report()
		}
	case nil:
		if want != nil {
			report()
		}
	}
	return *acc
}

// diffSummary returns a deterministic, display-capped list of diffs.
func diffSummary(diffs []string) []string {
	sort.Strings(diffs)
	if len(diffs) > 10 {
		return diffs[:10]
	}
	return diffs
}

// TestGlobalsAndVisorExportMatchEkur compares globals.json and visor_data.json against
// the oracle: 175 global entries, 114 visor patterns, 213 visor colors.
func TestGlobalsAndVisorExportMatchEkur(t *testing.T) {
	idx, oracle := openExportTestFixture(t)

	cmsw := coatingSwatchMap(t, idx)
	mwsw := materialSwatchMap(t, idx)

	compared, differing := 0, 0
	var diffs []string

	root, err := rootStruct(idx, 680672300)
	if err != nil {
		t.Fatalf("coating globals: %v", err)
	}
	glay, err := ReadCoatingGlobals(root)
	if err != nil {
		t.Fatalf("coating globals: %v", err)
	}
	entries, err := ProcessCoatingGlobals(glay, cmsw)
	if err != nil {
		t.Fatalf("coating globals: %v", err)
	}
	compared++
	d := deepDiffs(marshalRoundTrip(t, entries), readOracleAny(t, oracle, "globals.json"))
	diffs = append(diffs, prefixDiffs("globals.json", d)...)
	if len(d) > 0 {
		differing++
	}

	vroot, err := rootStruct(idx, -1260457915)
	if err != nil {
		t.Fatalf("visor: %v", err)
	}
	vlay, err := ReadVisor(vroot)
	if err != nil {
		t.Fatalf("visor: %v", err)
	}
	visor, err := ProcessVisor(vlay, mwsw)
	if err != nil {
		t.Fatalf("visor: %v", err)
	}
	compared++
	d = deepDiffs(marshalRoundTrip(t, visor), readOracleAny(t, oracle, "visor_data.json"))
	diffs = append(diffs, prefixDiffs("visor_data.json", d)...)
	if len(d) > 0 {
		differing++
	}

	t.Logf("globals+visor: %d files compared, %d files differing", compared, differing)
	for _, line := range diffSummary(diffs) {
		t.Logf("  %s", line)
	}
	if differing > 0 {
		t.Errorf("globals+visor: %d files differ from the oracle", differing)
	}
}

// TestStyleListsExportMatchEkur compares every stylelists/<id>.json against the oracle
// (408 files: one per rucs tag, one per mwsy tag).
func TestStyleListsExportMatchEkur(t *testing.T) {
	idx, oracle := openExportTestFixture(t)

	mwpl := paletteMap(t, idx)
	mwsw := materialSwatchMap(t, idx)
	stringMap := oracleStyleListNames(t, oracle)

	entries, err := os.ReadDir(filepath.Join(oracle, "stylelists"))
	if err != nil {
		t.Fatalf("stylelists: read oracle dir: %v", err)
	}
	compared, differing := 0, 0
	var diffs []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		id, err := strconv.Atoi(strings.TrimSuffix(e.Name(), ".json"))
		if err != nil {
			continue
		}
		id32 := int32(id)
		root, err := rootStruct(idx, id32)
		if err != nil {
			t.Fatalf("stylelists/%s: %v", e.Name(), err)
		}
		var list CommonStyleList
		switch group, ok := idx.Group(id32); {
		case !ok:
			t.Fatalf("stylelists/%s: no group for id %d", e.Name(), id32)
		case group == "rucs":
			lay, err := ReadRuntimeCoatingStyles(root)
			if err != nil {
				t.Fatalf("stylelists/%s: %v", e.Name(), err)
			}
			list = ProcessRuntimeCoatingStyles(lay, stringMap)
		case group == "mwsy":
			lay, err := ReadMaterialStyles(root)
			if err != nil {
				t.Fatalf("stylelists/%s: %v", e.Name(), err)
			}
			list, _, err = ProcessMaterialCoatings(id32, lay, mwpl, mwsw, stringMap)
			if err != nil {
				t.Fatalf("stylelists/%s: %v", e.Name(), err)
			}
		default:
			t.Fatalf("stylelists/%s: unexpected group", e.Name())
		}
		compared++
		d := deepDiffs(marshalRoundTrip(t, list), readOracleAny(t, oracle, "stylelists/"+e.Name()))
		diffs = append(diffs, prefixDiffs("stylelists/"+e.Name(), d)...)
		if len(d) > 0 {
			differing++
		}
	}

	t.Logf("stylelists: %d files compared, %d files differing", compared, differing)
	for _, line := range diffSummary(diffs) {
		t.Logf("  %s", line)
	}
	if differing > 0 {
		t.Errorf("stylelists: %d files differ from the oracle", differing)
	}
}

// TestStylesExportMatchEkur compares every styles/<name>.json against the oracle (4,193
// files: one per rucy tag, one per mwsy style).
func TestStylesExportMatchEkur(t *testing.T) {
	idx, oracle := openExportTestFixture(t)

	cmsw := coatingSwatchMap(t, idx)
	mwpl := paletteMap(t, idx)
	mwsw := materialSwatchMap(t, idx)

	got := map[string]any{} // file name -> parsed export
	for _, id := range idx.IDs("rucy") {
		root, err := rootStruct(idx, id)
		if err != nil {
			t.Fatalf("rucy %d: %v", id, err)
		}
		lay, err := ReadRuntimeCoatingStyle(root)
		if err != nil {
			t.Fatalf("rucy %d: %v", id, err)
		}
		co, err := ProcessRuntimeCoatings(lay, cmsw)
		if err != nil {
			t.Fatalf("rucy %d: %v", id, err)
		}
		got[fmt.Sprint(id)] = marshalRoundTrip(t, co)
	}
	for _, id := range idx.IDs("mwsy") {
		root, err := rootStruct(idx, id)
		if err != nil {
			t.Fatalf("mwsy %d: %v", id, err)
		}
		lay, err := ReadMaterialStyles(root)
		if err != nil {
			t.Fatalf("mwsy %d: %v", id, err)
		}
		_, styles, err := ProcessMaterialCoatings(id, lay, mwpl, mwsw, nil)
		if err != nil {
			t.Fatalf("mwsy %d: %v", id, err)
		}
		for name, co := range styles {
			got[name] = marshalRoundTrip(t, co)
		}
	}

	entries, err := os.ReadDir(filepath.Join(oracle, "styles"))
	if err != nil {
		t.Fatalf("styles: read oracle dir: %v", err)
	}
	compared, differing := 0, 0
	seen := map[string]bool{}
	var diffs, missing []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := strings.TrimSuffix(e.Name(), ".json")
		seen[name] = true
		v, ok := got[name]
		if !ok {
			missing = append(missing, name)
			continue
		}
		compared++
		d := deepDiffs(v, readOracleAny(t, oracle, "styles/"+e.Name()))
		diffs = append(diffs, prefixDiffs("styles/"+e.Name(), d)...)
		if len(d) > 0 {
			differing++
		}
	}
	var extra []string
	for name := range got {
		if !seen[name] {
			extra = append(extra, name)
		}
	}

	t.Logf("styles: %d files compared, %d files differing, %d oracle files missing from export, %d export files missing from oracle", compared, differing, len(missing), len(extra))
	all := append(diffs, missing...)
	for _, line := range diffSummary(all) {
		t.Logf("  %s", line)
	}
	if differing > 0 || len(missing) > 0 || len(extra) > 0 {
		t.Errorf("styles: %d files differ, %d missing, %d extra", differing, len(missing), len(extra))
	}
}

// prefixDiffs prefixes every diff line with the file it came from.
func prefixDiffs(file string, diffs []string) []string {
	out := make([]string, len(diffs))
	for i, d := range diffs {
		out[i] = file + " " + d
	}
	return out
}

// readOracleAny parses an oracle JSON file into any.
func readOracleAny(t *testing.T, oracle, name string) any {
	t.Helper()
	var out any
	if err := readOracleJSON(oracle, name, &out); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return out
}
