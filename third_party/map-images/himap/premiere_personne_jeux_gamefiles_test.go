//go:build gamefiles

package himap

// LOCAL-CHANGE: which first-person equipment set each ability of the multiplayer palette plays.

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
)

// Where an item `eqip` names its first-person equipment set: the block of the root's field 0x904,
// word 0x338 (zero on the `eqip` objects an ability places in the world).
const (
	eqipChampJeuFP = 0x904
	eqipOffJeuFP   = 0x338
)

// paletteFamilleA : the family A ability palette (`sofd`), whose ranks the film transmits.
const paletteFamilleA uint32 = 0xd91958af

// jeuxAttendusParRang : the set each family A rank's item names, "" when none does (the grapple and
// the thruster play their own clips, `grapple_hook_deploy` and `evade_*`).
var jeuxAttendusParRang = map[int]string{
	1: JeuCapteurMenace, 2: JeuMurDeploye, 4: "", 5: "", 6: JeuRepulseur, 8: "camo", 9: "camo",
	10: JeuCapteurMenace, 11: "quantum", 12: JeuCapteurMenace, 19: JeuMurDeploye, 20: "", 21: "",
	22: JeuCapteurMenace, 23: JeuMurDeploye,
}

// TestJeuxPremierePersonneDesEquipements : each family A rank's ability references one item whose
// set field names the set the web plays for that family (equipmentUse3d_logic.ts FP_USE_ACTION),
// and every arena weapon's FP graph carries `equipment_activate` under each of the five sets.
func TestJeuxPremierePersonneDesEquipements(t *testing.T) {
	root, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	c := balayeSofd(t, root)
	palette := c.palettes[paletteFamilleA]
	if len(palette) == 0 {
		t.Fatalf("palette %08x absente", paletteFamilleA)
	}
	items := map[uint32]bool{}
	for rang := range jeuxAttendusParRang {
		for _, e := range c.sofa[palette[rang].sofa].eqip {
			items[e] = true
		}
	}
	jeux := jeuxDesItems(t, root, items)
	for rang, attendu := range jeuxAttendusParRang {
		lu := ""
		for _, e := range c.sofa[palette[rang].sofa].eqip {
			if j := jeux[e]; j != 0 {
				if lu != "" {
					t.Errorf("rang %d : deux items nomment un jeu", rang)
				}
				lu = fmt.Sprintf("#%08x", j)
			}
		}
		want := ""
		if attendu != "" {
			want = EtiquetteCherchee(attendu)
		}
		if lu != want {
			t.Errorf("rang %d : jeu %q, attendu %q (%s)", rang, lu, want, attendu)
		}
	}
	verifieJeuxDesArmes(t)
}

// jeuxDesItems reads the set field of each `eqip` of `ids` in the definition modules, one module
// in memory at a time.
func jeuxDesItems(t *testing.T, root string, ids map[uint32]bool) map[uint32]uint32 {
	t.Helper()
	out := map[uint32]uint32{}
	vus := map[uint32]bool{}
	for _, rel := range ti37Modules {
		m, err := himodule.Open(filepath.Join(root, filepath.FromSlash(rel)))
		if err != nil {
			continue
		}
		for _, f := range m.Files("eqip") {
			if !ids[f.GlobalID] || vus[f.GlobalID] {
				continue
			}
			raw, err := m.Extract(f)
			if err != nil {
				t.Fatalf("eqip %08x : %v", f.GlobalID, err)
			}
			vus[f.GlobalID] = true
			out[f.GlobalID] = jeuDeLItem(t, raw)
		}
	}
	for id := range ids {
		if !vus[id] {
			t.Errorf("eqip %08x absent des modules", id)
		}
	}
	return out
}

// jeuDeLItem returns the StringID of an `eqip`'s set field, 0 when the field is empty.
func jeuDeLItem(t *testing.T, raw []byte) uint32 {
	t.Helper()
	n, err := nouveauNavigateur(raw)
	if err != nil {
		t.Fatal(err)
	}
	r, err := n.racine()
	if err != nil {
		t.Fatal(err)
	}
	b := n.octets(n.tagBlock(r, eqipChampJeuFP))
	if eqipOffJeuFP+4 > len(b) {
		t.Fatalf("champ %#x de %d octets", eqipChampJeuFP, len(b))
	}
	return uint32(u32(b, eqipOffJeuFP))
}

// verifieJeuxDesArmes : every arena weapon's FP graph designates `equipment_activate` under the
// five sets.
func verifieJeuxDesArmes(t *testing.T) {
	ctx := context.Background()
	a := ouvreArsenalRecharge(t)
	for _, w := range armesFPArene {
		gs, err := a.GraphesDepuis(ctx, w.graphe)
		if err != nil {
			t.Fatal(err)
		}
		for _, jeu := range []string{JeuRepulseur, JeuCapteurMenace, "camo", "quantum", JeuMurDeploye} {
			clips, err := gs.ClipsDeLActionDuJeu(jeu, ActionUsageEquipement)
			if err != nil || len(clips) == 0 {
				t.Errorf("%s : %s absent (%v)", w.nom, NomActionDuJeu(jeu, ActionUsageEquipement), err)
				continue
			}
			if w.nom == "BR75" {
				an := clips[0].Animation()
				t.Logf("BR75 %s : %d images a %d/s (%.2f s)", clips[0].Action, an.Images, CadenceAnimation(an),
					float64(an.Images)/float64(CadenceAnimation(an)))
			}
		}
	}
}
