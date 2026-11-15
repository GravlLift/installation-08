// LOCAL-CHANGE (infinite-theater-3d): pins the Forge `rtgo` pivot rule (origine_forge.go).
package himap

import (
	"fmt"
	"iter"
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

// TestOrigineParmi: an `rtgo` takes the pivot of the first candidate `mode` of its own size, not
// the first candidate (Origin's rock type -1241957150: Small, Medium and Large `bloc`s, a Medium
// `rtgo` centred on its position); no candidate of its size keeps the base on the position.
func TestOrigineParmi(t *testing.T) {
	rmn, rmx := [3]float64{-10.67, -4.44, -3.99}, [3]float64{10.75, 4.43, 4.00}
	petit := [2][3]float64{{-2.15, -0.89, -0.81}, {2.16, 0.91, 0.80}}
	moyen := [2][3]float64{{-10.76, -4.46, -4.07}, {10.77, 4.56, 4.00}}
	grand := [2][3]float64{{-17.22, -7.14, -6.50}, {17.23, 7.30, 6.40}}
	boites := func(l ...[2][3]float64) iter.Seq2[[3]float64, [3]float64] {
		return func(yield func([3]float64, [3]float64) bool) {
			for _, b := range l {
				if !yield(b[0], b[1]) {
					return
				}
			}
		}
	}
	base := [3]float64{0, 0, 3.99}
	cas := []struct {
		nom    string
		modes  iter.Seq2[[3]float64, [3]float64]
		veut   [3]float64
		pivots int
	}{
		{"second candidate of the rtgo's size", boites(petit, moyen, grand), [3]float64{-0.09, -0.02, -0.08}, 2},
		{"first candidate of the rtgo's size", boites(moyen, petit), [3]float64{-0.09, -0.02, -0.08}, 1},
		{"no candidate of the rtgo's size", boites(petit, grand), base, 2},
		{"no candidate", boites(), base, 0},
	}
	for _, c := range cas {
		lus := 0
		compte := func(yield func([3]float64, [3]float64) bool) {
			for mn, mx := range c.modes {
				lus++
				if !yield(mn, mx) {
					return
				}
			}
		}
		got := origineParmi(rmn, rmx, compte)
		for k := range 3 {
			if math.Abs(got[k]-c.veut[k]) > 1e-9 {
				t.Errorf("%s: %v, want %v", c.nom, got, c.veut)
				break
			}
		}
		if lus != c.pivots {
			t.Errorf("%s: %d candidates read, want %d (stop at the first match)", c.nom, lus, c.pivots)
		}
	}
}

// TestUnMode: one candidate, or none for nil.
func TestUnMode(t *testing.T) {
	n := 0
	for range unMode(nil) {
		n++
	}
	for range unMode(&modelePose{}) {
		n++
	}
	if n != 1 {
		t.Errorf("%d candidates, want 1", n)
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
