//go:build gamefiles

package himap

import (
	"context"
	"path/filepath"
	"testing"
)

func TestArsenalVehicleGameFiles(t *testing.T) {
	root, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	levels, err := LevelsDir("pc")
	if err != nil {
		t.Skip(err)
	}
	a, err := OuvreArsenal(root, filepath.Join(levels, "ctf_breaker", "ctf_breaker-rtx-new.module"))
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	for _, tc := range []struct {
		name string
		id   uint32
	}{{"ghost", 0x5b80c406}, {"warthog", 0xfe32c0f4}} {
		t.Run(tc.name, func(t *testing.T) {
			m, err := a.Vehicule(context.Background(), tc.id)
			if err != nil {
				t.Fatal(err)
			}
			if n := m.Structure.Triangles(); n < 500 {
				t.Fatalf("only %d visible triangles", n)
			}
		})
	}
}
