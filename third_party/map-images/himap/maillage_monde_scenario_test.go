package himap

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func TestStructuresNommeesModuleScenario(t *testing.T) {
	dir := t.TempDir()
	geo := filepath.Join(dir, "geometrie.module")
	carte := filepath.Join(dir, "carte.module")
	for _, tc := range []struct {
		opts    OptionsCuisson
		attendu string
	}{
		{OptionsCuisson{CheminModule: geo, CheminModuleCarte: carte}, carte},
		{OptionsCuisson{CheminModule: geo}, geo},
	} {
		_, err := structuresNommees(context.Background(), tc.opts)
		if err == nil || !strings.Contains(err.Error(), tc.attendu) {
			t.Fatalf("module attendu %s, erreur %v", tc.attendu, err)
		}
	}
}
