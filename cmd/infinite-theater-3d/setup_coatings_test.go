package main

// setup_coatings_test.go — the setup-coatings subcommand's refusals, which happen before
// any download: the IT3D_EKUR_DIR override, and a --game folder that is not a deploy
// folder. The run itself is covered by internal/ekursetup against a fake dumper.

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/ekursetup"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
)

func TestSetupCoatingsRefusals(t *testing.T) {
	data := t.TempDir()
	game := t.TempDir() // no pc folder: not a deploy folder

	t.Setenv(spartanpieces.EkurEnv, t.TempDir())
	if err := run([]string{"setup-coatings", "--data", data, "--game", game}); !errors.Is(err, ekursetup.ErrOverride) {
		t.Fatalf("override: err = %v, want ErrOverride", err)
	}

	t.Setenv(spartanpieces.EkurEnv, "")
	if err := run([]string{"setup-coatings", "--data", data, "--game", game}); !errors.Is(err, ekursetup.ErrNoGame) {
		t.Fatalf("no deploy folder: err = %v, want ErrNoGame", err)
	}
	if _, err := os.Stat(filepath.Join(ekursetup.ToolsDir(data), ekursetup.PinnedExe.Name)); err == nil {
		t.Fatal("a refused setup downloaded the dumper")
	}
}
