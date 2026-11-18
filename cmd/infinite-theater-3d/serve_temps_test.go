// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestRemoveStaleBuildTemps: old intermediates go, fresh ones (a build in progress) and real
// outputs stay, and nothing outside the build folders is touched.
func TestRemoveStaleBuildTemps(t *testing.T) {
	data := t.TempDir()
	now := time.Now()
	old := now.Add(-2 * buildTempMinAge)
	write := func(rel string, mod time.Time) string {
		p := filepath.Join(data, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(p, mod, mod); err != nil {
			t.Fatal(err)
		}
		return p
	}
	gone := []string{
		write("maps/ctf_breaker.high.glb.tex.2169037339.ktx2.part", old),
		write("maps/sgh_streets.high.glb.realign.tmp", old),
		write("maps/x.glb.src", old),
		write("matches/abc/variant.glb.tex", old),
	}
	kept := []string{
		write("maps/ctf_breaker.glb", old),
		write("maps/y.glb.src", now),
		write("ekur/export.tmp", old),
	}
	removeStaleBuildTemps(data, now)
	for _, p := range gone {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("%s still there (err %v)", p, err)
		}
	}
	for _, p := range kept {
		if _, err := os.Stat(p); err != nil {
			t.Errorf("%s removed: %v", p, err)
		}
	}
}
