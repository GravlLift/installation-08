//go:build research

package replay

// stick_de_deplacement_research_test.go — INSTRUMENT DE MESURE du stick de deplacement publie (schema
// 114) sur un film reel. Lecture seule. GARDE : PLEIN_FILM et PLEIN_MAP.
//
// LES AXES : le stick est-il relatif a la visee ou au monde ? Sur chaque position d une vie a pied qui
// se deplace (vitesse au sol au-dessus de 2 u/s sur 100 ms), le stick tenu a cet instant (connu, hors
// repos) donne un angle ; la vitesse en donne un autre, dans le monde et relativement au cap de visee.
// Pour chaque hypothese (monde, relatif ; axe y direct ou miroir), la longueur resultante moyenne R de
// l ecart d angle dit l accord (1 : un decalage constant explique tout ; 0 : aucun accord), et son
// angle moyen est le decalage. LA ZONE MORTE : par amplitude du stick (ecart maximal au repos 31), la
// part des instants ou la vie se deplace.

import (
	"math"
	"sort"
	"strconv"
	"testing"
)

// hypotheseDAxes : un repere du stick et le signe de son second axe.
type hypotheseDAxes struct {
	nom        string
	relatif    bool
	miroirSy   bool
	capInverse bool
	sc, ss     float64 // somme des cos et des sin de l ecart
	n          int
}

func TestStickDeDeplacementSurUnFilm(t *testing.T) {
	faits, entry := chargerLesFaitsDeMesure(t)
	a := assemblerDepuisLesFaits(faits, entry, nil)
	hyps := []*hypotheseDAxes{{nom: "monde"}, {nom: "monde, y miroir", miroirSy: true},
		{nom: "relatif", relatif: true}, {nom: "relatif, y miroir", relatif: true, miroirSy: true},
		{nom: "relatif, cap inverse", relatif: true, capInverse: true},
		{nom: "relatif, cap inverse, y miroir", relatif: true, capInverse: true, miroirSy: true}}
	valeursX, valeursY := map[int32]int{}, map[int32]int{}
	enMvt, total, vitesses := map[int32]int{}, map[int32]int{}, map[int32]float64{}
	echantillons := 0
	for _, tr := range a.doc.Tracks {
		fr := tr.FullRate
		if fr == nil || len(fr.StickT) == 0 {
			continue
		}
		sticks := sticksAbsolusDe(fr)
		echantillons += len(sticks)
		for _, s := range sticks {
			valeursX[s.x]++
			valeursY[s.y]++
		}
		c := cinematiqueDe(fr)
		visees := viseesAbsoluesDe(fr)
		for i := range c.t {
			s, ok := stickA(sticks, c.t[i])
			if !ok || s.x == stickInconnu {
				continue
			}
			amp := max(abs32(s.x-31), abs32(s.y-31))
			vx, vy, sol, ok := directionAuSol(c, i)
			if !ok {
				continue
			}
			total[amp]++
			vitesses[amp] += sol
			if sol > 2 {
				enMvt[amp]++
			}
			if sol <= 2 || amp < 10 {
				continue
			}
			capV, ok := capA(visees, c.t[i])
			if !ok {
				continue
			}
			for _, h := range hyps {
				h.ajouter(math.Atan2(vy, vx), capV, s)
			}
		}
	}
	t.Logf("STICK : %d echantillons publies, %+v (couverture)", echantillons, *a.stanceCov.Control)
	for _, h := range hyps {
		r := math.Hypot(h.sc, h.ss) / float64(h.n)
		t.Logf("AXES %-22s n=%d R=%.3f decalage %.1f deg", h.nom, h.n, r, math.Atan2(h.ss, h.sc)*180/math.Pi)
	}
	journaliserLesValeurs(t, "sx", valeursX)
	journaliserLesValeurs(t, "sy", valeursY)
	var amps []int
	for k := range total {
		amps = append(amps, int(k))
	}
	sort.Ints(amps)
	for _, k := range amps {
		t.Logf("ZONE MORTE amplitude %2d : %6d instants, %5.1f %% en mouvement, vitesse moyenne %.2f u/s", k,
			total[int32(k)], 100*float64(enMvt[int32(k)])/float64(total[int32(k)]), vitesses[int32(k)]/float64(total[int32(k)]))
	}
}

func abs32(v int32) int32 {
	if v < 0 {
		return -v
	}
	return v
}

// ajouter range l ecart entre l angle de la vitesse et celui du stick sous l hypothese.
func (h *hypotheseDAxes) ajouter(vitesse, capV float64, s etatDuStick) {
	sy := float64(s.y - 31)
	if h.miroirSy {
		sy = -sy
	}
	angle := math.Atan2(sy, float64(s.x-31))
	cible := vitesse
	switch {
	case h.relatif && h.capInverse:
		cible = vitesse + capV
	case h.relatif:
		cible = vitesse - capV
	}
	d := cible - angle
	h.sc, h.ss, h.n = h.sc+math.Cos(d), h.ss+math.Sin(d), h.n+1
}

// stickA rend l etat du stick a l instant (ms), le dernier echantillon au plus tard.
func stickA(ss []etatDuStick, ms int64) (etatDuStick, bool) {
	i := sort.Search(len(ss), func(i int) bool { return int64(ss[i].ts) > ms }) - 1 //nolint:gosec // ms
	if i < 0 {
		return etatDuStick{}, false
	}
	return ss[i], true
}

// capA rend le cap de visee (radians, convention publiee) a l instant, la derniere visee a 100 ms au plus.
func capA(vs []viseeAbsolue, ms int64) (float64, bool) {
	i := sort.Search(len(vs), func(i int) bool { return vs[i].t > ms }) - 1
	if i < 0 || ms-vs[i].t > 100 {
		return 0, false
	}
	return (float64(vs[i].h) + 0.5) * 2 * math.Pi / 4096, true
}

// directionAuSol rend la vitesse horizontale de la vie a l echantillon i (composantes et norme, u/s).
func directionAuSol(c cinematique, i int) (vx, vy, sol float64, ok bool) {
	for j := i + 1; j < len(c.t); j++ {
		if c.rompu[j] {
			return 0, 0, 0, false
		}
		dt := float64(c.t[j]-c.t[i]) / 1000
		if dt < 0.1 {
			continue
		}
		vx, vy = (c.x[j]-c.x[i])/dt, (c.y[j]-c.y[i])/dt
		return vx, vy, math.Hypot(vx, vy), true
	}
	return 0, 0, 0, false
}

func journaliserLesValeurs(t *testing.T, nom string, v map[int32]int) {
	var ks []int
	for k := range v {
		ks = append(ks, int(k))
	}
	sort.Ints(ks)
	ligne := ""
	for _, k := range ks {
		ligne += " " + strconv.Itoa(k) + ":" + strconv.Itoa(v[int32(k)])
	}
	t.Logf("VALEURS %s :%s", nom, ligne)
}
