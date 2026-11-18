//go:build gamefiles

// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
package weapons

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

func TestVehicleModelsGameFiles(t *testing.T) {
	root, err := resolveGameRoot("")
	if err != nil {
		t.Skip(err)
	}
	module, ok := installedModule(root, "ctf_breaker")
	if !ok {
		t.Skip("Breaker is not installed")
	}
	a, err := himap.OuvreArsenal(root, module)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	dir := t.TempDir()
	res := Result{}
	if err := buildVehicleModels(context.Background(), a, dir, &res); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"5b80c406", "fe32c0f4"} {
		raw, err := os.ReadFile(filepath.Join(dir, FileOf(key)))
		if err != nil || len(raw) < 1000 {
			t.Fatalf("vehicle %s: %v", key, err)
		}
		var doc struct {
			Asset struct {
				Extras struct {
					Seats map[string][3]float64 `json:"vehicleSeats"`
				} `json:"extras"`
			} `json:"asset"`
		}
		n := int(binary.LittleEndian.Uint32(raw[12:16]))
		if n > len(raw)-20 {
			t.Fatalf("vehicle %s: invalid JSON chunk", key)
		}
		if err := json.Unmarshal(raw[20:20+n], &doc); err != nil {
			t.Fatal(err)
		}
		if _, ok := doc.Asset.Extras.Seats["0"]; !ok {
			t.Errorf("vehicle %s: missing driver marker", key)
		}
		if key == "fe32c0f4" {
			if _, ok := doc.Asset.Extras.Seats["1"]; !ok {
				t.Error("Warthog: missing passenger marker")
			}
		}
	}
}
