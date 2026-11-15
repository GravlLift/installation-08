package main

// setup_coatings_test.go — the setup-coatings subcommand's refusals, which happen before
// any export write: the IT3D_EKUR_DIR override, and a --game folder that is not a deploy
// folder. The run itself is covered by internal/ekursetup.

import (
	"errors"
	"os"
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
	if _, err := os.Stat(spartanpieces.DataEkurDir(data)); err == nil {
		t.Fatal("a refused setup wrote an export")
	}
}
