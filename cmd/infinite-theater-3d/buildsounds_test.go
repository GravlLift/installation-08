// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// TestAnnouncerFolderFallsBackToEnglish — a language whose folder holds no announcer package
// reads the English one; a language that has one reads its own; an unknown code is an error.
func TestAnnouncerFolderFallsBackToEnglish(t *testing.T) {
	game := t.TempDir()
	deploy := filepath.Join(game, "deploy")
	sound := filepath.Join(game, "Sound", "win")
	for _, f := range []string{
		filepath.Join(sound, "English(US)", "sb_001_vo_ai_mp_announcer.pck"),
		filepath.Join(sound, "French(France)", "sb_001_vo_ai_un_mpspartan01_frontend.pck"),
	} {
		if err := os.MkdirAll(filepath.Dir(f), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(f, []byte("AKPK"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	ctx := context.Background()
	code, folder, err := announcerFolder(ctx, deploy, "fr")
	if err != nil || code != "en" || filepath.Base(folder) != "English(US)" {
		t.Fatalf("fr without announcer: %q %q %v", code, folder, err)
	}
	if err := os.WriteFile(filepath.Join(sound, "French(France)", "sb_001_vo_ai_mp_announcer.pck"), []byte("AKPK"), 0o600); err != nil {
		t.Fatal(err)
	}
	code, folder, err = announcerFolder(ctx, deploy, "fr")
	if err != nil || code != "fr" || filepath.Base(folder) != "French(France)" {
		t.Fatalf("fr with announcer: %q %q %v", code, folder, err)
	}
	if _, _, err := announcerFolder(ctx, deploy, "de"); err == nil {
		t.Fatal("an unknown language was accepted")
	}
}

// TestAnnouncerFolderDiscoversWhenEnglishMissing — the tester's report this was built for: an
// install with only a French announcer package, asked for the default "en", reads French instead
// of failing with "no announcer package in .../English(US)".
func TestAnnouncerFolderDiscoversWhenEnglishMissing(t *testing.T) {
	game := t.TempDir()
	deploy := filepath.Join(game, "deploy")
	sound := filepath.Join(game, "Sound", "win")
	pack := filepath.Join(sound, "French(France)", "sb_001_vo_ai_mp_announcer.pck")
	if err := os.MkdirAll(filepath.Dir(pack), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(pack, []byte("AKPK"), 0o600); err != nil {
		t.Fatal(err)
	}
	code, folder, err := announcerFolder(context.Background(), deploy, "en")
	if err != nil || code != "fr" || filepath.Base(folder) != "French(France)" {
		t.Fatalf("en with only French installed: %q %q %v", code, folder, err)
	}
}

// TestAnnouncerFolderNoneInstalled — an install with no announcer package in any language is a
// clear error, not the raw "no announcer package in <English(US) path>" the French tester saw.
func TestAnnouncerFolderNoneInstalled(t *testing.T) {
	game := t.TempDir()
	deploy := filepath.Join(game, "deploy")
	sound := filepath.Join(game, "Sound", "win")
	if err := os.MkdirAll(filepath.Join(sound, "English(US)"), 0o750); err != nil {
		t.Fatal(err)
	}
	if _, _, err := announcerFolder(context.Background(), deploy, "en"); err == nil {
		t.Fatal("an install with no announcer package anywhere was accepted")
	}
}
