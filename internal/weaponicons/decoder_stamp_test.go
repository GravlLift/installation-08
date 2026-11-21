// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weaponicons

import (
	"os"
	"path/filepath"
	"testing"
)

// TestDecoderStamp — a set with no stamp or an older one is not current; a written one is,
// and the ready checks follow it.
func TestDecoderStamp(t *testing.T) {
	dataDir := t.TempDir()
	dir := OutDir(dataDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.json"), []byte("[]\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if DecoderStampCurrent(dir) || SetReady(dataDir) {
		t.Fatal("a set without a stamp reads current")
	}
	if err := os.WriteFile(filepath.Join(dir, DecoderStampFile), []byte("1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if DecoderStampCurrent(dir) || SetReady(dataDir) {
		t.Fatal("a set stamped by an older decoder reads current")
	}
	if err := WriteDecoderStamp(dir); err != nil {
		t.Fatal(err)
	}
	if !DecoderStampCurrent(dir) || !SetReady(dataDir) {
		t.Fatal("a freshly stamped set is not current")
	}
	if HudSetReady(dataDir) {
		t.Fatal("HudSetReady with no HUD set = true")
	}
}
