package himap

// LOCAL-CHANGE (infinite-theater-3d): tests of refs_typees.go and kits_forge.go, without game
// files (kits_forge_gamefiles_test.go reads the installed kits).

import (
	"encoding/binary"
	"math"
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
)

// indexFactice rend un index qui resout chaque GlobalID donne vers son groupe.
func indexFactice(groupes map[uint32]string) *ModuleIndex {
	idx := &ModuleIndex{chemins: []string{"factice"}, parID: map[uint32]refEntree{}}
	for id, g := range groupes {
		idx.parID[id] = refEntree{fichier: himodule.File{Group: g}}
	}
	return idx
}

// TestRefsTypees : seule une valeur suivie du fourCC de son groupe est une reference ; l'entier
// qui tombe sur un GlobalID connu, sans fourCC, n'en est pas une.
func TestRefsTypees(t *testing.T) {
	idx := indexFactice(map[uint32]string{0x79: "scen", 0xfca8a400: "mach"})
	tag := make([]byte, 0x40)
	binary.LittleEndian.PutUint32(tag[0x04:], 0x79) // un entier de propriete
	binary.LittleEndian.PutUint32(tag[0x10:], 0xfca8a400)
	copy(tag[0x10+refOffGroupe:], "hcam") // fourCC ecrit a l'envers
	if got := refsTypeesDuGroupe(tag, idx, "scen"); len(got) != 0 {
		t.Errorf("entier pris pour une reference : %x", got)
	}
	if got := refsTypeesDuGroupe(tag, idx, "mach"); len(got) != 1 || got[0] != 0xfca8a400 {
		t.Errorf("reference typee manquee : %x", got)
	}
}

// TestPoseObjetKit : position, lacet et echelle par axe d'un record d'objet de kit.
func TestPoseObjetKit(t *testing.T) {
	r := make([]byte, kitObjTailleMin)
	put := func(o int, v float32) { binary.LittleEndian.PutUint32(r[o:], math.Float32bits(v)) }
	put(kitObjOffPosition, 0.1)
	put(kitObjOffPosition+4, 0.9)
	put(kitObjOffRotation, float32(math.Pi/2))
	for a := range 3 {
		put(kitObjOffEchelle+4*a, 1)
	}
	put(kitObjOffEchelle+8, 2)
	in := poseObjetKit(r)
	if math.Abs(in.Position[0]-0.1) > 1e-6 || math.Abs(in.Position[1]-0.9) > 1e-6 {
		t.Errorf("position %v", in.Position)
	}
	if math.Abs(in.Forward[1]-1) > 1e-6 || in.Scale != [3]float64{1, 1, 2} {
		t.Errorf("avant %v echelle %v", in.Forward, in.Scale)
	}
}

// TestComposeInstance : un point du repere d'un objet de kit va a parent(local(v)).
func TestComposeInstance(t *testing.T) {
	parent := Instance{Scale: [3]float64{2, 2, 2}, Position: [3]float64{10, 0, 0},
		Forward: [3]float64{0, 1, 0}, Left: [3]float64{-1, 0, 0}, Up: [3]float64{0, 0, 1}}
	local := Instance{Scale: [3]float64{1, 1, 3}, Position: [3]float64{1, 0, 0},
		Forward: [3]float64{1, 0, 0}, Left: [3]float64{0, 1, 0}, Up: [3]float64{0, 0, 1}}
	for _, v := range [][3]float64{{0, 0, 0}, {1, 2, 3}, {-0.5, 0.25, 1}} {
		veut := parent.LocalToWorld(local.LocalToWorld(v))
		got := composeInstance(parent, local).LocalToWorld(v)
		for a := range 3 {
			if math.Abs(got[a]-veut[a]) > 1e-9 {
				t.Fatalf("v %v : %v, attendu %v", v, got, veut)
			}
		}
	}
}

// TestKitAvecMachine : un kit ne se pose que s'il compte une machine.
func TestKitAvecMachine(t *testing.T) {
	if kitAvecMachine([]objetKit{{groupe: "scen"}, {groupe: GroupeBloc}}) {
		t.Error("kit de decors pris pour un dispositif")
	}
	if !kitAvecMachine([]objetKit{{groupe: "scen"}, {groupe: GroupeMachine}}) {
		t.Error("ratelier (plaque et machine) ecarte")
	}
}
