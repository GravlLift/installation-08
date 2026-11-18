//go:build gamefiles

// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
package mapmesh

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

func TestVehicleSeatAnimationsGameFiles(t *testing.T) {
	root, err := himap.DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	levels, err := himap.LevelsDir("pc")
	if err != nil {
		t.Skip(err)
	}
	a, err := himap.OuvreArsenal(root, filepath.Join(levels, "ctf_breaker", "ctf_breaker-rtx-new.module"))
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	m, err := a.ModeleAPeau(context.Background(), himap.ModeSpartan)
	if err != nil {
		t.Fatal(err)
	}
	clips := bodyAnimationClips(context.Background(), a, m.Noeuds)
	names := map[string]bool{}
	for _, clip := range clips {
		names[clip.Nom] = true
	}
	for _, name := range []string{"ghost_d:idle", "warthog_d:idle", "warthog_p:rifle:idle", "warthog_g:idle"} {
		if !names[name] {
			t.Errorf("missing seat clip %s", name)
		}
	}
}
