//go:build gamefiles

// LOCAL-CHANGE (infinite-theater-3d): covers couplesAuGrapheDesDependances.

package himap

import (
	"context"
	"testing"
)

// TestVestigePremierePersonne: the Vestige Carbine's inline FP graph reference (78912884) is
// indexed by no module; its block resolves to the one `jmad` of its dependency table, and the
// rig builds with the arms (the arm bones and the weapon root under `b_r_hand`).
func TestVestigePremierePersonne(t *testing.T) {
	a := ouvreArsenalRecharge(t)
	s, err := a.SourcesArme(0x3e070217)
	if err != nil {
		t.Fatal(err)
	}
	if s.Mode != 0x06a0a0bd || s.Graphe != 0xd7292132 {
		t.Errorf("vestige: mode %08x graph %08x, want 06a0a0bd d7292132", s.Mode, s.Graphe)
	}
	bras, err := a.SourcesBras()
	if err != nil {
		t.Fatal(err)
	}
	brasRaw, _ := a.geo.Extract(bras.Mode)
	osBras, _ := ModeNodes(brasRaw)
	gs, err := a.GraphesDepuis(context.Background(), s.Graphe)
	if err != nil {
		t.Fatal(err)
	}
	verifieOsDuGraphe(t, "Vestige", gs.Propre, osBras, modeNoeuds(t, a, s.Mode))
	if _, err := a.RigPremierePersonne(context.Background(), 0x3e070217, nil); err != nil {
		t.Errorf("vestige rig: %v", err)
	}
	// The fallback rescues no other weapon: every arena weapon keeps its inline graph.
	for _, w := range armesFPArene {
		if s, err := a.SourcesArme(w.weap); err != nil || s.Graphe != w.graphe {
			t.Errorf("%s: graph %08x err %v, want %08x", w.nom, s.Graphe, err, w.graphe)
		}
	}
}
