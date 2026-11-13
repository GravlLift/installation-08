//go:build research

package replay

// plein_debit_research_test.go — instrument de mesure du plein debit des pistes (schema 109) sur un
// film reel : echantillons publies contre positions des faits, cadence par joueur, ecarts entre
// echantillons pendant le mouvement, et poids du document avant / apres. Lecture seule.
//
// GARDE : PLEIN_FILM (dossier des chunks) et PLEIN_MAP (nom de carte du catalogue de bornes).

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
	"github.com/JGtm/halo-infinite-film-decoder/internal/profile"
	"github.com/JGtm/halo-infinite-film-decoder/internal/source"
)

// echantillonDecode : un echantillon de plein debit reconstruit (instant en us depuis l origine).
type echantillonDecode struct {
	tUS     float64
	x, y, z float64
	gap     bool
}

type viseeDecodee struct {
	tUS  float64
	h, p float64
}

func decoderPleinDebit(f *FullRateTrack) ([]echantillonDecode, []viseeDecodee) {
	var out []echantillonDecode
	var t, x, y, z int64
	gaps := map[int]bool{}
	for _, g := range f.Gaps {
		gaps[g] = true
	}
	for i := range f.T {
		t, x, y, z = t+f.T[i], x+int64(f.X[i]), y+int64(f.Y[i]), z+int64(f.Z[i])
		out = append(out, echantillonDecode{tUS: float64(t * fullRateTimeUnitUS), x: float64(x) / 100,
			y: float64(y) / 100, z: float64(z) / 100, gap: gaps[i]})
	}
	var vs []viseeDecodee
	var at, h, p int64
	for i := range f.AimT {
		at, h, p = at+f.AimT[i], h+int64(f.H[i]), p+int64(f.P[i])
		vs = append(vs, viseeDecodee{tUS: float64(at * fullRateTimeUnitUS),
			h: (float64(h) + 0.5) * 360 / 4096, p: (float64(p)+0.5)*360/2048 - 180})
	}
	return out, vs
}

func quantilePD(v []float64, q float64) float64 {
	if len(v) == 0 {
		return math.NaN()
	}
	s := append([]float64(nil), v...)
	sort.Float64s(s)
	return s[int(q*float64(len(s)-1))]
}

func gzipTaille(t *testing.T, doc ReplayDocument) (int, int) {
	t.Helper()
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&buf, gzip.DefaultCompression)
	_, _ = zw.Write(raw)
	_ = zw.Close()
	return len(raw), buf.Len()
}

func TestPleinDebitSurUnFilm(t *testing.T) {
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
	opt := Options{MapQuant: &entry, Observe: func(step string, v any) {
		switch step {
		case "positions":
			pos, _ = v.([]grammar.BipedPosition)
		}
	}}
	doc, err := BuildFromFilm(context.Background(), "mesure-plein-debit", "halo_infinite", film, opt)
	if err != nil {
		t.Fatalf("assemblage : %v", err)
	}
	c := doc.Coverage.Tracks
	t.Logf("FAITS : %d positions, %d avec visee", len(pos), compterVisees(pos))
	t.Logf("COUVERTURE : %+v", *c)
	somme, sommeVisees := 0, 0
	for _, tr := range doc.Tracks {
		if tr.FullRate != nil {
			somme += len(tr.FullRate.T)
			sommeVisees += len(tr.FullRate.AimT)
		}
	}
	t.Logf("PUBLIE : %d echantillons de position, %d de visee ; points %d ; ecart faits - (publies + "+
		"avantCreation + horsEmprise + noWorld) = %d (R-B3, apres depart : cf. journal)", somme, sommeVisees,
		c.PublishedPoints, len(pos)-somme-c.AvantCreation-c.HorsEmprise-c.NoWorld)
	mesurerCadence(t, doc)
	mesurerViseesSeules(t, doc)
	brut, gz := gzipTaille(t, doc)
	sans := doc
	sans.Tracks = append([]Track(nil), doc.Tracks...)
	for i := range sans.Tracks {
		sans.Tracks[i].FullRate = nil
	}
	brut0, gz0 := gzipTaille(t, sans)
	t.Logf("POIDS : sans plein debit %d octets (gzip %d) ; avec %d octets (gzip %d)", brut0, gz0, brut, gz)
}

func compterVisees(pos []grammar.BipedPosition) int {
	n := 0
	for _, p := range pos {
		if p.HasYaw {
			n++
		}
	}
	return n
}

// mesurerCadence : par joueur, echantillons par seconde de vie ; ecarts entre positions et entre
// visees consecutives quand le joueur se deplace a plus de 1 m/s (0,328 unite monde par seconde).
func mesurerCadence(t *testing.T, doc ReplayDocument) {
	const vitesseMin = 1 / 3.048 // unites monde par seconde
	parJoueur := map[string][2]float64{}
	parJoueurVisee := map[string]float64{}
	var dtPos, dtVisee []float64
	for _, tr := range doc.Tracks {
		if tr.FullRate == nil {
			continue
		}
		e, v := decoderPleinDebit(tr.FullRate)
		cle := tr.XUID + tr.Bot
		duree := 0.0
		for i := 1; i < len(e); i++ {
			dt := e[i].tUS - e[i-1].tUS
			if e[i].gap {
				continue
			}
			duree += dt
			d := math.Hypot(e[i].x-e[i-1].x, e[i].y-e[i-1].y)
			if dt > 0 && d/(dt/1e6) > vitesseMin {
				dtPos = append(dtPos, dt/1000)
			}
		}
		acc := parJoueur[cle]
		parJoueur[cle] = [2]float64{acc[0] + float64(len(e)), acc[1] + duree/1e6}
		parJoueurVisee[cle] += float64(len(v))
		for i := 1; i < len(v); i++ {
			if enMouvement(e, v[i].tUS, vitesseMin) {
				dtVisee = append(dtVisee, (v[i].tUS-v[i-1].tUS)/1000)
			}
		}
	}
	for k, a := range parJoueur {
		t.Logf("JOUEUR %s : %.0f positions et %.0f visees sur %.0f s : %.1f positions/s, %.1f visees/s", k, a[0],
			parJoueurVisee[k], a[1], a[0]/a[1], parJoueurVisee[k]/a[1])
	}
	t.Logf("ECART ENTRE POSITIONS (mouvement > 1 m/s, n=%d) : mediane %.1f ms, p95 %.1f ms, p99 %.1f ms",
		len(dtPos), quantilePD(dtPos, 0.5), quantilePD(dtPos, 0.95), quantilePD(dtPos, 0.99))
	t.Logf("ECART ENTRE VISEES (mouvement > 1 m/s, n=%d) : mediane %.1f ms, p95 %.1f ms, p99 %.1f ms",
		len(dtVisee), quantilePD(dtVisee, 0.5), quantilePD(dtVisee, 0.95), quantilePD(dtVisee, 0.99))
}

// enMouvement : la vitesse au sol de la vie a l instant tUS, sur les deux positions qui l encadrent.
func enMouvement(e []echantillonDecode, tUS, vitesseMin float64) bool {
	i := sort.Search(len(e), func(i int) bool { return e[i].tUS >= tUS })
	if i <= 0 || i >= len(e) || e[i].gap {
		return false
	}
	dt := (e[i].tUS - e[i-1].tUS) / 1e6
	return dt > 0 && math.Hypot(e[i].x-e[i-1].x, e[i].y-e[i-1].y)/dt > vitesseMin
}

// mesurerViseesSeules : les visees sans position du film (schema 113), ce que les vies en recoivent, et
// ou elles tombent par rapport aux positions de la vie : une visee dont la milliseconde n est celle
// d aucune position est comptee sans position ; elle est « entre deux positions » quand une position de
// la vie tombe a 50 ms ou moins, « position tue » sinon (le slot ne replique plus sa position).
func mesurerViseesSeules(t *testing.T, doc ReplayDocument) {
	c := doc.Coverage.Tracks
	lues := 0
	if v := doc.Coverage.Vehicles; v != nil {
		lues = v.AimReads
	}
	t.Logf("VISEES SANS POSITION : %d lues ; %d au plein debit, %d sans vie (somme %d)", lues,
		c.FullRateAimOnlySamples, c.AimOnlyNoLife, c.FullRateAimOnlySamples+c.AimOnlyNoLife)
	if s := doc.Coverage.Shots; s.Aim != nil {
		t.Logf("DIRECTION DES TIRS : %+v", *s.Aim)
	}
	entre, tue, horsPositions, encadrees := 0, 0, 0, 0
	for _, tr := range doc.Tracks {
		if tr.FullRate == nil {
			continue
		}
		e, v := decoderPleinDebit(tr.FullRate)
		instants := map[float64]bool{}
		for _, s := range e {
			instants[s.tUS] = true
		}
		for _, a := range v {
			if instants[a.tUS] {
				continue
			}
			if len(e) > 0 && (a.tUS < e[0].tUS || a.tUS > e[len(e)-1].tUS) {
				horsPositions++
			}
			i := sort.Search(len(e), func(i int) bool { return e[i].tUS >= a.tUS })
			proche := math.Inf(1)
			if i < len(e) {
				proche = e[i].tUS - a.tUS
			}
			if i > 0 {
				proche = math.Min(proche, a.tUS-e[i-1].tUS)
			}
			// LE CRITERE « A PIED » DE LA DECOUVERTE DU LOT 8 : une position a moins de 500 ms de part et d autre.
			if i > 0 && i < len(e) && a.tUS-e[i-1].tUS < 500_000 && e[i].tUS-a.tUS < 500_000 {
				encadrees++
			}
			if proche <= 50_000 {
				entre++
			} else {
				tue++
			}
		}
	}
	t.Logf("VISEES A UNE MILLISECONDE SANS POSITION : %d entre deux positions (<= 50 ms), %d position tue, "+
		"dont %d avant la premiere ou apres la derniere position de la vie ; %d encadrees a 500 ms", entre, tue,
		horsPositions, encadrees)
}
