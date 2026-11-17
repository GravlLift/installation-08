package reloadsounds

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestManifestStatus(t *testing.T) {
	dir := t.TempDir()
	if built, stale := ManifestStatus(dir); built || stale {
		t.Fatalf("no manifest: built %v stale %v", built, stale)
	}
	if err := writeManifest(dir, &Manifest{Version: ManifestVersion}); err != nil {
		t.Fatal(err)
	}
	if built, stale := ManifestStatus(dir); !built || stale {
		t.Fatalf("current manifest: built %v stale %v", built, stale)
	}
	if err := writeManifest(dir, &Manifest{Version: ManifestVersion - 1}); err != nil {
		t.Fatal(err)
	}
	if built, stale := ManifestStatus(dir); !built || !stale {
		t.Fatalf("older manifest: built %v stale %v", built, stale)
	}
	if err := os.WriteFile(filepath.Join(dir, ManifestName), []byte("{"), 0o644); err != nil {
		t.Fatal(err)
	}
	if built, _ := ManifestStatus(dir); built {
		t.Fatal("an unreadable manifest counts as built")
	}
}

func TestRemoveStaleTakesRemovesOnlyUnlistedTakes(t *testing.T) {
	dir := t.TempDir()
	kept, ventKept, stale := takeName(0x10), takeName(0x20), takeName(0x30)
	others := []string{"announcer.json", "announcer_doublekill_1.ogg", "reload_notes.txt", "hinf_br75.ogg"}
	for _, name := range append([]string{kept, ventKept, stale}, others...) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(dir, takeName(0x40)), 0o755); err != nil {
		t.Fatal(err)
	}
	m := &Manifest{Version: ManifestVersion, Weapons: map[string]map[string]Reload{
		"2b1824d5": {"combat": {Sounds: []Sound{{Takes: []Take{{File: kept}}}}}},
	}, Vents: map[string]map[string]Vent{
		"daf193c7": {"combat": {Enter: VentClip{Sounds: []Sound{{Takes: []Take{{File: ventKept}}}}}}},
	}}
	removed, err := removeStaleTakes(dir, m)
	if err != nil || removed != 1 {
		t.Fatalf("removed %d (%v), want 1", removed, err)
	}
	if _, err := os.Stat(filepath.Join(dir, stale)); !os.IsNotExist(err) {
		t.Fatalf("the unlisted take is still there (%v)", err)
	}
	for _, name := range append([]string{kept, ventKept, takeName(0x40)}, others...) {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("%s was touched: %v", name, err)
		}
	}
}

func TestFramesToMs(t *testing.T) {
	for _, c := range []struct{ frames, fps, ms int }{{58, 30, 1933}, {130, 60, 2167}, {0, 30, 0}, {1, 30, 33}} {
		if got := framesToMs(c.frames, c.fps); got != c.ms {
			t.Errorf("framesToMs(%d, %d) = %d, want %d", c.frames, c.fps, got, c.ms)
		}
	}
}

// TestManifestWritesEmptySoundsAsList: a silent vent loop (and a missing phase) is written with
// `"sounds": []`, never null, which the viewer refuses.
func TestManifestWritesEmptySoundsAsList(t *testing.T) {
	dir := t.TempDir()
	m := &Manifest{Version: ManifestVersion,
		Weapons: map[string]map[string]Reload{"2ac9c2ff": {"combat": {Animation: "a", DurationMs: 400}}},
		Vents:   map[string]map[string]Vent{"daf193c7": {"combat": {Loop: VentClip{Animation: "combat:pistol:pp:vent_loop", DurationMs: 833}}}}}
	if err := writeManifest(dir, m); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, ManifestName))
	if err != nil {
		t.Fatal(err)
	}
	if s := string(raw); strings.Contains(s, "null") || strings.Count(s, `"sounds": []`) != 4 {
		t.Fatalf("manifest:\n%s", s)
	}
}
