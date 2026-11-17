// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package ekurport

import (
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// TestDeployMatIDsMatchEkur compares the set of "mat " GlobalIDs this index finds across
// the whole deploy against the materials folder of a real Ekur dump (one <id>.json per mat
// tag Ekur saw). It skips cleanly when the game or the oracle is absent, so it runs as a
// no-op on machines that have neither.
func TestDeployMatIDsMatchEkur(t *testing.T) {
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

	ids := idx.IDs("mat ")
	got := make(map[int32]bool, len(ids))
	for _, id := range ids {
		got[id] = true
	}

	want, err := oracleMatIDs(oracle)
	if err != nil {
		t.Fatalf("read oracle: %v", err)
	}

	t.Logf("deploy: %s", deploy)
	t.Logf("mat ids in index: %d; in oracle: %d", len(got), len(want))

	var onlyGot, onlyWant []int32
	for id := range got {
		if !want[id] {
			onlyGot = append(onlyGot, id)
		}
	}
	for id := range want {
		if !got[id] {
			onlyWant = append(onlyWant, id)
		}
	}
	if len(onlyGot) == 0 && len(onlyWant) == 0 {
		return
	}
	sort.Slice(onlyGot, func(i, j int) bool { return onlyGot[i] < onlyGot[j] })
	sort.Slice(onlyWant, func(i, j int) bool { return onlyWant[i] < onlyWant[j] })
	t.Errorf("mat id set mismatch: %d only in index, %d only in oracle", len(onlyGot), len(onlyWant))
	t.Logf("first in index, absent from oracle: %v", firstFew(onlyGot))
	t.Logf("first in oracle, absent from index: %v", firstFew(onlyWant))
}

// oracleMatIDs reads the oracle's materials folder and returns the set of mat GlobalIDs
// encoded in its file names ("<id>.json", signed decimal).
func oracleMatIDs(oracle string) (map[int32]bool, error) {
	matDir := filepath.Join(oracle, "materials")
	files, err := os.ReadDir(matDir)
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
			return nil, err
		}
		out[int32(id)] = true
	}
	return out, nil
}

func firstFew(ids []int32) []int32 {
	const n = 8
	if len(ids) > n {
		return ids[:n]
	}
	return ids
}
