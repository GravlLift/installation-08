//go:build gamefiles

package himap

import (
	"path/filepath"
	"testing"
)

// LOCAL-CHANGE (infinite-theater-3d): Breaker's pale frigate surfaces use this shader.
func TestBreakerFrigateMaterialGameFiles(t *testing.T) {
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
	tag, err := a.mats.Extract(0xa8463fea)
	if err != nil {
		t.Fatal(err)
	}
	m, err := LitMateriau(0xa8463fea, tag, lecteurShaders(a.geo), lecteurStyles(a.mats))
	if err != nil {
		t.Fatal(err)
	}
	if m.Couches == nil || len(m.Couches.Couches) == 0 {
		t.Fatal("frigate material has no color layer")
	}
	layer := m.Couches.Couches[0]
	if layer.Bitmap != 0xbe99853c || layer.Normale != 0xeb0b8206 || layer.Haut[0] < 0.1 || layer.Haut[0] > 0.12 {
		t.Fatalf("unexpected base layer: %+v", layer)
	}
}
