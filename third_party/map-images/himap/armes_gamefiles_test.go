//go:build gamefiles

package himap

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// TestArsenalBR75 : le BR75 du film (weap 0x2B1824D5) sort de l'arsenal de Recharge avec ses
// materiaux de surface dure peints, et un tag qui n'est pas une arme est refuse.
func TestArsenalBR75(t *testing.T) {
	racine, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	levels, err := LevelsDir("pc")
	if err != nil {
		t.Skip(err)
	}
	a, err := OuvreArsenal(racine, filepath.Join(levels, "sgh_blueprint", "sgh_blueprint-rtx-new.module"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = a.Close() }()
	ctx := context.Background()
	m, err := a.Arme(ctx, 0x2B1824D5)
	if err != nil {
		t.Fatal(err)
	}
	if n := m.Structure.Triangles(); n < 50_000 || n > 80_000 {
		t.Errorf("triangles = %d, attendu ~67 000", n)
	}
	mn, mx, _ := boiteDesSommets(m.Structure.Sommets)
	if mn[0] > -0.05 || mx[0] < 0.15 {
		t.Errorf("boite %v %v : l'origine n'est pas a la poignee", mn, mx)
	}
	var buf bytes.Buffer
	if err := EcritGLB(&buf, m, "test", nil); err != nil {
		t.Fatal(err)
	}
	if peintes := materiauxPeints(t, buf.Bytes()); peintes < 10 {
		t.Errorf("%d materiaux de surface dure peints, attendu la plupart des 15", peintes)
	}
	if dst := os.Getenv("DIAG_GLB"); dst != "" {
		if err := os.WriteFile(dst, buf.Bytes(), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := a.Arme(ctx, 0x00002690); !errors.Is(err, ErrSansModele) {
		t.Errorf("tag de materiau : err = %v, attendu ErrSansModele", err)
	}
}

// materiauxPeints compte les materiaux du GLB marques surface dure et porteurs d'une couleur cuite.
func materiauxPeints(t *testing.T, glb []byte) int {
	t.Helper()
	n := binary.LittleEndian.Uint32(glb[12:16])
	var doc gltfDoc
	if err := json.Unmarshal(glb[20:20+n], &doc); err != nil {
		t.Fatal(err)
	}
	peints := 0
	for _, g := range doc.Materials {
		if g.Extras["surfaceDure"] == true && g.PBR.BaseColorTexture != nil {
			peints++
		}
	}
	return peints
}
