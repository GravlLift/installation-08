//go:build research

package grammar

// visee_tir_research_test.go — ce que la lecture de la visee modale du record 36 lit vraiment.
// Pour chaque record de tir de tete dont le chemin modal aboutit : les deux drapeaux qui precedent la
// visee, et les neuf bits a la position de la visee lus comme une tete d evenement
// (configuration, continuation, type R(7)). Lecture seule. GARDE : PLEIN_FILM.

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"sort"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar/lecture"
	"github.com/JGtm/halo-infinite-film-decoder/internal/source"
)

type sondeViseeTir struct {
	comptes map[string]int
	lus     int
}

func (*sondeViseeTir) Interets() []Interet     { return nil }
func (s *sondeViseeTir) Clore(b BilanDeMarche) { s.lus = b.ChunksLus }

func (s *sondeViseeTir) Tete(p *lecture.Paquet) {
	h, ok := lireEnteteTir36Sous(p.Payload, teteDe(p))
	if !ok {
		return
	}
	post, ok := modalPostCountsBitFrom(p.Payload, h)
	if !ok {
		s.comptes["non-modal"]++
		return
	}
	pay := p.Payload
	reste := len(pay)*8 - (post + modalAimGap)
	br := LecteurSur(pay)
	br.SetBitPos(post)
	i, j := br.ReadBit(), br.ReadBit()
	cfg, cont := br.ReadBit(), br.ReadBit()
	typ := br.ReadBits(7)
	var e FireEvent
	readAimAt(pay, &e, post+modalAimGap)
	tete := "autre"
	if cfg && cont && typ == 0 {
		tete = "11+type0"
	}
	s.comptes[fmt.Sprintf("drapeaux=%v%v tete=%s visee=%v", b01(i), b01(j), tete, e.HasAim)]++
	s.comptes[fmt.Sprintf("drapeaux=%v%v reste<30=%v", b01(i), b01(j), reste < int(FireAimBits))]++
	if reste >= int(FireAimBits) {
		brut := source.BitsStricts(pay, post+modalAimGap, int(FireAimBits))
		s.comptes[fmt.Sprintf("haut12=%012b", brut>>18)]++
	}
}

func b01(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

func TestViseeModaleDuTir(t *testing.T) {
	dir := os.Getenv("PLEIN_FILM")
	if dir == "" {
		t.Skip("PLEIN_FILM absent")
	}
	film, err := source.LoadDir(dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	s := &sondeViseeTir{comptes: map[string]int{}}
	distribuerLesTetesSeules(NewFilmContext(film), []Canal{s})
	cles := make([]string, 0, len(s.comptes))
	for k := range s.comptes {
		cles = append(cles, k)
	}
	sort.Strings(cles)
	for _, k := range cles {
		t.Logf("%-48s %d", k, s.comptes[k])
	}
}

type viseeExportee struct {
	Chunk, Paquet int
	H, P          float64
}

type sondeDecalages struct {
	attendu  map[[2]int]viseeExportee
	bons     map[string]int
	mauvais  int
	resolus  map[string]int
	drapeaux map[string][2]int
}

func (*sondeDecalages) Interets() []Interet { return nil }
func (*sondeDecalages) Clore(BilanDeMarche) {}
func vecViseeG(h, p float64) [3]float64 {
	hr, pr := h*math.Pi/180, p*math.Pi/180
	return [3]float64{math.Cos(pr) * math.Cos(hr), math.Cos(pr) * math.Sin(hr), math.Sin(pr)}
}
func angleG(a [3]float32, b [3]float64) float64 {
	d := float64(a[0])*b[0] + float64(a[1])*b[1] + float64(a[2])*b[2]
	return math.Acos(math.Max(-1, math.Min(1, d))) * 180 / math.Pi
}

func (s *sondeDecalages) Tete(p *lecture.Paquet) {
	att, ok := s.attendu[[2]int{p.Chunk, p.Index}]
	if !ok {
		return
	}
	h, ok := lireEnteteTir36Sous(p.Payload, teteDe(p))
	if !ok {
		return
	}
	post, ok := modalPostCountsBitFrom(p.Payload, h)
	if !ok {
		return
	}
	pay, vraie := p.Payload, vecViseeG(att.H, att.P)
	br := LecteurSur(pay)
	br.SetBitPos(post)
	dr := b01(br.ReadBit()) + b01(br.ReadBit())
	v, _ := DecodeAimVectorChecked(uint32(source.BitsStricts(pay, post+modalAimGap, int(FireAimBits))), FireAimBits)
	c := s.drapeaux[dr]
	if angleG(v, vraie) < 1 {
		c[0]++
		s.drapeaux[dr] = c
		return
	}
	c[1]++
	s.drapeaux[dr] = c
	s.mauvais++
	for dec := -8; dec <= 64; dec++ {
		for w := uint(16); w <= 30; w++ {
			at := post + modalAimGap + dec
			if at < 0 || at+int(w) > len(pay)*8 {
				continue
			}
			if u, ok := DecodeAimVectorChecked(uint32(source.BitsStricts(pay, at, int(w))), w); ok && angleG(u, vraie) < 1.5 {
				s.resolus[fmt.Sprintf("dec=%+d w=%d", dec, w)]++
			}
		}
	}
}

func TestDecalagesDeLaViseeModale(t *testing.T) {
	dir, chemin := os.Getenv("PLEIN_FILM"), os.Getenv("PLEIN_EXPORT")
	if dir == "" || chemin == "" {
		t.Skip("PLEIN_FILM / PLEIN_EXPORT absents")
	}
	raw, err := os.ReadFile(chemin)
	if err != nil {
		t.Fatal(err)
	}
	var lignes []viseeExportee
	if err := json.Unmarshal(raw, &lignes); err != nil {
		t.Fatal(err)
	}
	s := &sondeDecalages{attendu: map[[2]int]viseeExportee{}, resolus: map[string]int{}, drapeaux: map[string][2]int{}}
	for _, l := range lignes {
		s.attendu[[2]int{l.Chunk, l.Paquet}] = l
	}
	film, err := source.LoadDir(dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	distribuerLesTetesSeules(NewFilmContext(film), []Canal{s})
	t.Logf("drapeaux (bons, mauvais) : %v ; mauvais %d", s.drapeaux, s.mauvais)
	for k, n := range s.resolus {
		if n*20 >= s.mauvais {
			t.Logf("  %s : %d", k, n)
		}
	}
}
