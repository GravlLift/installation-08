// LOCAL-CHANGE (infinite-theater-3d): pins the Forge `rtgo` pivot rule (origine_forge.go).
package himap

import (
	"fmt"
	"math"
	"testing"
)

// TestOrigineRtgo: a re-centred `rtgo` takes its own `mode`'s pivot (box corner or centre); a
// `mode` of another size, or none, keeps the base on the position.
func TestOrigineRtgo(t *testing.T) {
	rmn, rmx := [3]float64{-0.3, -1, -0.2}, [3]float64{0.3, 1, 0.2}
	cas := []struct {
		nom      string
		mmn, mmx [3]float64
		lu       bool
		veut     [3]float64
	}{
		{"corner pivot", [3]float64{0, -1, -0.4}, [3]float64{0.6, 1, 0}, true, [3]float64{0.3, 0, -0.2}},
		{"centre pivot (column)", rmn, rmx, true, [3]float64{}},
		{"other box", [3]float64{0, 0, 0}, [3]float64{2, 2, 2}, true, [3]float64{0, 0, 0.2}},
		{"no mode", [3]float64{}, [3]float64{}, false, [3]float64{0, 0, 0.2}},
	}
	for _, c := range cas {
		got := origineRtgo(rmn, rmx, c.mmn, c.mmx, c.lu)
		for k := range 3 {
			if math.Abs(got[k]-c.veut[k]) > 1e-9 {
				t.Errorf("%s: %v, want %v", c.nom, got, c.veut)
				break
			}
		}
	}
}

// TestSectionsDeLaRepresentation: a representation draws the permutation named after it (the
// "forge" permutation of Fortress's -960331706), else the region named after it, else nothing
// (the caller keeps the default permutations).
func TestSectionsDeLaRepresentation(t *testing.T) {
	const defaut, forge, autre = 1120495519, 528041935, 77
	regions := []Region{
		{Name: defaut, Permutations: []Permutation{
			{Name: defaut, SectionIndex: 0, SectionCount: 2},
			{Name: forge, SectionIndex: 2, SectionCount: 2},
		}},
		{Name: autre, Permutations: []Permutation{{Name: defaut, SectionIndex: 4, SectionCount: 1}, {Name: 9, SectionIndex: -1}}},
	}
	cas := []struct {
		nom  uint32
		veut []int
	}{
		{forge, []int{2, 3}},
		{defaut, []int{0, 1, 4}},
		{autre, []int{4}},
		{12345, nil},
	}
	for _, c := range cas {
		if got := sectionsDeLaRepresentation(regions, c.nom); fmt.Sprint(got) != fmt.Sprint(c.veut) {
			t.Errorf("representation %d: sections %v, want %v", c.nom, got, c.veut)
		}
	}
}

// TestDecale: the offset is scaled per local axis and follows the pose's basis.
func TestDecale(t *testing.T) {
	in := Instance{
		Position: [3]float64{10, 20, 30},
		Scale:    [3]float64{2, 3, 4},
		Forward:  [3]float64{0, 1, 0},
		Left:     [3]float64{-1, 0, 0},
		Up:       [3]float64{0, 0, 1},
	}
	if p := in.decale([3]float64{1, 1, 0.5}).Position; p != [3]float64{7, 22, 32} {
		t.Errorf("position %v, want [7 22 32]", p)
	}
}
