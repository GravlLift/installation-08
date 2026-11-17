// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package announcer

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// makeLanguageFolder writes a fake sound root with one language subfolder per name; those
// listed in withAnnouncer also get a fake announcer package, the rest get an unrelated package
// so the folder exists but is not mistaken for an announcer language.
func makeLanguageFolder(t *testing.T, names []string, withAnnouncer map[string]bool) string {
	t.Helper()
	root := t.TempDir()
	for _, name := range names {
		dir := filepath.Join(root, name)
		if err := os.MkdirAll(dir, 0o750); err != nil {
			t.Fatal(err)
		}
		file := "sb_001_vo_ai_un_mpspartan01_frontend.pck"
		if withAnnouncer[name] {
			file = "sb_001_vo_ai_mp_announcer.pck"
		}
		if err := os.WriteFile(filepath.Join(dir, file), []byte("AKPK"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// TestDiscoverLanguagePrefersEnglish — an install with English(US) among several installed
// languages reads English, even when another sorts first.
func TestDiscoverLanguagePrefersEnglish(t *testing.T) {
	root := makeLanguageFolder(t, []string{"English(US)", "French(France)"}, map[string]bool{"English(US)": true, "French(France)": true})
	name, dir, err := DiscoverLanguage(context.Background(), root)
	if err != nil || name != "English(US)" || filepath.Base(dir) != "English(US)" {
		t.Fatalf("name %q dir %q err %v", name, dir, err)
	}
}

// TestDiscoverLanguageOnlyFrench — an install with only a French announcer package (the tester's
// report this was built for) reads French instead of failing.
func TestDiscoverLanguageOnlyFrench(t *testing.T) {
	root := makeLanguageFolder(t, []string{"French(France)"}, map[string]bool{"French(France)": true})
	name, dir, err := DiscoverLanguage(context.Background(), root)
	if err != nil || name != "French(France)" || filepath.Base(dir) != "French(France)" {
		t.Fatalf("name %q dir %q err %v", name, dir, err)
	}
}

// TestDiscoverLanguageDeterministicAmongNonEnglish — with no English among several installed
// languages, the pick is the alphabetically first one holding an announcer package, every time.
func TestDiscoverLanguageDeterministicAmongNonEnglish(t *testing.T) {
	root := makeLanguageFolder(t, []string{"German(Germany)", "French(France)"}, map[string]bool{"German(Germany)": true, "French(France)": true})
	for i := 0; i < 3; i++ {
		name, dir, err := DiscoverLanguage(context.Background(), root)
		if err != nil || name != "French(France)" || filepath.Base(dir) != "French(France)" {
			t.Fatalf("run %d: name %q dir %q err %v", i, name, dir, err)
		}
	}
}

// TestDiscoverLanguageNoneInstalled — an install whose language folders hold no announcer
// package anywhere is a clear error naming every folder searched, not a panic or a silent guess.
func TestDiscoverLanguageNoneInstalled(t *testing.T) {
	root := makeLanguageFolder(t, []string{"English(US)", "French(France)"}, map[string]bool{})
	_, _, err := DiscoverLanguage(context.Background(), root)
	if err == nil {
		t.Fatal("an install with no announcer package anywhere was accepted")
	}
	for _, want := range []string{"English(US)", "French(France)"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("error %q does not name %q", err, want)
		}
	}
}

// TestDiscoverLanguageMissingSoundRoot — a sound root that does not exist (no game install) is
// an error, not a panic.
func TestDiscoverLanguageMissingSoundRoot(t *testing.T) {
	if _, _, err := DiscoverLanguage(context.Background(), filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("a missing sound root was accepted")
	}
}
