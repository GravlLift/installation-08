// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package ekurport

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

// TestMaterialsExportMatchEkur compares every materials/<id>.json entry against the
// oracle: style_info (null vs non-null, then each field exactly) and the Asg / Mask0 /
// Mask1 texture keys. For the textures, a key that is absent, 0, or -1 counts as "none",
// matching the way the builders treat them (spartanpieces sameMasks); any other value
// must match exactly.

// oracleMatStyleInfo is the oracle's style_info object (the fields compared).
type oracleMatStyleInfo struct {
	TexelDensity        [2]float64 `json:"texel_density"`
	MaterialOffset      [2]float64 `json:"material_offset"`
	Stylelist           int64      `json:"stylelist"`
	RegionName          int64      `json:"region_name"`
	BaseIntention       int64      `json:"base_intention"`
	Mask0RedIntention   int64      `json:"mask0_red_intention"`
	Mask0GreenIntention int64      `json:"mask0_green_intention"`
	Mask0BlueIntention  int64      `json:"mask0_blue_intention"`
	Mask1RedIntention   int64      `json:"mask1_red_intention"`
	Mask1GreenIntention int64      `json:"mask1_green_intention"`
	Mask1BlueIntention  int64      `json:"mask1_blue_intention"`
	SupportedLayers     int64      `json:"supported_layers"`
}

func TestMaterialsExportMatchEkur(t *testing.T) {
	idx, oracle := openExportTestFixture(t)
	matDir := filepath.Join(oracle, "materials")
	ids := idx.IDs("mat ")

	compared, withoutStyle := 0, 0
	styleDiffs, texDiffs := 0, 0
	var styleExamples, texExamples []string
	addExample := func(list *[]string, line string) {
		if len(*list) < 10 {
			*list = append(*list, line)
		}
	}

	for _, id := range ids {
		data, err := os.ReadFile(filepath.Join(matDir, strconv.FormatInt(int64(id), 10)+".json"))
		if err != nil {
			t.Fatalf("oracle mat %d: %v", id, err)
		}
		var want struct {
			StyleInfo *oracleMatStyleInfo `json:"style_info"`
			Textures  map[string]int64    `json:"textures"`
		}
		if err := json.Unmarshal(data, &want); err != nil {
			t.Fatalf("parse oracle mat %d: %v", id, err)
		}

		root, err := rootStruct(idx, id)
		if err != nil {
			t.Fatalf("mat %d: %v", id, err)
		}
		lay, err := ReadMaterial(root)
		if err != nil {
			t.Fatalf("mat %d: read layout: %v", id, err)
		}
		got, err := ProcessMaterial(lay)
		if err != nil {
			t.Fatalf("mat %d: process: %v", id, err)
		}
		compared++

		// style_info: null vs non-null, then each field exactly.
		switch {
		case (want.StyleInfo == nil) != (got.StyleInfo == nil):
			styleDiffs++
			addExample(&styleExamples, fmt.Sprintf("mat %d: null=%v, want null=%v",
				id, got.StyleInfo == nil, want.StyleInfo == nil))
		case want.StyleInfo == nil:
			withoutStyle++
		default:
			w := *want.StyleInfo
			g := *got.StyleInfo
			field := func(name string, gotV, wantV any) bool {
				if gotV == wantV {
					return true
				}
				styleDiffs++
				addExample(&styleExamples, fmt.Sprintf("mat %d: %s: got %v, want %v", id, name, gotV, wantV))
				return false
			}
			for i := 0; i < 2; i++ {
				field(fmt.Sprintf("texel_density[%d]", i), g.TexelDensity[i], float32(w.TexelDensity[i]))
				field(fmt.Sprintf("material_offset[%d]", i), g.MaterialOffset[i], float32(w.MaterialOffset[i]))
			}
			field("stylelist", g.Stylelist, int32(w.Stylelist))
			field("region_name", g.RegionName, int32(w.RegionName))
			field("base_intention", g.BaseIntention, int32(w.BaseIntention))
			field("mask0_red_intention", g.Mask0RedIntention, int32(w.Mask0RedIntention))
			field("mask0_green_intention", g.Mask0GreenIntention, int32(w.Mask0GreenIntention))
			field("mask0_blue_intention", g.Mask0BlueIntention, int32(w.Mask0BlueIntention))
			field("mask1_red_intention", g.Mask1RedIntention, int32(w.Mask1RedIntention))
			field("mask1_green_intention", g.Mask1GreenIntention, int32(w.Mask1GreenIntention))
			field("mask1_blue_intention", g.Mask1BlueIntention, int32(w.Mask1BlueIntention))
			field("supported_layers", int32(g.SupportedLayers), int32(w.SupportedLayers))
		}

		// textures: the Asg / Mask0 / Mask1 keys; absent, 0, and -1 all mean "none".
		for _, key := range []string{"Asg", "Mask0", "Mask1"} {
			gv, gOK := got.Textures[key]
			wv, wOK := want.Textures[key]
			gNone := !gOK || gv == 0 || gv == -1
			wNone := !wOK || wv == 0 || wv == -1
			if gNone != wNone || (!gNone && gv != int32(wv)) {
				texDiffs++
				addExample(&texExamples, fmt.Sprintf("mat %d: %s: got %d (present=%v), want %d (present=%v)",
					id, key, gv, gOK, int32(wv), wOK))
				break
			}
		}
	}

	t.Logf("materials: %d compared (%d with null style_info), style_info diffs %d, texture diffs %d",
		compared, withoutStyle, styleDiffs, texDiffs)
	for _, s := range styleExamples {
		t.Logf("  style_info: %s", s)
	}
	for _, s := range texExamples {
		t.Logf("  textures: %s", s)
	}
	if compared != 47832 {
		t.Errorf("materials: compared %d, want 47832", compared)
	}
	if styleDiffs > 0 {
		t.Errorf("materials: %d style_info differences", styleDiffs)
	}
	if texDiffs > 0 {
		t.Errorf("materials: %d texture differences", texDiffs)
	}
}
