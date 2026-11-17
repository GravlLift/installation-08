// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package ekurport

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// TestDeployLayoutsMatchEkur reads real game tags with the piece 3 raw layout readers and
// checks the values Ekur copies WITHOUT a transform against a real Ekur dump (oracle). It
// skips cleanly when the game or IT3D_EKUR_ORACLE is absent.
//
// The rules each check encodes are confirmed from Ekur's source, not assumed:
//
//	style lists: Ekur writes one stylelists/<id>.json per rucs tag (coating.rs:57) and one
//	  per mwsy tag (coating.rs:100,102-110); a rucs entry's reference is style_ref's global
//	  id (common_styles.rs:18) and a mwsy entry's is "<id>_<style name>" (material_coating.rs:100).
//	styles: one styles/<id>.json per rucy tag (coating.rs:78) and one styles/<id>_<name>.json
//	  per mwsy style (material_coating.rs:100, coating.rs:111-119); region keys are the region
//	  name string ids (runtime_style.rs:115, material_styles.rs:37).
//	materials: style_info fields are copied raw (material.rs MaterialStyleInfo).
//	visor: pattern fields are copied as-is from the referenced mwsw swatch (visor.rs:14-38);
//	  colors are copied as-is from the visor tag (visor.rs:40-47).
//	globals: name and fallback are copied raw (common_coating.rs:211-217).
func TestDeployLayoutsMatchEkur(t *testing.T) {
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
	t.Logf("deploy: %s", deploy)

	checkStyleLists(t, idx, oracle)
	checkStyles(t, idx, oracle)
	checkMaterialsLayout(t, idx, oracle)
	checkVisorLayout(t, idx, oracle)
	checkGlobalsLayout(t, idx, oracle)
}

// oracleStyleList is the oracle's stylelists/<id>.json "styles" map: name string id -> entry.
type oracleStyleList struct {
	Styles map[string]struct {
		Reference string `json:"reference"`
	} `json:"styles"`
}

// checkStyleLists verifies the stylelists set and each list's style count and references.
func checkStyleLists(t *testing.T, idx *TagIndex, oracle string) {
	oracleDir := filepath.Join(oracle, "stylelists")
	oracleNames, err := oracleFileIDs(oracleDir)
	if err != nil {
		t.Fatalf("stylelists: read oracle: %v", err)
	}

	got := make(map[int32]string) // id -> reference rule group
	for _, id := range idx.IDs("rucs") {
		got[id] = "rucs"
	}
	for _, id := range idx.IDs("mwsy") {
		got[id] = "mwsy"
	}
	setMismatch(t, "stylelists", got, oracleNames)

	var matched, mismatched, checked int
	var bad []string
	for id, grp := range got {
		if _, ok := oracleNames[id]; !ok {
			continue
		}
		checked++
		var list oracleStyleList
		if err := readOracleJSON(oracle, "stylelists/"+strconv.FormatInt(int64(id), 10)+".json", &list); err != nil {
			mismatched++
			bad = append(bad, fmt.Sprintf("list %d (%s): read oracle: %v", id, grp, err))
			continue
		}
		root, err := rootStruct(idx, id)
		if err != nil {
			mismatched++
			bad = append(bad, fmt.Sprintf("list %d (%s): %v", id, grp, err))
			continue
		}
		// Build name -> reference from the raw layout, per the group's rule.
		want := make(map[int32]string, 0)
		switch grp {
		case "rucs":
			lay, err := ReadRuntimeCoatingStyles(root)
			if err != nil {
				mismatched++
				bad = append(bad, fmt.Sprintf("list %d (rucs): %v", id, err))
				continue
			}
			for _, s := range lay.Styles {
				want[s.Name] = strconv.FormatInt(int64(s.StyleRef), 10)
			}
		case "mwsy":
			lay, err := ReadMaterialStyles(root)
			if err != nil {
				mismatched++
				bad = append(bad, fmt.Sprintf("list %d (mwsy): %v", id, err))
				continue
			}
			for _, s := range lay.Styles {
				want[s.Name] = fmt.Sprintf("%d_%d", id, s.Name)
			}
		}
		if len(want) != len(list.Styles) {
			mismatched++
			bad = append(bad, fmt.Sprintf("list %d (%s): %d styles, oracle %d", id, grp, len(want), len(list.Styles)))
			continue
		}
		ok := true
		for key, entry := range list.Styles {
			name, err := strconv.Atoi(key)
			if err != nil {
				mismatched++
				ok = false
				bad = append(bad, fmt.Sprintf("list %d (%s): non-numeric key %q", id, grp, key))
				break
			}
			ref, okk := want[int32(name)]
			if !okk || ref != entry.Reference {
				mismatched++
				ok = false
				bad = append(bad, fmt.Sprintf("list %d (%s) key %s: ref %q, want %q", id, grp, key, entry.Reference, ref))
				break
			}
		}
		if ok {
			matched++
		}
	}
	t.Logf("stylelists: %d checked, %d matched, %d mismatched", checked, matched, mismatched)
	for _, s := range bad[:min(len(bad), 8)] {
		t.Logf("  mismatch: %s", s)
	}
	if mismatched > 0 {
		t.Errorf("stylelists: %d mismatched", mismatched)
	}
}

// checkStyles verifies the styles set and each style's region count and keys.
func checkStyles(t *testing.T, idx *TagIndex, oracle string) {
	oracleDir := filepath.Join(oracle, "styles")
	oracleFiles, err := os.ReadDir(oracleDir)
	if err != nil {
		t.Fatalf("styles: read oracle: %v", err)
	}
	oracleNames := make(map[string]bool, len(oracleFiles))
	for _, f := range oracleFiles {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".json") {
			continue
		}
		oracleNames[strings.TrimSuffix(f.Name(), ".json")] = true
	}

	got := make(map[string]bool)
	// rucy styles: filename is the tag id.
	for _, id := range idx.IDs("rucy") {
		got[strconv.FormatInt(int64(id), 10)] = true
	}
	// mwsy styles: filename is "<id>_<style name>".
	for _, id := range idx.IDs("mwsy") {
		root, err := rootStruct(idx, id)
		if err != nil {
			continue
		}
		lay, err := ReadMaterialStyles(root)
		if err != nil {
			continue
		}
		for _, s := range lay.Styles {
			got[fmt.Sprintf("%d_%d", id, s.Name)] = true
		}
	}
	setMismatchNames(t, "styles", got, oracleNames)

	var matched, mismatched, checked int
	var bad []string
	for name := range got {
		if !oracleNames[name] {
			continue
		}
		checked++
		var st struct {
			Regions map[string]json.RawMessage `json:"regions"`
		}
		if err := readOracleJSON(oracle, "styles/"+name+".json", &st); err != nil {
			mismatched++
			bad = append(bad, fmt.Sprintf("style %s: read oracle: %v", name, err))
			continue
		}
		wantKeys, err := styleRegionKeys(idx, name)
		if err != nil {
			mismatched++
			bad = append(bad, fmt.Sprintf("style %s: %v", name, err))
			continue
		}
		if len(wantKeys) != len(st.Regions) {
			mismatched++
			bad = append(bad, fmt.Sprintf("style %s: %d regions, oracle %d", name, len(wantKeys), len(st.Regions)))
			continue
		}
		ok := true
		for key := range st.Regions {
			k, err := strconv.Atoi(key)
			if err != nil || !wantKeys[int32(k)] {
				mismatched++
				ok = false
				bad = append(bad, fmt.Sprintf("style %s: oracle region key %s not in decode", name, key))
				break
			}
		}
		if ok {
			matched++
		}
	}
	t.Logf("styles: %d checked, %d matched, %d mismatched", checked, matched, mismatched)
	for _, s := range bad[:min(len(bad), 8)] {
		t.Logf("  mismatch: %s", s)
	}
	if mismatched > 0 {
		t.Errorf("styles: %d mismatched", mismatched)
	}
}

// styleRegionKeys returns the set of region name string ids for a style file named name
// (either a rucy "<id>" or an mwsy "<id>_<name>").
func styleRegionKeys(idx *TagIndex, name string) (map[int32]bool, error) {
	idStr := name
	if i := strings.LastIndex(name, "_"); i >= 0 {
		idStr = name[:i]
	}
	id, err := strconv.Atoi(idStr)
	if err != nil {
		return nil, fmt.Errorf("bad style name %q", name)
	}
	id32 := int32(id)
	grp, ok := idx.Group(id32)
	if !ok {
		return nil, fmt.Errorf("id %d not in index", id32)
	}
	root, err := rootStruct(idx, id32)
	if err != nil {
		return nil, err
	}
	keys := make(map[int32]bool)
	switch grp {
	case "rucy":
		lay, err := ReadRuntimeCoatingStyle(root)
		if err != nil {
			return nil, err
		}
		for _, r := range lay.Regions {
			keys[r.Name] = true
		}
	case "mwsy":
		lay, err := ReadMaterialStyles(root)
		if err != nil {
			return nil, err
		}
		for _, s := range lay.Styles {
			if fmt.Sprintf("%d_%d", id32, s.Name) == name {
				for _, r := range s.Regions {
					keys[r.Name] = true
				}
				break
			}
		}
	default:
		return nil, fmt.Errorf("id %d has group %q, want rucy/mwsy", id32, grp)
	}
	return keys, nil
}

type oracleMaterialStyleInfo struct {
	Stylelist           int32 `json:"stylelist"`
	RegionName          int32 `json:"region_name"`
	BaseIntention       int32 `json:"base_intention"`
	Mask0RedIntention   int32 `json:"mask0_red_intention"`
	Mask0GreenIntention int32 `json:"mask0_green_intention"`
	Mask0BlueIntention  int32 `json:"mask0_blue_intention"`
	Mask1RedIntention   int32 `json:"mask1_red_intention"`
	Mask1GreenIntention int32 `json:"mask1_green_intention"`
	Mask1BlueIntention  int32 `json:"mask1_blue_intention"`
}

// checkMaterialsLayout verifies the raw style_info fields of every oracle material that has
// a non-null style_info.
func checkMaterialsLayout(t *testing.T, idx *TagIndex, oracle string) {
	matDir := filepath.Join(oracle, "materials")
	files, err := os.ReadDir(matDir)
	if err != nil {
		t.Fatalf("materials: read oracle: %v", err)
	}
	var matched, mismatched, checked int
	var bad []string
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".json") {
			continue
		}
		id, err := strconv.Atoi(strings.TrimSuffix(f.Name(), ".json"))
		if err != nil {
			continue
		}
		var m struct {
			StyleInfo *oracleMaterialStyleInfo `json:"style_info"`
		}
		data, err := os.ReadFile(filepath.Join(matDir, f.Name()))
		if err != nil {
			t.Fatalf("read %s: %v", f.Name(), err)
		}
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatalf("parse %s: %v", f.Name(), err)
		}
		if m.StyleInfo == nil {
			continue
		}
		checked++
		root, err := rootStruct(idx, int32(id))
		if err != nil {
			mismatched++
			bad = append(bad, fmt.Sprintf("mat %d: %v", id, err))
			continue
		}
		lay, err := ReadMaterial(root)
		if err != nil || len(lay.StyleInfo) == 0 {
			mismatched++
			bad = append(bad, fmt.Sprintf("mat %d: read style_info: %v", id, err))
			continue
		}
		si := lay.StyleInfo[0]
		w := m.StyleInfo
		var diff string
		switch {
		case si.Stylelist != w.Stylelist:
			diff = fmt.Sprintf("stylelist %d, want %d", si.Stylelist, w.Stylelist)
		case si.RegionName != w.RegionName:
			diff = fmt.Sprintf("region_name %d, want %d", si.RegionName, w.RegionName)
		case si.BaseIntention != w.BaseIntention:
			diff = fmt.Sprintf("base_intention %d, want %d", si.BaseIntention, w.BaseIntention)
		case si.Mask0RedIntention != w.Mask0RedIntention:
			diff = fmt.Sprintf("mask0_red %d, want %d", si.Mask0RedIntention, w.Mask0RedIntention)
		case si.Mask0GreenIntention != w.Mask0GreenIntention:
			diff = fmt.Sprintf("mask0_green %d, want %d", si.Mask0GreenIntention, w.Mask0GreenIntention)
		case si.Mask0BlueIntention != w.Mask0BlueIntention:
			diff = fmt.Sprintf("mask0_blue %d, want %d", si.Mask0BlueIntention, w.Mask0BlueIntention)
		case si.Mask1RedIntention != w.Mask1RedIntention:
			diff = fmt.Sprintf("mask1_red %d, want %d", si.Mask1RedIntention, w.Mask1RedIntention)
		case si.Mask1GreenIntention != w.Mask1GreenIntention:
			diff = fmt.Sprintf("mask1_green %d, want %d", si.Mask1GreenIntention, w.Mask1GreenIntention)
		case si.Mask1BlueIntention != w.Mask1BlueIntention:
			diff = fmt.Sprintf("mask1_blue %d, want %d", si.Mask1BlueIntention, w.Mask1BlueIntention)
		}
		if diff == "" {
			matched++
			continue
		}
		mismatched++
		bad = append(bad, fmt.Sprintf("mat %d: %s", id, diff))
	}
	t.Logf("materials: %d checked (non-null style_info), %d matched, %d mismatched", checked, matched, mismatched)
	for _, s := range bad[:min(len(bad), 8)] {
		t.Logf("  mismatch: %s", s)
	}
	if checked != 6082 {
		t.Errorf("materials: expected 6082 non-null style_info, got %d", checked)
	}
	if mismatched > 0 {
		t.Errorf("materials: %d mismatched", mismatched)
	}
}

type oracleVisorPattern struct {
	ColorAndRoughnessTransform [2]float32 `json:"color_and_roughness_transform"`
	NormalTextureTransform     [2]float32 `json:"normal_texture_transform"`
	ColorGradientMap           int32      `json:"color_gradient_map"`
	RoughnessWhite             float32    `json:"roughness_white"`
	RoughnessBlack             float32    `json:"roughness_black"`
	NormalDetailMap            int32      `json:"normal_detail_map"`
	Metallic                   float32    `json:"metallic"`
	ScratchColor               [3]float32 `json:"scratch_color"`
	ScratchRoughness           float32    `json:"scratch_roughness"`
	ScratchMetallic            float32    `json:"scratch_metallic"`
}

type oracleVisorColor struct {
	TopColor [3]float32 `json:"top_color"`
	MidColor [3]float32 `json:"mid_color"`
	BotColor [3]float32 `json:"bot_color"`
}

// checkVisorLayout verifies every visor pattern and color against the raw decode.
func checkVisorLayout(t *testing.T, idx *TagIndex, oracle string) {
	var v struct {
		Patterns map[string]oracleVisorPattern `json:"patterns"`
		Colors   map[string]oracleVisorColor   `json:"colors"`
	}
	if err := readOracleJSON(oracle, "visor_data.json", &v); err != nil {
		t.Fatalf("visor: %v", err)
	}
	root, err := rootStruct(idx, -1260457915)
	if err != nil {
		t.Fatalf("visor: %v", err)
	}
	lay, err := ReadVisor(root)
	if err != nil {
		t.Fatalf("visor: %v", err)
	}

	var matched, mismatched int
	var bad []string
	for i := range lay.Patterns {
		p := lay.Patterns[i]
		key := strconv.FormatInt(int64(p.Name), 10)
		want, ok := v.Patterns[key]
		if !ok {
			mismatched++
			bad = append(bad, fmt.Sprintf("pattern %s: not in oracle", key))
			continue
		}
		sw, err := rootStruct(idx, p.SwatchID)
		if err != nil {
			mismatched++
			bad = append(bad, fmt.Sprintf("pattern %s: resolve swatch %d: %v", key, p.SwatchID, err))
			continue
		}
		ms, err := ReadMaterialSwatch(sw)
		if err != nil {
			mismatched++
			bad = append(bad, fmt.Sprintf("pattern %s: read swatch: %v", key, err))
			continue
		}
		var diff string
		switch {
		case ms.ColorAndRoughnessTransform != want.ColorAndRoughnessTransform:
			diff = fmt.Sprintf("color_and_roughness_transform %v, want %v", ms.ColorAndRoughnessTransform, want.ColorAndRoughnessTransform)
		case ms.NormalTextureTransform != want.NormalTextureTransform:
			diff = fmt.Sprintf("normal_texture_transform %v, want %v", ms.NormalTextureTransform, want.NormalTextureTransform)
		case ms.ColorGradientMap != want.ColorGradientMap:
			diff = fmt.Sprintf("color_gradient_map %d, want %d", ms.ColorGradientMap, want.ColorGradientMap)
		case ms.RoughnessWhite != want.RoughnessWhite:
			diff = fmt.Sprintf("roughness_white %v, want %v", ms.RoughnessWhite, want.RoughnessWhite)
		case ms.RoughnessBlack != want.RoughnessBlack:
			diff = fmt.Sprintf("roughness_black %v, want %v", ms.RoughnessBlack, want.RoughnessBlack)
		case ms.NormalDetailMap != want.NormalDetailMap:
			diff = fmt.Sprintf("normal_detail_map %d, want %d", ms.NormalDetailMap, want.NormalDetailMap)
		case ms.Metallic != want.Metallic:
			diff = fmt.Sprintf("metallic %v, want %v", ms.Metallic, want.Metallic)
		case ms.ScratchColor != want.ScratchColor:
			diff = fmt.Sprintf("scratch_color %v, want %v", ms.ScratchColor, want.ScratchColor)
		case ms.ScratchRoughness != want.ScratchRoughness:
			diff = fmt.Sprintf("scratch_roughness %v, want %v", ms.ScratchRoughness, want.ScratchRoughness)
		case ms.ScratchMetallic != want.ScratchMetallic:
			diff = fmt.Sprintf("scratch_metallic %v, want %v", ms.ScratchMetallic, want.ScratchMetallic)
		}
		if diff == "" {
			matched++
			continue
		}
		mismatched++
		bad = append(bad, fmt.Sprintf("pattern %s: %s", key, diff))
	}
	if len(lay.Patterns) != len(v.Patterns) {
		t.Errorf("visor patterns: decode %d, oracle %d", len(lay.Patterns), len(v.Patterns))
	}
	for i := range lay.Colors {
		c := lay.Colors[i]
		key := strconv.FormatInt(int64(c.Name), 10)
		want, ok := v.Colors[key]
		if !ok {
			mismatched++
			bad = append(bad, fmt.Sprintf("color %s: not in oracle", key))
			continue
		}
		var diff string
		switch {
		case c.TopColor != want.TopColor:
			diff = fmt.Sprintf("top_color %v, want %v", c.TopColor, want.TopColor)
		case c.MidColor != want.MidColor:
			diff = fmt.Sprintf("mid_color %v, want %v", c.MidColor, want.MidColor)
		case c.BotColor != want.BotColor:
			diff = fmt.Sprintf("bot_color %v, want %v", c.BotColor, want.BotColor)
		}
		if diff == "" {
			matched++
			continue
		}
		mismatched++
		bad = append(bad, fmt.Sprintf("color %s: %s", key, diff))
	}
	if len(lay.Colors) != len(v.Colors) {
		t.Errorf("visor colors: decode %d, oracle %d", len(lay.Colors), len(v.Colors))
	}
	t.Logf("visor: %d matched, %d mismatched (patterns %d, colors %d)",
		matched, mismatched, len(lay.Patterns), len(lay.Colors))
	for _, s := range bad[:min(len(bad), 8)] {
		t.Logf("  mismatch: %s", s)
	}
	if mismatched > 0 {
		t.Errorf("visor: %d mismatched", mismatched)
	}
}

// checkGlobalsLayout verifies every coating globals entry's name and fallback.
func checkGlobalsLayout(t *testing.T, idx *TagIndex, oracle string) {
	var g struct {
		Entries map[string]struct {
			Fallback int32 `json:"fallback"`
		} `json:"entries"`
	}
	if err := readOracleJSON(oracle, "globals.json", &g); err != nil {
		t.Fatalf("globals: %v", err)
	}
	root, err := rootStruct(idx, 680672300)
	if err != nil {
		t.Fatalf("globals: %v", err)
	}
	lay, err := ReadCoatingGlobals(root)
	if err != nil {
		t.Fatalf("globals: %v", err)
	}
	var matched, mismatched int
	var bad []string
	for i := range lay.Entries {
		e := lay.Entries[i]
		key := strconv.FormatInt(int64(e.Name), 10)
		want, ok := g.Entries[key]
		if !ok {
			mismatched++
			bad = append(bad, fmt.Sprintf("entry %s: not in oracle", key))
			continue
		}
		if e.Fallback != want.Fallback {
			mismatched++
			bad = append(bad, fmt.Sprintf("entry %s: fallback %d, want %d", key, e.Fallback, want.Fallback))
			continue
		}
		matched++
	}
	if len(lay.Entries) != len(g.Entries) {
		t.Errorf("globals: decode %d entries, oracle %d", len(lay.Entries), len(g.Entries))
	}
	t.Logf("globals: %d matched, %d mismatched (%d entries)", matched, mismatched, len(lay.Entries))
	for _, s := range bad[:min(len(bad), 8)] {
		t.Logf("  mismatch: %s", s)
	}
	if mismatched > 0 {
		t.Errorf("globals: %d mismatched", mismatched)
	}
}

// oracleFileIDs returns the set of signed int32 ids encoded in the "<id>.json" file names of
// dir.
func oracleFileIDs(dir string) (map[int32]bool, error) {
	files, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make(map[int32]bool, len(files))
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".json") {
			continue
		}
		id, err := strconv.Atoi(strings.TrimSuffix(f.Name(), ".json"))
		if err != nil {
			return nil, fmt.Errorf("bad id in %s", f.Name())
		}
		out[int32(id)] = true
	}
	return out, nil
}

// setMismatch reports, and logs, ids present in only one of two id sets.
func setMismatch(t *testing.T, label string, got map[int32]string, want map[int32]bool) {
	var onlyGot, onlyWant []int32
	for id := range got {
		if !want[id] {
			onlyGot = append(onlyGot, id)
		}
	}
	for id := range want {
		if _, ok := got[id]; !ok {
			onlyWant = append(onlyWant, id)
		}
	}
	sort.Slice(onlyGot, func(a, b int) bool { return onlyGot[a] < onlyGot[b] })
	sort.Slice(onlyWant, func(a, b int) bool { return onlyWant[a] < onlyWant[b] })
	t.Logf("%s: index %d, oracle %d; only-in-index %d, only-in-oracle %d",
		label, len(got), len(want), len(onlyGot), len(onlyWant))
	if len(onlyGot) == 0 && len(onlyWant) == 0 {
		return
	}
	t.Errorf("%s: id set mismatch (%d only in index, %d only in oracle)", label, len(onlyGot), len(onlyWant))
	if len(onlyGot) > 0 {
		t.Logf("  first only-in-index: %v", firstFew(onlyGot))
	}
	if len(onlyWant) > 0 {
		t.Logf("  first only-in-oracle: %v", firstFew(onlyWant))
	}
}

// setMismatchNames reports, and logs, names present in only one of two name sets.
func setMismatchNames(t *testing.T, label string, got, want map[string]bool) {
	var onlyGot, onlyWant []string
	for k := range got {
		if !want[k] {
			onlyGot = append(onlyGot, k)
		}
	}
	for k := range want {
		if !got[k] {
			onlyWant = append(onlyWant, k)
		}
	}
	sort.Strings(onlyGot)
	sort.Strings(onlyWant)
	t.Logf("%s: index %d, oracle %d; only-in-index %d, only-in-oracle %d",
		label, len(got), len(want), len(onlyGot), len(onlyWant))
	if len(onlyGot) == 0 && len(onlyWant) == 0 {
		return
	}
	t.Errorf("%s: name set mismatch (%d only in index, %d only in oracle)", label, len(onlyGot), len(onlyWant))
	if len(onlyGot) > 0 {
		t.Logf("  first only-in-index: %v", firstFewStr(onlyGot))
	}
	if len(onlyWant) > 0 {
		t.Logf("  first only-in-oracle: %v", firstFewStr(onlyWant))
	}
}

func firstFewStr(ss []string) []string {
	const n = 8
	if len(ss) > n {
		return ss[:n]
	}
	return ss
}
