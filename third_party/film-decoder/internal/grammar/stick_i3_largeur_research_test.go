//go:build research

package grammar

// stick_i3_largeur_research_test.go — LOCAL-CHANGE (infinite-theater-3d): the bit width of ti=41 i3
// (`object-angular-velocity-component`), decided from the data.
//
// The frame walk reads i3 with the biped's deser (`FUN_140d70998`: R(1) gate, if 0 R(19) + R(8)).
// This instrument re-reads every ti=41 record the walk decoded to its end in which i3 is followed by
// at least one more component, from i3's first bit, under each candidate shape of i3, then consumes
// the following components with their ported desers. A shape is the stream's own when the record
// then ends exactly where the walk found the next record (FinBit) and, for the records whose i10
// opens the attached gate, the parent handle resolves to an entity of the walk's world.
//
// VERDICT (2026-11-16, 17 stored matches, 3 783 records; i3's leading bit is 0 in 3 545 of them,
// 1 in 238): only the dispatch's shape ends every record where the walk found the next one.
//
//	shape (payload when the leading bit is 0)   records ending at the next record   of the 3 545 with payload
//	R(19) + R(8)  (FUN_140d70998, dispatch)     3 783 (100 %)                       3 545
//	R(19) + R(10)                                 240                                   2
//	R(28)                                         242                                   4
//	R(26)                                         243                                   5
//	R(19)                                         252                                  14
//	ti=40 dyn-prec (R(1) outer, R(96) keep)         7                                   7
//	0 bit / 1 bit                               440 / 453                          439 / 215
//
// Under the dispatch's shape, 50 records open the i10 attached gate; 46 parents are entities of the
// walk's world, 41 of them bipeds (ti=35).
//
// USAGE: IT3D_STICK_MATCHES=<...>\data\matches go test -tags research ./internal/grammar/
//
//	-run TestStickI3Largeur -v   (from third_party/film-decoder)

import (
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar/lecture"
	"github.com/JGtm/halo-infinite-film-decoder/internal/source"
)

// formeI3 is a candidate shape: the bits i3 consumes, given its leading bit.
type formeI3 struct {
	nom  string
	lire func(br *Lecteur)
}

func formesI3() []formeI3 {
	gate := func(present uint) func(br *Lecteur) {
		return func(br *Lecteur) {
			if !br.ReadBit() {
				br.ReadBits(present)
			}
		}
	}
	return []formeI3{
		{"R1;0->R19+R8 (FUN_140d70998, dispatch)", gate(27)},
		{"R1;0->R19+R10", gate(29)},
		{"R1;0->R28", gate(28)},
		{"R1;0->R26", gate(26)},
		{"R1;0->R19", gate(19)},
		{"dynprec ti40 R1[1:R96;0:R1[0:R19+R8]]", consumeObjectAngularVelocity},
		{"0 bit", func(*Lecteur) {}},
		{"1 bit", func(br *Lecteur) { br.ReadBit() }},
	}
}

type bilanI3 struct {
	records, alignes int
	// records0 / alignes0: the records whose i3 leading bit is 0 (payload present), the ones that discriminate.
	records0, alignes0 int
	attaches           int
	parentsVivants     int
	parentsBipedes     int
}

type canalI3 struct {
	m      *MarcheDistribuee
	arch   Archetype
	formes []formeI3
	bilans []bilanI3
	// gates: the leading bit of i3 under the walk (true = absent)
	gate1, gate0 int
}

func (c *canalI3) Interets() []Interet {
	return []Interet{{Phase: PhaseTrames, TI: ProjectileTypeIndex, Composant: compObjectParentState}}
}
func (c *canalI3) Clore(BilanDeMarche)                          {}
func (c *canalI3) Brancher(_ *Observation, m *MarcheDistribuee) { c.m = m }
func (c *canalI3) Trame(p *lecture.Paquet) {
	recs, lus := c.m.recordsDeLaTrame()
	if !lus {
		return
	}
	cfg := c.m.cadreDeLaMarche()
	for i := range recs {
		r := &recs[i]
		if r.TypeIndex != ProjectileTypeIndex || r.DesyncAt != -1 {
			continue
		}
		k := -1
		for j, cp := range r.Trace.Comps {
			if cp.Index == 3 {
				k = j
			}
		}
		if k < 0 || k == len(r.Trace.Comps)-1 {
			continue
		}
		start := r.Trace.Comps[k].StartBit
		if source.BitsTolerants(p.Payload, start, 1) == 1 {
			c.gate1++
		} else {
			c.gate0++
		}
		for f, forme := range c.formes {
			br := LecteurSur(p.Payload)
			br.poserCadre(cfg)
			br.SetBitPos(start)
			forme.lire(br)
			consumeCorruptionCheck(br)
			var parent *ObjectParentState
			for _, cp := range r.Trace.Comps[k+1:] {
				_, _, payload, _ := consumeByNameCapturing(br, c.arch.Components[cp.Index], ProjectileTypeIndex,
					c.arch.Level(cp.Index))
				consumeCorruptionCheck(br)
				if st, ok := payload.(ObjectParentState); ok {
					parent = &st
				}
			}
			b := &c.bilans[f]
			b.records++
			g0 := source.BitsTolerants(p.Payload, start, 1) == 0
			if g0 {
				b.records0++
			}
			if br.BitPos() == r.FinBit {
				b.alignes++
				if g0 {
					b.alignes0++
				}
			}
			if parent != nil && parent.Attached {
				b.attaches++
				ps := (parent.Quant16 & parentHandleValueMask) + parentHandleBase
				if ti, ok := c.m.marche.monde.ArchetypeForSlot(ps); ok {
					b.parentsVivants++
					if ti == BipedTypeIndex {
						b.parentsBipedes++
					}
				}
			}
		}
	}
}

func TestStickI3Largeur(t *testing.T) {
	root := os.Getenv("IT3D_STICK_MATCHES")
	if root == "" {
		t.Skip("IT3D_STICK_MATCHES absent : instrument saute")
	}
	ents, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	formes := formesI3()
	total := make([]bilanI3, len(formes))
	g0, g1 := 0, 0
	var noms []string
	for _, e := range ents {
		if e.IsDir() {
			noms = append(noms, e.Name())
		}
	}
	sort.Strings(noms)
	for _, n := range noms {
		film, err := source.LoadDir(filepath.Join(root, n, "chunks"), nil)
		if err != nil {
			t.Logf("%s : %v", n, err)
			continue
		}
		fc := contexteDeBobine(film)
		reg, err := fc.Registry()
		if err != nil {
			t.Logf("%s : registre : %v", n, err)
			continue
		}
		arch, ok := reg.Archetype(ProjectileTypeIndex)
		if !ok {
			continue
		}
		c := &canalI3{arch: arch, formes: formes, bilans: make([]bilanI3, len(formes))}
		if err := Distribuer(fc, c); err != nil {
			t.Logf("%s : %v", n, err)
			continue
		}
		g0, g1 = g0+c.gate0, g1+c.gate1
		t.Logf("%s : %d records ti=41 avec i3 suivi d un composant (vrai %v)", n[:8], c.bilans[0].records, c.bilans[0])
		for f := range formes {
			total[f].records += c.bilans[f].records
			total[f].alignes += c.bilans[f].alignes
			total[f].records0 += c.bilans[f].records0
			total[f].alignes0 += c.bilans[f].alignes0
			total[f].attaches += c.bilans[f].attaches
			total[f].parentsVivants += c.bilans[f].parentsVivants
			total[f].parentsBipedes += c.bilans[f].parentsBipedes
		}
	}
	t.Logf("bit de tete d i3 sous la marche : 0 (present) %d, 1 (absent) %d", g0, g1)
	for f, forme := range formes {
		b := total[f]
		t.Logf("FORME %-42s records=%6d fin==record suivant %6d (%.1f%%), dont i3 present %4d/%4d | i10 attache %4d, parent vivant %4d, parent bipede %4d",
			forme.nom, b.records, b.alignes, 100*float64(b.alignes)/float64(max(b.records, 1)), b.alignes0, b.records0, b.attaches,
			b.parentsVivants, b.parentsBipedes)
	}
}
