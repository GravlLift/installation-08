//go:build research

package replay

// directions_tir_research_test.go — ce qu est la direction des tirs (`FireEvent.Aim`, le cubemap de
// 30 bits du record 36), mesuree contre la visee i21 du tireur au plein debit. Lecture seule.
//
// GARDE : PLEIN_FILM et PLEIN_MAP (comme plein_debit_research_test.go).

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
	"github.com/JGtm/halo-infinite-film-decoder/internal/profile"
	"github.com/JGtm/halo-infinite-film-decoder/internal/source"
)

type viseeTireur struct {
	tUS  uint64
	h, p float64
	x    [3]float64 // position
}

func vecteurVisee(hDeg, pDeg float64) [3]float64 {
	h, p := hDeg*math.Pi/180, pDeg*math.Pi/180
	return [3]float64{math.Cos(p) * math.Cos(h), math.Cos(p) * math.Sin(h), math.Sin(p)}
}

func angleEntre(a, b [3]float64) float64 {
	d := a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
	na := math.Sqrt(a[0]*a[0] + a[1]*a[1] + a[2]*a[2])
	nb := math.Sqrt(b[0]*b[0] + b[1]*b[1] + b[2]*b[2])
	c := d / (na * nb)
	return math.Acos(math.Max(-1, math.Min(1, c))) * 180 / math.Pi
}

func f64(v [3]float32) [3]float64 { return [3]float64{float64(v[0]), float64(v[1]), float64(v[2])} }

func faceDominante(v [3]float64) string {
	i := 0
	for k := 1; k < 3; k++ {
		if math.Abs(v[k]) > math.Abs(v[i]) {
			i = k
		}
	}
	s := "+"
	if v[i] < 0 {
		s = "-"
	}
	return s + string("XYZ"[i])
}

// viseesSansPositionMesurees sont les lectures i21 sans position du dernier film charge (film a vehicules).
var viseesSansPositionMesurees []grammar.BipedAim

func chargerFilmDeMesure(t *testing.T) ([]grammar.BipedPosition, []grammar.FireEvent, ReplayDocument) {
	t.Helper()
	dir, mapName := os.Getenv("PLEIN_FILM"), os.Getenv("PLEIN_MAP")
	if dir == "" || mapName == "" {
		t.Skip("PLEIN_FILM / PLEIN_MAP absents : instrument de mesure saute")
	}
	cat, err := profile.LoadMapQuantCatalog(filepath.Join("..", "..", "..", "data", "titles", "halo_infinite",
		"reference", "map_quant_bounds.json"))
	if err != nil {
		t.Fatalf("catalogue : %v", err)
	}
	entry, err := cat.Lookup(mapName)
	if err != nil {
		t.Fatalf("carte : %v", err)
	}
	film, err := source.LoadDir(dir, nil)
	if err != nil {
		t.Fatalf("chunks : %v", err)
	}
	var pos []grammar.BipedPosition
	var fire []grammar.FireEvent
	opt := Options{MapQuant: &entry, Observe: func(step string, v any) {
		switch step {
		case "positions":
			pos, _ = v.([]grammar.BipedPosition)
		case "fire":
			fire, _ = v.([]grammar.FireEvent)
		case "vehicles":
			if vs, ok := v.(VehicleScan); ok {
				viseesSansPositionMesurees = vs.Aims
			}
		}
	}}
	doc, err := BuildFromFilm(context.Background(), "mesure-tirs", "halo_infinite", film, opt)
	if err != nil {
		t.Fatalf("assemblage : %v", err)
	}
	return pos, fire, doc
}

// TestDirectionsDesTirs : pour chaque tir dont la direction est lue, l angle a la visee i21 du tireur
// (meme paquet, sinon la derniere avant), ventile par trait du record, et les hypotheses de sens.
func TestDirectionsDesTirs(t *testing.T) {
	pos, fire, doc := chargerFilmDeMesure(t)
	visees := map[uint32][]viseeTireur{}
	for _, p := range pos {
		if h, ok := p.AimHeadingDeg(); ok && p.HasWorld {
			pi, _ := p.AimPitchDeg()
			visees[p.Slot] = append(visees[p.Slot], viseeTireur{tUS: p.TimestampUS, h: float64(h), p: float64(pi),
				x: [3]float64{float64(p.X), float64(p.Y), float64(p.Z)}})
		}
	}
	for s := range visees {
		sort.Slice(visees[s], func(i, j int) bool { return visees[s][i].tUS < visees[s][j].tUS })
	}
	var bons, mauvais, total, avecVisee, sansTireur, sansI21 int
	parTrait := map[string][2]int{}
	var angles []float64
	for _, e := range fire {
		total++
		if !e.HasAim {
			continue
		}
		avecVisee++
		if !e.Unit.Present {
			sansTireur++
			continue
		}
		v := visees[e.Unit.Slot]
		i := sort.Search(len(v), func(i int) bool { return v[i].tUS > e.TimestampUS }) - 1
		if i < 0 || e.TimestampUS-v[i].tUS > 120_000 {
			sansI21++
			continue
		}
		a := angleEntre(f64(e.Aim), vecteurVisee(v[i].h, v[i].p))
		angles = append(angles, a)
		bon := a < 1
		if bon {
			bons++
		} else if a > 5 {
			mauvais++
		}
		meme := v[i].tUS == e.TimestampUS
		for _, trait := range []string{
			"face=" + faceDominante(f64(e.Aim)),
			"faceVraie=" + faceDominante(vecteurVisee(v[i].h, v[i].p)),
			fmt.Sprintf("arme=%08X", e.WeaponID>>32),
			fmt.Sprintf("memePaquet=%v", meme),
			fmt.Sprintf("tireurIdx=%v", e.HasShooter),
			fmt.Sprintf("sonde=%v", e.Unit.Probe),
			fmt.Sprintf("numeroPair=%v", e.FireNumber%2 == 0),
		} {
			c := parTrait[trait]
			if bon {
				c[0]++
			} else if a > 5 {
				c[1]++
			}
			parTrait[trait] = c
		}
	}
	t.Logf("TIRS : %d evenements, %d avec direction, %d sans unite, %d sans i21 a 120 ms ; %d compares : "+
		"%d a moins de 1 deg, %d a plus de 5 deg ; mediane %.2f deg ; publies %d", total, avecVisee, sansTireur,
		sansI21, len(angles), bons, mauvais, quantilePD(angles, 0.5), len(doc.Shots))
	cles := make([]string, 0, len(parTrait))
	for k := range parTrait {
		cles = append(cles, k)
	}
	sort.Strings(cles)
	for _, k := range cles {
		c := parTrait[k]
		t.Logf("  %-24s bons %4d  mauvais %4d", k, c[0], c[1])
	}
	hypothesesDesMauvais(t, fire, visees)
	codesDesTirs(t, fire, visees)
	exporterLesVisees(t, fire, visees)
	tenueContreInterpolation(t, fire, visees)
}

// hypothesesDesMauvais : pour les directions a plus de 5 deg de la visee, quatre lectures candidates.
// (1) une permutation signee des axes ; (2) la visee du tireur a un autre instant (+/- 3 s) ;
// (3) la direction vers un autre joueur ; (4) la visee d un autre joueur au meme instant.
func hypothesesDesMauvais(t *testing.T, fire []grammar.FireEvent, visees map[uint32][]viseeTireur) {
	perm := map[string]int{}
	var tempsMin, versJoueur, autreVisee []float64
	n := 0
	for _, e := range fire {
		if !e.HasAim || !e.Unit.Present {
			continue
		}
		v := visees[e.Unit.Slot]
		i := sort.Search(len(v), func(i int) bool { return v[i].tUS > e.TimestampUS }) - 1
		if i < 0 || e.TimestampUS-v[i].tUS > 120_000 {
			continue
		}
		vraie := vecteurVisee(v[i].h, v[i].p)
		d := f64(e.Aim)
		if angleEntre(d, vraie) <= 5 {
			continue
		}
		n++
		for _, p := range [][3]int{{0, 1, 2}, {0, 2, 1}, {1, 0, 2}, {1, 2, 0}, {2, 0, 1}, {2, 1, 0}} {
			for sg := 0; sg < 8; sg++ {
				w := [3]float64{d[p[0]], d[p[1]], d[p[2]]}
				for k := 0; k < 3; k++ {
					if sg&(1<<k) != 0 {
						w[k] = -w[k]
					}
				}
				if angleEntre(w, vraie) < 2 {
					perm[fmt.Sprintf("%v/%03b", p, sg)]++
				}
			}
		}
		best := 180.0
		for _, s := range v {
			if s.tUS+3_000_000 >= e.TimestampUS && s.tUS <= e.TimestampUS+3_000_000 {
				best = math.Min(best, angleEntre(d, vecteurVisee(s.h, s.p)))
			}
		}
		tempsMin = append(tempsMin, best)
		bj, ba := 180.0, 180.0
		for slot, w := range visees {
			if slot == e.Unit.Slot {
				continue
			}
			j := sort.Search(len(w), func(j int) bool { return w[j].tUS > e.TimestampUS }) - 1
			if j < 0 || e.TimestampUS-w[j].tUS > 200_000 {
				continue
			}
			dir := [3]float64{w[j].x[0] - v[i].x[0], w[j].x[1] - v[i].x[1], w[j].x[2] - v[i].x[2]}
			bj = math.Min(bj, angleEntre(d, dir))
			ba = math.Min(ba, angleEntre(d, vecteurVisee(w[j].h, w[j].p)))
		}
		versJoueur, autreVisee = append(versJoueur, bj), append(autreVisee, ba)
	}
	t.Logf("MAUVAIS (%d) : visee du tireur a +/- 3 s, angle minimal mediane %.1f deg (p25 %.1f) ; vers un autre "+
		"joueur mediane %.1f (p25 %.1f) ; visee d un autre mediane %.1f (p25 %.1f)", n, quantilePD(tempsMin, 0.5),
		quantilePD(tempsMin, 0.25), quantilePD(versJoueur, 0.5), quantilePD(versJoueur, 0.25),
		quantilePD(autreVisee, 0.5), quantilePD(autreVisee, 0.25))
	for k, c := range perm {
		if c*20 >= n {
			t.Logf("  permutation %s : %d", k, c)
		}
	}
}

// codesDesTirs : le code lu (re-encode depuis la direction decodee) contre le code de la visee i21
// du tireur, en binaire sur 30 bits, pour quelques tirs bons et mauvais.
func codesDesTirs(t *testing.T, fire []grammar.FireEvent, visees map[uint32][]viseeTireur) {
	nb, nm := 0, 0
	for _, e := range fire {
		if !e.HasAim || !e.Unit.Present {
			continue
		}
		v := visees[e.Unit.Slot]
		i := sort.Search(len(v), func(i int) bool { return v[i].tUS > e.TimestampUS }) - 1
		if i < 0 || v[i].tUS != e.TimestampUS {
			continue
		}
		w := vecteurVisee(v[i].h, v[i].p)
		lu, _ := grammar.EncodeAimVector(e.Aim, grammar.FireAimBits)
		vrai, _ := grammar.EncodeAimVector([3]float32{float32(w[0]), float32(w[1]), float32(w[2])}, grammar.FireAimBits)
		a := angleEntre(f64(e.Aim), w)
		switch {
		case a < 1 && nb < 6:
			nb++
			t.Logf("  BON     lu %030b vrai %030b  h=%.1f p=%.1f", lu, vrai, v[i].h, v[i].p)
		case a > 5 && nm < 30:
			nm++
			t.Logf("  MAUVAIS lu %030b vrai %030b  xor %030b  h=%.1f p=%.1f arme=%08X n=%d", lu, vrai, lu^vrai,
				v[i].h, v[i].p, e.WeaponID>>32, e.FireNumber)
		}
	}
}

// exporterLesVisees ecrit, pour l instrument de la grammaire (visee_tir_research_test.go), la visee
// i21 du tireur au paquet de chaque tir dont la direction est lue. GARDE : PLEIN_EXPORT (chemin).
func exporterLesVisees(t *testing.T, fire []grammar.FireEvent, visees map[uint32][]viseeTireur) {
	chemin := os.Getenv("PLEIN_EXPORT")
	if chemin == "" {
		return
	}
	type ligne struct {
		Chunk, Paquet int
		H, P          float64
	}
	var out []ligne
	for _, e := range fire {
		if !e.HasAim || !e.Unit.Present {
			continue
		}
		v := visees[e.Unit.Slot]
		i := sort.Search(len(v), func(i int) bool { return v[i].tUS > e.TimestampUS }) - 1
		if i < 0 || v[i].tUS != e.TimestampUS {
			continue
		}
		out = append(out, ligne{e.Chunk, e.PacketIndex, v[i].h, v[i].p})
	}
	raw, _ := json.Marshal(out)
	if err := os.WriteFile(chemin, raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

// tenueContreInterpolation : sur les tirs dont la direction lue est juste (a moins de 1 deg de la
// visee) et dont le paquet ne porte pas de visee du tireur, la visee tenue (derniere avant) contre la
// visee interpolee entre la derniere avant et la premiere apres, mesurees contre la direction lue.
func tenueContreInterpolation(t *testing.T, fire []grammar.FireEvent, visees map[uint32][]viseeTireur) {
	var tenue, interp []float64
	for _, e := range fire {
		if !e.HasAim || !e.Unit.Present {
			continue
		}
		v := visees[e.Unit.Slot]
		i := sort.Search(len(v), func(i int) bool { return v[i].tUS > e.TimestampUS }) - 1
		if i < 0 || i+1 >= len(v) || v[i].tUS == e.TimestampUS || e.TimestampUS-v[i].tUS > 1_000_000 {
			continue
		}
		d := f64(e.Aim)
		a, b := v[i], v[i+1]
		u := float64(e.TimestampUS-a.tUS) / float64(b.tUS-a.tUS)
		dh := math.Mod(b.h-a.h+540, 360) - 180
		vi := vecteurVisee(a.h+dh*u, a.p+(b.p-a.p)*u)
		at, ai := angleEntre(d, vecteurVisee(a.h, a.p)), angleEntre(d, vi)
		if math.Min(at, ai) > 5 {
			continue // direction lue fausse (drapeaux non nuls) : pas une verite
		}
		tenue, interp = append(tenue, at), append(interp, ai)
	}
	t.Logf("SANS VISEE AU PAQUET (n=%d) : tenue mediane %.3f deg p90 %.3f ; interpolee mediane %.3f deg p90 %.3f",
		len(tenue), quantilePD(tenue, 0.5), quantilePD(tenue, 0.9), quantilePD(interp, 0.5), quantilePD(interp, 0.9))
}

// TestDirectionsPubliees : sur les tirs PUBLIES, la part qui porte une direction, et l angle de cette
// direction a la visee i21 du tireur a l instant du tir (derniere lecture au plus tard, 5 s au plus),
// recalculee ici sans le code de production. Un tir publie se relie a ses evenements par (frame, slot).
func TestDirectionsPubliees(t *testing.T) {
	pos, fire, doc := chargerFilmDeMesure(t)
	visees := map[uint32][]viseeTireur{}
	for _, p := range pos {
		if h, ok := p.AimHeadingDeg(); ok {
			pi, _ := p.AimPitchDeg()
			visees[p.Slot] = append(visees[p.Slot], viseeTireur{tUS: p.TimestampUS, h: float64(h), p: float64(pi)})
		}
	}
	for _, a := range viseesSansPositionMesurees {
		visees[a.Slot] = append(visees[a.Slot], viseeTireur{tUS: a.TimestampUS, h: float64(a.AimHeadingDeg()),
			p: float64(a.AimPitchDeg())})
	}
	for s := range visees {
		sort.SliceStable(visees[s], func(i, j int) bool { return visees[s][i].tUS < visees[s][j].tUS })
	}
	origine := uint64(0)
	if len(pos) > 0 {
		origine = pos[0].TimestampUS
		for _, p := range pos {
			origine = min(origine, p.TimestampUS)
		}
	}
	verites := map[[2]int][][3]float64{}
	for _, e := range fire {
		if !e.Unit.Present {
			continue
		}
		v := visees[e.Unit.Slot]
		i := sort.Search(len(v), func(i int) bool { return v[i].tUS > e.TimestampUS }) - 1
		if i < 0 || e.TimestampUS-v[i].tUS > 5_000_000 {
			continue
		}
		cle := [2]int{int((e.TimestampUS - origine) / 100_000), int(e.Unit.Slot)}
		verites[cle] = append(verites[cle], vecteurVisee(v[i].h, v[i].p))
	}
	var avecDir, compares, moinsDe1, moinsDe5, enVehicule, vehiculeLoin int
	for _, s := range doc.Shots {
		if s.H == 0 {
			continue
		}
		avecDir++
		if s.Vehicle != nil {
			enVehicule++
		}
		vs := verites[[2]int{s.T, int(s.Slot)}]
		if len(vs) == 0 {
			continue
		}
		compares++
		d, best := vecteurVisee(float64(s.H), float64(s.P)), 180.0
		for _, v := range vs {
			best = math.Min(best, angleEntre(d, v))
		}
		switch {
		case best < 1:
			moinsDe1++
		case s.Vehicle != nil:
			vehiculeLoin++
		}
		if best < 5 {
			moinsDe5++
		}
	}
	t.Logf("VERITE : %d positions, %d visees sans position", len(pos), len(viseesSansPositionMesurees))
	t.Logf("PUBLIES : %d tirs, %d avec direction ; %d compares a la visee du tireur : %d a moins de 1 deg, "+
		"%d a moins de 5 deg ; couverture %+v ; en vehicule %d, dont %d compares au-dela de 1 deg", len(doc.Shots),
		avecDir, compares, moinsDe1, moinsDe5, *doc.Coverage.Shots.Aim, enVehicule, vehiculeLoin)
}
