//go:build research

package grammar

// stick_marche_research_test.go — the sticking projectile's i10 record, read by the PRODUCTION frame
// walk (Distribuer + a channel), not by the clean single-packet walker the earlier instruments used.
// The frame walk locates the record list after an event list (pay[0]&0x40 != 0), which the clean
// walker refuses; if it decodes the ti=41 record with mask [1 3 10 18] to its end (DesyncAt == -1),
// the i3 width the dispatch uses (FUN_140d70998: R(1) gate, if 0 R(19)+R(8)) is the one the stream
// is written with.
//
// VERDICT (2026-11-16, d01ba030): the walk locates 43 186 frames (59 not), reads 26 944 ti=41
// records with 0 desync, and 5 of them open the i10 attached gate. Proj 107's record (chunk 14,
// pk 1906, slot 1133, mask [1 3 10 18]) is among them, decoded to its end: parent handle 0x31 +
// base 0x200 = slot 561, gen 1, the victim's track (l DesTroy l); node 22; pose [32214 33936
// 33041]. The earlier verdict "zero i10 readings on ti=41" (stick_parent_research_test.go) was the
// clean walker's, which skips event-list packets. The i3 width across all stored matches:
// stick_i3_largeur_research_test.go.
//
// USAGE: IT3D_STICK_DIR=<...>\data\matches\<id>\chunks go test -tags research
//
//	./internal/grammar/ -run TestStickMarche -v   (from third_party/film-decoder)

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar/lecture"
	"github.com/JGtm/halo-infinite-film-decoder/internal/source"
)

// lectureI10Projectile is one ti=41 record carrying i10, as the frame walk read it.
type lectureI10Projectile struct {
	chunk, index int
	ts           uint64
	typ          int
	slot, gen    uint32
	idx          []int
	desync       int
	st           ObjectParentState
	headerBit    int
	finBit       int
	nextHeader   int // header bit of the next record in the same list, -1 when last
}

// canalI10Projectile collects every ti=41 record that carries i10.
type canalI10Projectile struct {
	m   *MarcheDistribuee
	out []lectureI10Projectile
	// tramesLues / tramesNonLocalisees count the frames whose record list the walk located.
	tramesLues, tramesNonLocalisees int
	ti41Records, ti41Desync         int
}

func (c *canalI10Projectile) Interets() []Interet {
	return []Interet{{Phase: PhaseTrames, TI: ProjectileTypeIndex, Composant: compObjectParentState}}
}
func (c *canalI10Projectile) Clore(BilanDeMarche)                          {}
func (c *canalI10Projectile) Brancher(_ *Observation, m *MarcheDistribuee) { c.m = m }
func (c *canalI10Projectile) Trame(p *lecture.Paquet) {
	recs, lus := c.m.recordsDeLaTrame()
	if !lus {
		c.tramesNonLocalisees++
		return
	}
	c.tramesLues++
	for i := range recs {
		r := &recs[i]
		if r.TypeIndex != ProjectileTypeIndex {
			continue
		}
		c.ti41Records++
		if r.DesyncAt != -1 {
			c.ti41Desync++
		}
		st, ok := parentDuRecord(r)
		if !ok {
			continue
		}
		l := lectureI10Projectile{chunk: p.Chunk, index: p.Index, ts: p.TS, typ: r.Type, slot: r.Slot,
			gen: r.ID >> 30, desync: r.DesyncAt, st: st, headerBit: r.HeaderBit, finBit: r.FinBit, nextHeader: -1}
		for _, cr := range r.Trace.Comps {
			l.idx = append(l.idx, cr.Index)
		}
		if i+1 < len(recs) {
			l.nextHeader = recs[i+1].HeaderBit
		}
		c.out = append(c.out, l)
	}
}

func lireI10Projectiles(t *testing.T, dir string) *canalI10Projectile {
	t.Helper()
	film, err := source.LoadDir(dir, nil)
	if err != nil {
		t.Fatalf("film illisible : %v", err)
	}
	fc := contexteDeBobine(film)
	c := &canalI10Projectile{}
	if err := Distribuer(fc, c); err != nil {
		t.Fatalf("Distribuer : %v", err)
	}
	return c
}

// canalDuRecordCapture dumps one record (slot, packet timestamp) as the walk read it: its bits from
// the first component to FinBit, the components' start bits and the i10 parameter. It produced the
// fixture of projectile_attaches_test.go.
type canalDuRecordCapture struct {
	m    *MarcheDistribuee
	t    *testing.T
	slot uint32
	ts   uint64
}

func (c *canalDuRecordCapture) Interets() []Interet {
	return []Interet{{Phase: PhaseTrames, TI: ProjectileTypeIndex, Composant: compObjectParentState}}
}
func (c *canalDuRecordCapture) Clore(BilanDeMarche)                          {}
func (c *canalDuRecordCapture) Brancher(_ *Observation, m *MarcheDistribuee) { c.m = m }
func (c *canalDuRecordCapture) Trame(p *lecture.Paquet) {
	if c.ts != 0 && p.TS != c.ts {
		return
	}
	recs, _ := c.m.recordsDeLaTrame()
	for i := range recs {
		r := &recs[i]
		if len(r.Trace.Comps) == 0 || r.DesyncAt != -1 || r.TypeIndex != ProjectileTypeIndex {
			continue
		}
		if c.slot != 0 && r.Slot != c.slot {
			continue
		}
		if c.slot == 0 && !c.i3Present(p.Payload, r) {
			continue
		}
		c.slot = r.Slot // first match only
		c.ts = p.TS
		c.t.Logf("record slot=%d t=%dus chunk=%d pk=%d", r.Slot, p.TS, p.Chunk, p.Index)
		from := r.Trace.Comps[0].StartBit
		var out []byte
		for b := from; b < r.FinBit; b += 8 {
			n := min(8, r.FinBit-b)
			out = append(out, byte(source.BitsTolerants(p.Payload, b, n)<<(8-n)))
		}
		for _, cp := range r.Trace.Comps {
			st, _ := cp.ParentOf()
			c.t.Logf("comp i%d %s start=+%d param=%d", cp.Index, cp.Name, cp.StartBit-from, st.Param)
		}
		c.t.Logf("bits=%d hex=%x", r.FinBit-from, out)
	}
}

// i3Present: i3 read with its payload (leading bit 0) and followed by another component.
func (c *canalDuRecordCapture) i3Present(pay []byte, r *FrameRecord) bool {
	for k, cp := range r.Trace.Comps {
		if cp.Index != 3 || k == len(r.Trace.Comps)-1 || source.BitsTolerants(pay, cp.StartBit, 1) != 0 {
			continue
		}
		_, ok := r.Trace.Comps[k+1].ParentOf()
		return ok || len(r.Trace.Comps) > k+1
	}
	return false
}

func TestStickRecordCapture(t *testing.T) {
	dir := os.Getenv(stickDirEnv)
	if dir == "" {
		t.Skipf("%s absent : instrument saute", stickDirEnv)
	}
	film, err := source.LoadDir(dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	// d01ba030 proj 107: slot 1133, chunk 14 pk 1906.
	if err := Distribuer(contexteDeBobine(film), &canalDuRecordCapture{t: t, slot: 1133, ts: 7644903165}); err != nil {
		t.Fatal(err)
	}
	// The first record whose i3 carries its payload and is followed by another component.
	if err := Distribuer(contexteDeBobine(film), &canalDuRecordCapture{t: t}); err != nil {
		t.Fatal(err)
	}
}

func TestStickMarche(t *testing.T) {
	dir := os.Getenv(stickDirEnv)
	if dir == "" {
		t.Skipf("%s absent : instrument saute", stickDirEnv)
	}
	c := lireI10Projectiles(t, dir)
	t.Logf("trames lues %d, non localisees %d ; records ti=41 %d dont desync %d ; lectures i10 %d",
		c.tramesLues, c.tramesNonLocalisees, c.ti41Records, c.ti41Desync, len(c.out))
	for _, l := range c.out {
		if !l.st.Attached {
			continue
		}
		t.Logf("chunk=%d pk=%d t=%dus typ=%d slot=%d gen=%d idx=%v desync=%d hdr=%d fin=%d next=%d "+
			"Q16=0x%x parent=%d pgen=%d W16=0x%x opt=%v/0x%x A=%v B=%v Mtx=%v vel=%v/0x%x B8=0x%x C=%v tail=%v/%d/%v",
			l.chunk, l.index, l.ts, l.typ, l.slot, l.gen, l.idx, l.desync, l.headerBit, l.finBit, l.nextHeader,
			l.st.Quant16, (l.st.Quant16&parentHandleValueMask)+parentHandleBase, l.st.Quant16>>30, l.st.Word16,
			l.st.HasOpt16, l.st.Opt16, l.st.FlagA, l.st.FlagB, l.st.Mtx, l.st.HasVel, l.st.Vel, l.st.Byte8, l.st.FlagC,
			l.st.TailSign, l.st.Tail6, l.st.TailBit)
	}
}

// canalDesParentsDAttache names the archetype of each parent an attached ti=41 record points at:
// the type index of the last record the walk read for that slot before the attach (any record kind).
type canalDesParentsDAttache struct {
	m      *MarcheDistribuee
	reg    *Registry
	lastTI map[uint32]uint32
	parTI  map[string]int
	cas    []string
}

func (c *canalDesParentsDAttache) Interets() []Interet {
	return []Interet{{Phase: PhaseTrames, TI: ProjectileTypeIndex, Composant: compObjectParentState}}
}
func (c *canalDesParentsDAttache) Clore(BilanDeMarche)                          {}
func (c *canalDesParentsDAttache) Brancher(_ *Observation, m *MarcheDistribuee) { c.m = m }
func (c *canalDesParentsDAttache) Trame(p *lecture.Paquet) {
	recs, lus := c.m.recordsDeLaTrame()
	if !lus && listeAnnoncee(&p.VueA) {
		recs, lus, _ = c.m.recupererLaListe()
	}
	if !lus {
		return
	}
	for i := range recs {
		r := &recs[i]
		if r.TypeIndex == ProjectileTypeIndex && r.Type == recDelta && r.DesyncAt == -1 {
			if st, ok := parentDuRecord(r); ok && st.Attached {
				parent := (st.Quant16 & parentHandleValueMask) + parentHandleBase
				nom := "inconnu"
				if ti, ok := c.lastTI[parent]; ok {
					nom = fmt.Sprintf("ti=%d", ti)
					if a, ok := c.reg.Archetype(int(ti)); ok && len(a.Components) > 0 {
						nom += " (" + a.Components[len(a.Components)-1] + ")"
					}
				}
				c.parTI[nom]++
				c.cas = append(c.cas, fmt.Sprintf("t=%d proj=%d parent=%d node=%d %s", p.TS, r.Slot, parent, st.Word16, nom))
			}
		}
		c.lastTI[r.Slot] = uint32(r.TypeIndex)
	}
}

// TestStickParentArchetypes: what the projectiles that stick are stuck TO, over every stored match.
//
// USAGE: IT3D_STICK_MATCHES=<...>\data\matches go test -tags research -run TestStickParentArchetypes ./internal/grammar/
func TestStickParentArchetypes(t *testing.T) {
	root := os.Getenv("IT3D_STICK_MATCHES")
	if root == "" {
		t.Skip("IT3D_STICK_MATCHES absent : instrument saute")
	}
	ents, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	total := map[string]int{}
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		film, err := source.LoadDir(filepath.Join(root, e.Name(), "chunks"), nil)
		if err != nil {
			continue
		}
		fc := contexteDeBobine(film)
		reg, err := fc.Registry()
		if err != nil {
			continue
		}
		c := &canalDesParentsDAttache{reg: reg, lastTI: map[uint32]uint32{}, parTI: map[string]int{}}
		if err := Distribuer(fc, c); err != nil {
			t.Logf("%s : %v", e.Name(), err)
			continue
		}
		for _, l := range c.cas {
			if !strings.Contains(l, "ti=35") {
				t.Logf("%s %s", e.Name()[:8], l)
			}
		}
		for k, v := range c.parTI {
			total[k] += v
		}
	}
	for k, v := range total {
		t.Logf("PARENT %s : %d", k, v)
	}
}
