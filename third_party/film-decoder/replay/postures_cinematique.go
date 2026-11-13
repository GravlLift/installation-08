package replay

// postures_cinematique.go — LA VITESSE D UNE VIE, LUE DANS SON PLEIN DEBIT, pour les postures de la
// vue de controle (postures_de_controle.go).
//
// La regle de la glissade lit deux grandeurs : la vitesse AU SOL (horizontale) et la vitesse
// VERTICALE. Les deux se lisent sur les positions de la vie au debit du film (`Track.FullRate`),
// jamais sur la grille de 100 ms : une glissade dure de l ordre d une demi-seconde, et sa fin se lit a
// la milliseconde. La vitesse a un echantillon est l ecart a l echantillon suivant distant d au moins
// [fenetreVitesseMS], sans lacune entre eux : un tick seul (16 ms) est trop bruite pour un seuil.

import (
	"math"
	"sort"
)

// fenetreVitesseMS est l ecart minimal entre les deux echantillons d une vitesse : six ticks a 60 Hz,
// trois a 30 Hz.
const fenetreVitesseMS = 100

// cinematique est une vie au plein debit, en absolu : instants en ms depuis l origine de la grille,
// positions en unites monde.
type cinematique struct {
	t       []int64
	x, y, z []float64
	// rompu[i] : une lacune de replication precede l echantillon i.
	rompu []bool
}

// cinematiqueDe reconstruit la vie depuis ses colonnes differentielles (cf. tracks_plein_debit.go).
func cinematiqueDe(fr *FullRateTrack) cinematique {
	if fr == nil || len(fr.T) == 0 {
		return cinematique{}
	}
	n := len(fr.T)
	c := cinematique{t: make([]int64, n), x: make([]float64, n), y: make([]float64, n),
		z: make([]float64, n), rompu: make([]bool, n)}
	var t int64
	var x, y, z int32
	for i := 0; i < n; i++ {
		t, x, y, z = t+fr.T[i], x+fr.X[i], y+fr.Y[i], z+fr.Z[i]
		c.t[i] = t
		c.x[i], c.y[i], c.z[i] = float64(x)/coordScale, float64(y)/coordScale, float64(z)/coordScale
	}
	for _, g := range fr.Gaps {
		if g >= 0 && g < n {
			c.rompu[g] = true
		}
	}
	return c
}

// fin rend l instant du dernier echantillon.
func (c cinematique) fin() int64 { return c.t[len(c.t)-1] }

// aPartirDe rend l indice du premier echantillon a l instant `ms` ou apres.
func (c cinematique) aPartirDe(ms int64) int {
	return sort.Search(len(c.t), func(i int) bool { return c.t[i] >= ms })
}

// presDe dit qu un echantillon tombe a moins de `ecart` ms de l instant `ms`.
func (c cinematique) presDe(ms, ecart int64) bool {
	i := c.aPartirDe(ms - ecart)
	return i < len(c.t) && c.t[i] <= ms+ecart
}

// vitesse rend la vitesse au sol et la vitesse verticale a l echantillon `i`, en unites par seconde,
// et faux quand aucun echantillon ne la borne a [fenetreVitesseMS] sans lacune.
func (c cinematique) vitesse(i int) (sol, vz float64, ok bool) {
	for j := i + 1; j < len(c.t); j++ {
		if c.rompu[j] {
			return 0, 0, false
		}
		dt := c.t[j] - c.t[i]
		if dt < fenetreVitesseMS {
			continue
		}
		s := float64(dt) / 1000
		return math.Hypot(c.x[j]-c.x[i], c.y[j]-c.y[i]) / s, (c.z[j] - c.z[i]) / s, true
	}
	return 0, 0, false
}

// chuteA dit que la vie chute a l instant `ms` : une vitesse verticale sous [seuilChuteUS] a un
// echantillon des [demiFenetreChuteMS] qui l entourent.
func (c cinematique) chuteA(ms int64) bool {
	for i := c.aPartirDe(ms - demiFenetreChuteMS); i < len(c.t) && c.t[i] <= ms+demiFenetreChuteMS; i++ {
		if _, vz, ok := c.vitesse(i); ok && vz < seuilChuteUS {
			return true
		}
	}
	return false
}

// contactAuSol rend le premier instant, a `ms` ou apres et au plus tard `limite`, ou la vie ne chute
// plus (vitesse verticale au-dessus de [seuilChuteUS]) : l atterrissage.
func (c cinematique) contactAuSol(ms, limite int64) (int64, bool) {
	for i := c.aPartirDe(ms); i < len(c.t) && c.t[i] <= limite; i++ {
		if _, vz, ok := c.vitesse(i); ok && vz >= seuilChuteUS {
			return c.t[i], true
		}
	}
	return 0, false
}
