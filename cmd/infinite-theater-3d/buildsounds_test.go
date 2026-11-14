package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
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

// TestFindDecoder — the flag wins and must exist; with no flag the copy in tools\vgmstream next
// to the program is used; with neither (and nothing on PATH) the error names where it belongs.
func TestFindDecoder(t *testing.T) {
	t.Setenv("PATH", "")
	exeDir := t.TempDir()
	if _, err := findDecoder(filepath.Join(exeDir, "missing.exe"), exeDir); err == nil {
		t.Fatal("a missing --decoder was accepted")
	}
	if _, err := findDecoder("", exeDir); err == nil || !strings.Contains(err.Error(), bundledDecoderDir) {
		t.Fatalf("no decoder: %v", err)
	}
	name := decoderCommand
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	bundled := filepath.Join(exeDir, bundledDecoderDir, name)
	if err := os.MkdirAll(filepath.Dir(bundled), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bundled, []byte("MZ"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got, err := findDecoder("", exeDir); err != nil || got != bundled {
		t.Fatalf("bundled: %q %v", got, err)
	}
	other := filepath.Join(t.TempDir(), "vgmstream-cli.exe")
	if err := os.WriteFile(other, []byte("MZ"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got, err := findDecoder(other, exeDir); err != nil || got != other {
		t.Fatalf("flag: %q %v", got, err)
	}
}
