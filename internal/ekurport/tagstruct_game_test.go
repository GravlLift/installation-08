// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package ekurport

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// TestDeployTagStructReader reads real game tags with the struct reader and checks them
// against a real Ekur dump (oracle). It skips cleanly when the game or IT3D_EKUR_ORACLE is
// absent. The three checks pin the reader against known-correct field offsets read from
// ekur_definitions:
//
//	globals (680672300, CoatingGlobalsTag): block at +0x24, CoatingIntentionDefinition
//	  stride 0x88, name StringID +0x00, fallback StringID +0x04.
//	visor (-1260457915, MaterialVisorSwatchTag): patterns block +0x10, colors block +0x24.
//	material (mat , MaterialTag): style_info block +0x74, element 0's material_style
//	  FieldReference +0x00.
func TestDeployTagStructReader(t *testing.T) {
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

	checkDeployGlobals(t, idx, oracle)
	checkDeployVisor(t, idx, oracle)
	checkDeployMaterials(t, idx, oracle)
}

func checkDeployGlobals(t *testing.T, idx *TagIndex, oracle string) {
	const id = int32(680672300)
	root, err := rootStruct(idx, id)
	if err != nil {
		t.Fatalf("globals: %v", err)
	}
	blk, err := root.Block(0x24, 0x88) // CoatingIntentionDefinition
	if err != nil {
		t.Fatalf("globals Block(0x24): %v", err)
	}
	var oracleGlobals struct {
		Entries map[string]struct {
			Fallback int32 `json:"fallback"`
		} `json:"entries"`
	}
	if err := readOracleJSON(oracle, "globals.json", &oracleGlobals); err != nil {
		t.Fatalf("globals: %v", err)
	}
	if blk.Len() != len(oracleGlobals.Entries) {
		t.Errorf("globals block Len()=%d, want %d (oracle entries)", blk.Len(), len(oracleGlobals.Entries))
	}
	for i := 0; i < blk.Len(); i++ {
		e := blk.At(i)
		nameID, err := e.StringID(0x00)
		if err != nil {
			t.Errorf("globals entry %d name: %v", i, err)
			continue
		}
		nameKey := strconv.FormatInt(int64(int32(nameID)), 10)
		entry, ok := oracleGlobals.Entries[nameKey]
		if !ok {
			t.Errorf("globals entry %d name id %d (%s) not in oracle", i, int32(nameID), nameKey)
			continue
		}
		fbID, err := e.StringID(0x04)
		if err != nil {
			t.Errorf("globals entry %d fallback: %v", i, err)
			continue
		}
		if int32(fbID) != entry.Fallback {
			t.Errorf("globals entry %d (%s) fallback id %d, want %d", i, nameKey, int32(fbID), entry.Fallback)
		}
	}
	t.Logf("globals: %d oracle entries, block Len=%d stride=0x%x", len(oracleGlobals.Entries), blk.Len(), blk.Stride())
}

func checkDeployVisor(t *testing.T, idx *TagIndex, oracle string) {
	const id = int32(-1260457915)
	root, err := rootStruct(idx, id)
	if err != nil {
		t.Fatalf("visor: %v", err)
	}
	patterns, err := root.Block(0x10, 0x20) // MaterialVisorPatternReference
	if err != nil {
		t.Fatalf("visor patterns Block(0x10): %v", err)
	}
	colors, err := root.Block(0x24, 0x30) // MaterialColorVariants
	if err != nil {
		t.Fatalf("visor colors Block(0x24): %v", err)
	}
	var oracleVisor struct {
		Patterns map[string]json.RawMessage `json:"patterns"`
		Colors   map[string]json.RawMessage `json:"colors"`
	}
	if err := readOracleJSON(oracle, "visor_data.json", &oracleVisor); err != nil {
		t.Fatalf("visor: %v", err)
	}
	if patterns.Len() != len(oracleVisor.Patterns) {
		t.Errorf("visor patterns Len()=%d, want %d", patterns.Len(), len(oracleVisor.Patterns))
	}
	if colors.Len() != len(oracleVisor.Colors) {
		t.Errorf("visor colors Len()=%d, want %d", colors.Len(), len(oracleVisor.Colors))
	}
	t.Logf("visor: patterns Len=%d (want %d), colors Len=%d (want %d)",
		patterns.Len(), len(oracleVisor.Patterns), colors.Len(), len(oracleVisor.Colors))
}

func checkDeployMaterials(t *testing.T, idx *TagIndex, oracle string) {
	matDir := filepath.Join(oracle, "materials")
	files, err := os.ReadDir(matDir)
	if err != nil {
		t.Fatalf("read oracle materials: %v", err)
	}
	matched, mismatched := 0, 0
	var mismatches []string
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".json") {
			continue
		}
		id, err := strconv.Atoi(strings.TrimSuffix(f.Name(), ".json"))
		if err != nil {
			continue
		}
		var m struct {
			StyleInfo *struct {
				Stylelist int32 `json:"stylelist"`
			} `json:"style_info"`
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
		want := m.StyleInfo.Stylelist
		got := materialStylelist(idx, int32(id))
		if got == want {
			matched++
			continue
		}
		mismatched++
		if len(mismatches) < 8 {
			mismatches = append(mismatches, fmt.Sprintf("mat %d: stylelist id %d, want %d", id, got, want))
		}
	}
	t.Logf("materials: %d matched, %d mismatched (non-null style_info)", matched, mismatched)
	for _, s := range mismatches {
		t.Logf("  mismatch: %s", s)
	}
	if mismatched > 0 {
		t.Errorf("%d materials did not match the oracle stylelist", mismatched)
	}
}

// rootStruct extracts id, parses it, and returns the main struct.
func rootStruct(idx *TagIndex, id int32) (Struct, error) {
	raw, err := idx.Extract(id)
	if err != nil {
		return Struct{}, fmt.Errorf("extract id %d: %w", id, err)
	}
	tag, err := ParseTag(raw)
	if err != nil {
		return Struct{}, fmt.Errorf("parse id %d: %w", id, err)
	}
	return tag.Root()
}

// materialStylelist returns the global id of the material's style_info block element 0's
// material_style reference, or 0 if the block is absent/empty (a distinct value from any
// real stylelist id the oracle checks).
func materialStylelist(idx *TagIndex, id int32) int32 {
	root, err := rootStruct(idx, id)
	if err != nil {
		return 0
	}
	blk, err := root.Block(0x74, 0) // style_info; stride 0, only At(0) is read
	if err != nil {
		return 0
	}
	gid, _, _ := blk.At(0).TagRef(0x00)
	return gid
}

func readOracleJSON(oracle, name string, out any) error {
	data, err := os.ReadFile(filepath.Join(oracle, name))
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	return nil
}
