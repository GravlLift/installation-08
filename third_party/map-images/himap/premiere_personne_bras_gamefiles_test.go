//go:build gamefiles

package himap

import (
	"context"
	"errors"
	"testing"
)

func TestPiecesBrasManifestePremierePersonne(t *testing.T) {
	a := ouvreArsenalRecharge(t)
	r, err := a.OuvreBrasPremierePersonne()
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []CleArmure{
		{0x62059329, 0x16a12dd4}, {0x7c8065e9, 0x16a12dd4}, {0x3f91af6a, 0x16a12dd4},
		{0xbb7733d0, 0x16a12dd4}, {0xab25d202, 0x16a12dd4}, {0xb2e84b97, 0x16a12dd4},
		{0xa3bf50c6, 0x101f4ba9}, {0x4e91a821, 0x101f4ba9}, {0xdcb69b0f, 0x101f4ba9},
		{0x67548bfd, 0x101f4ba9}, {0x006f42a8, 0x1f6b0ea7}, {0xb64a2796, 0x1f6b0ea7},
	} {
		m, err := r.Piece(context.Background(), c)
		if err != nil {
			if !errors.Is(err, ErrPieceSansGeometrie) {
				t.Fatalf("%s: %v", c, err)
			}
			t.Logf("%s MISSING: %v", c, err)
			continue
		}
		t.Logf("%s %d triangles", c, m.Maillage.Structure.Triangles())
	}
	normal, err := a.RigPremierePersonne(context.Background(), armesFPArene[0].weap, nil)
	if err != nil {
		t.Fatal(err)
	}
	sans, err := a.RigPremierePersonneSansBras(context.Background(), armesFPArene[0].weap)
	if err != nil {
		t.Fatal(err)
	}
	if sans.SommetsBras != 0 || normal.SommetsBras == 0 || len(sans.Modele.Noeuds) != len(normal.Modele.Noeuds) || len(sans.Clips) != len(normal.Clips) || sans.Modele.Maillage.Structure.Triangles() >= normal.Modele.Maillage.Structure.Triangles() {
		t.Fatal("rig sans bras : geometrie, squelette ou clips incorrects")
	}

}
