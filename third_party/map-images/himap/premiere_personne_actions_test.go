package himap

import (
	"fmt"
	"testing"
)

// TestEtiquetteCherchee (LOCAL-CHANGE): a label text is searched by its StringID; a label given in
// its StringID form is searched as is, whatever the case of its digits; a text that only looks
// like that form is hashed.
func TestEtiquetteCherchee(t *testing.T) {
	cas := []struct{ nom, attendu string }{
		{"knockback", "#ecdf086f"},
		{"equipment_activate", "#5eb2a3de"},
		{JeuMurDeploye, "#6132b1e2"},
		{"#6132B1E2", "#6132b1e2"},
		{"#6132b1e", fmt.Sprintf("#%08x", NomAnimation("#6132b1e"))},
		{"#6132b1zz", fmt.Sprintf("#%08x", NomAnimation("#6132b1zz"))},
	}
	for _, c := range cas {
		if got := EtiquetteCherchee(c.nom); got != c.attendu {
			t.Errorf("EtiquetteCherchee(%q) = %q, attendu %q", c.nom, got, c.attendu)
		}
	}
	if got := NomActionDuJeu(JeuMurDeploye, ActionUsageEquipement); got != "#6132b1e2:equipment_activate" {
		t.Errorf("nom du clip du mur : %q", got)
	}
}
