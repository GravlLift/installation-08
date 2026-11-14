package main

import (
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
	code, folder, err := announcerFolder(deploy, "fr")
	if err != nil || code != "en" || filepath.Base(folder) != "English(US)" {
		t.Fatalf("fr without announcer: %q %q %v", code, folder, err)
	}
	if err := os.WriteFile(filepath.Join(sound, "French(France)", "sb_001_vo_ai_mp_announcer.pck"), []byte("AKPK"), 0o600); err != nil {
		t.Fatal(err)
	}
	code, folder, err = announcerFolder(deploy, "fr")
	if err != nil || code != "fr" || filepath.Base(folder) != "French(France)" {
		t.Fatalf("fr with announcer: %q %q %v", code, folder, err)
	}
	if _, _, err := announcerFolder(deploy, "de"); err == nil {
		t.Fatal("an unknown language was accepted")
	}
}
