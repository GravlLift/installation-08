package himap

import (
	"encoding/binary"
	"math"
	"testing"
)

// recordPlacement fabrique un record de placement de `stride` octets.
func recordPlacement(stride int, tag uint32, groupe string, pos, rot [3]float32, echelle float32) []byte {
	r := make([]byte, stride)
	binary.LittleEndian.PutUint32(r[placOffTag:], tag)
	copy(r[placOffGroupe:], []byte{groupe[3], groupe[2], groupe[1], groupe[0]})
	for k := 0; k < 3; k++ {
		binary.LittleEndian.PutUint32(r[placOffPosition+4*k:], math.Float32bits(pos[k]))
		binary.LittleEndian.PutUint32(r[placOffRotation+4*k:], math.Float32bits(rot[k]))
	}
	binary.LittleEndian.PutUint32(r[placOffEchelle:], math.Float32bits(echelle))
	return r
}

// TestLisBlocPlacements : un bloc dont tous les records nomment un groupe pose se lit ; un bloc
// d'un autre groupe, ou melange, ne se lit pas.
func TestLisBlocPlacements(t *testing.T) {
	const stride = 0x60
	bloc := append(recordPlacement(stride, 0xAB, "mach", [3]float32{1, 2, 3}, [3]float32{0.5, 0, 0}, 1),
		recordPlacement(stride, 0xCD, "mach", [3]float32{4, 5, 6}, [3]float32{0, 0, 0}, 2.5)...)
	got := lisBlocPlacements(bloc, stride)
	if len(got) != 2 || got[0].Tag != 0xAB || got[0].Groupe != "mach" || got[0].Position != [3]float64{1, 2, 3} ||
		got[0].Lacet != 0.5 || got[1].Echelle != 2.5 {
		t.Fatalf("placements %+v", got)
	}
	if lisBlocPlacements(recordPlacement(stride, 1, "effe", [3]float32{}, [3]float32{}, 1), stride) != nil {
		t.Fatal("un bloc d'effets n'est pas un bloc de placements")
	}
	melange := append(recordPlacement(stride, 1, "bloc", [3]float32{}, [3]float32{}, 1),
		recordPlacement(stride, 2, "effe", [3]float32{}, [3]float32{}, 1)...)
	if lisBlocPlacements(melange, stride) != nil {
		t.Fatal("un bloc melange n'est pas un bloc de placements")
	}
}

// TestVariantePlacement : le nom de variante se lit a +0x194 d'un record assez long, 0 sinon.
func TestVariantePlacement(t *testing.T) {
	long := recordPlacement(placOffVariante+4, 1, "bloc", [3]float32{}, [3]float32{}, 1)
	binary.LittleEndian.PutUint32(long[placOffVariante:], 0x69ca01eb)
	if got := lisBlocPlacements(long, len(long)); len(got) != 1 || got[0].Variante != 0x69ca01eb {
		t.Fatalf("variante %+v", got)
	}
	if got := lisBlocPlacements(recordPlacement(0x60, 1, "bloc", [3]float32{}, [3]float32{}, 1), 0x60); got[0].Variante != 0 {
		t.Fatalf("record court : %+v", got)
	}
}

// TestDonneesMultiJoueur : le compteur du bloc `multiplayer data` (a la fin du record) marque
// un placement de mode de jeu ; un record trop court ne le porte pas.
func TestDonneesMultiJoueur(t *testing.T) {
	// Un record assez long pour porter le bloc (20 octets a la fin).
	stride := placTailleMinMJ
	r := recordPlacement(stride, 1, "mach", [3]float32{}, [3]float32{}, 1)
	// Compteur a 0 : pas de donnees multi-joueur.
	if got := lisBlocPlacements(r, stride); len(got) != 1 || got[0].DonneesMultiJoueur {
		t.Fatalf("sans MJ : %+v", got)
	}
	// Compteur a 1 : donnees multi-joueur.
	binary.LittleEndian.PutUint32(r[stride-4:], 1)
	if got := lisBlocPlacements(r, stride); len(got) != 1 || !got[0].DonneesMultiJoueur {
		t.Fatalf("avec MJ : %+v", got)
	}
	// Un record trop court : pas de bloc.
	if got := lisBlocPlacements(recordPlacement(0x200, 1, "mach", [3]float32{}, [3]float32{}, 1), 0x200); got[0].DonneesMultiJoueur {
		t.Fatalf("record court : %+v", got)
	}
}

// TestPermutationDeLaRegion : la variante choisit la permutation qu'elle nomme ; une region
// qu'elle ne nomme pas garde la premiere ; un nom que la region ne porte pas ne dessine rien.
func TestPermutationDeLaRegion(t *testing.T) {
	r := Region{Name: 0xA, Permutations: []Permutation{{Name: 0x1, SectionIndex: 0}, {Name: 0x2, SectionIndex: 30}}}
	if p, ok := permutationDeLaRegion(r, nil); !ok || p.SectionIndex != 0 {
		t.Fatalf("defaut : %+v %v", p, ok)
	}
	if p, ok := permutationDeLaRegion(r, VarianteModele{0xA: 0x2}); !ok || p.SectionIndex != 30 {
		t.Fatalf("variante : %+v %v", p, ok)
	}
	if p, ok := permutationDeLaRegion(r, VarianteModele{0xB: 0x2}); !ok || p.SectionIndex != 0 {
		t.Fatalf("region non nommee : %+v %v", p, ok)
	}
	if _, ok := permutationDeLaRegion(r, VarianteModele{0xA: 0x9}); ok {
		t.Fatal("permutation absente du mode : rien a dessiner")
	}
}

// TestInstancePlacement : le lacet tourne l'avant autour de Z, le tangage le leve, l'echelle
// s'applique avant la base.
func TestInstancePlacement(t *testing.T) {
	proche := func(a, b [3]float64) bool {
		for k := range a {
			if math.Abs(a[k]-b[k]) > 1e-9 {
				return false
			}
		}
		return true
	}
	in := PlacementScenario{Position: [3]float64{10, 0, 0}, Lacet: math.Pi / 2, Echelle: 2}.Instance()
	if !proche(in.Forward, [3]float64{0, 1, 0}) || !proche(in.Left, [3]float64{-1, 0, 0}) || !proche(in.Up, [3]float64{0, 0, 1}) {
		t.Fatalf("lacet : %v %v %v", in.Forward, in.Left, in.Up)
	}
	if w := in.LocalToWorld([3]float64{1, 0, 0}); !proche(w, [3]float64{10, 2, 0}) {
		t.Fatalf("pose %v", w)
	}
	in = PlacementScenario{Tangage: math.Pi / 2, Echelle: 1}.Instance()
	if !proche(in.Forward, [3]float64{0, 0, 1}) || !proche(in.Up, [3]float64{-1, 0, 0}) {
		t.Fatalf("tangage : %v %v", in.Forward, in.Up)
	}
}

// TestVitre : un materiau de la passe transparente sans couche, ou au shader de verre, est une
// vitre, publiee translucide et marquee ; un decalque de la passe transparente garde ses couches
// et reste opaque.
func TestVitre(t *testing.T) {
	table := map[uint32]Materiau{
		0xA: {ID: 0xA, PasseTransparente: true},
		0xB: {ID: 0xB, PasseTransparente: true, Couches: &Couches{}},
		0xC: {ID: 0xC, Verre: true, Couches: &Couches{}},
	}
	for _, id := range []uint32{0xA, 0xC} {
		if g := materiauGLTF(id, table); g.AlphaMode != "BLEND" || g.Extras["vitre"] != true {
			t.Fatalf("vitre %x : %+v", id, g)
		}
	}
	if g := materiauGLTF(0xB, table); g.AlphaMode != "OPAQUE" || g.Extras["vitre"] != nil {
		t.Fatalf("decalque : %+v", g)
	}
}

// TestVitresConstatees : le constat en jeu l'emporte sur les marqueurs lus, dans les deux sens.
func TestVitresConstatees(t *testing.T) {
	var vitre, opaque uint32
	for id, v := range vitresConstatees {
		if v {
			vitre = id
		} else {
			opaque = id
		}
	}
	if vitre == 0 || opaque == 0 {
		t.Fatal("la table doit porter un constat de chaque sens")
	}
	if !(Materiau{ID: vitre}).Vitre() {
		t.Fatalf("%08x constatee vitre, lue opaque", vitre)
	}
	if (Materiau{ID: opaque, Verre: true, Couches: &Couches{}}).Vitre() {
		t.Fatalf("%08x constatee opaque, lue vitre", opaque)
	}
}
