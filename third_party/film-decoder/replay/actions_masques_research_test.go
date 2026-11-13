//go:build research

package replay

// actions_masques_research_test.go — la presence des composants d etat de mouvement dans les
// records de trame delta, TOUS archetypes confondus : pour chaque archetype qui declare
// `unit-crouch-component`, `biped-slide-component` ou `biped-action-component`, combien de
// records le portent dans leur masque ; et le verdict de fermeture de chaque trame. Lecture
// seule, UN film par processus.
//
// CE QU IL A ETABLI (HI_1_13_0) : accroupi et glissade sont ABSENTS des records d entite, aucun masque
// ne porte `unit-crouch-component` ni `biped-slide-component`. Ils sont PRESENTS dans la commande du
// joueur : le bit 0 des drapeaux de l entree de controle de la vue C (types/grammar_boutons.go).
//
// GARDE : ACTIONS_FILM et ACTIONS_MAP (comme actions_film_research_test.go).

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
	lec "github.com/JGtm/halo-infinite-film-decoder/internal/grammar/lecture"
	"github.com/JGtm/halo-infinite-film-decoder/internal/profile"
	"github.com/JGtm/halo-infinite-film-decoder/internal/source"
)

var sondeNoms = map[string]bool{"unit-crouch-component": true, "biped-slide-component": true,
	"biped-action-component": true, "simulation-state-component": true}

type cleSonde struct {
	ti  int16
	nom string
}

type sondeDesMasques struct {
	reg                              *grammar.Registry
	declares                         map[int16]map[int]string // ti -> index -> nom surveille
	records                          map[int16]int
	portes                           map[cleSonde]int
	verdicts                         map[lec.Verdict]int
	recFermes                        map[lec.Verdict]int
	hook                             map[grammar.EtatMouvementComposant]int
	drapeaux, courts, champ10, cdc04 map[int]int
}

func (*sondeDesMasques) Interets() []grammar.Interet { return nil }
func (*sondeDesMasques) Clore(grammar.BilanDeMarche) {}
func (s *sondeDesMasques) Brancher(obs *grammar.Observation, _ *grammar.MarcheDistribuee) {
	obs.EtatMouvementHook = func(c grammar.EtatMouvementComposant, _ uint32, _ []uint64) { s.hook[c]++ }
	obs.VueControleHook = func(l grammar.LectureVueC) {
		for _, e := range l.Entrees {
			s.drapeaux[e.Champs.Drapeaux]++
			s.courts[e.Champs.Court]++
			s.champ10[e.Champs.Champ10]++
			s.cdc04[e.Champs.Cdc04]++
		}
	}
}

func (s *sondeDesMasques) ImageCle(p *lec.Paquet, _ *grammar.MarcheDistribuee) {
	for _, r := range p.Records {
		idx, ok := s.declares[r.TI]
		if !ok {
			continue
		}
		s.records[-r.TI-1]++
		for i, nom := range idx {
			if r.Masque>>uint(i)&1 == 1 {
				s.portes[cleSonde{-r.TI - 1, nom}]++
			}
		}
	}
}

func (s *sondeDesMasques) Trame(p *lec.Paquet) {
	s.verdicts[p.Fermeture.Verdict]++
	for _, r := range p.Records {
		s.recFermes[p.Fermeture.Verdict]++
		idx, ok := s.declares[r.TI]
		if !ok {
			continue
		}
		s.records[r.TI]++
		for i, nom := range idx {
			if r.Masque>>uint(i)&1 == 1 {
				s.portes[cleSonde{r.TI, nom}]++
			}
		}
	}
}

func TestActionsMasquesDuBipede(t *testing.T) {
	dir, mapName := os.Getenv("ACTIONS_FILM"), os.Getenv("ACTIONS_MAP")
	if dir == "" || mapName == "" {
		t.Skip("ACTIONS_FILM / ACTIONS_MAP absents : instrument de mesure saute")
	}
	cat, err := profile.LoadMapQuantCatalog(filepath.Join("..", "..", "..", "data", "titles", "halo_infinite",
		"reference", "map_quant_bounds.json"))
	if err != nil {
		t.Fatalf("catalogue de bornes : %v", err)
	}
	entry, err := cat.Lookup(mapName)
	if err != nil {
		t.Fatalf("carte %q : %v", mapName, err)
	}
	film, err := source.LoadDir(dir, nil)
	if err != nil {
		t.Fatalf("chunks : %v", err)
	}
	opt := Options{MapQuant: &entry}
	fc := grammar.NewFilmContextForMap(film, opt.MapQuant, decoupageForce(opt))
	poserProfilPuisCarte(context.Background(), fc, "sonde", opt)
	reg, err := fc.Registry()
	if err != nil {
		t.Fatalf("registre : %v", err)
	}
	s := &sondeDesMasques{reg: reg, declares: map[int16]map[int]string{}, records: map[int16]int{},
		portes: map[cleSonde]int{}, verdicts: map[lec.Verdict]int{}, recFermes: map[lec.Verdict]int{},
		hook: map[grammar.EtatMouvementComposant]int{}, drapeaux: map[int]int{}, courts: map[int]int{},
		champ10: map[int]int{}, cdc04: map[int]int{}}
	for ti := 0; ; ti++ {
		a, ok := reg.Archetype(ti)
		if !ok {
			break
		}
		for i, n := range a.Components {
			if sondeNoms[n] && i < 64 {
				if s.declares[int16(ti)] == nil {
					s.declares[int16(ti)] = map[int]string{}
				}
				s.declares[int16(ti)][i] = n
			}
		}
	}
	if err := grammar.Distribuer(fc, s); err != nil {
		t.Fatalf("marche : %v", err)
	}
	tis := make([]int, 0, len(s.declares))
	for ti := range s.declares {
		tis = append(tis, int(ti))
	}
	sort.Ints(tis)
	for _, ti := range tis {
		for i, n := range s.declares[int16(ti)] {
			t.Logf("ti=%-3d i%-2d %-28s records=%-8d masque=%-6d | images-cles records=%-6d masque=%d", ti, i, n,
				s.records[int16(ti)], s.portes[cleSonde{int16(ti), n}],
				s.records[int16(-ti-1)], s.portes[cleSonde{int16(-ti - 1), n}])
		}
	}
	t.Logf("VERDICTS (trames) : nonRendu=%d ferme=%d refuse=%d queue=%d", s.verdicts[lec.VerdictNonRendu],
		s.verdicts[lec.VerdictFerme], s.verdicts[lec.VerdictRefuse], s.verdicts[lec.VerdictQueueOpaque])
	t.Logf("VERDICTS (records) : nonRendu=%d ferme=%d refuse=%d queue=%d", s.recFermes[lec.VerdictNonRendu],
		s.recFermes[lec.VerdictFerme], s.recFermes[lec.VerdictRefuse], s.recFermes[lec.VerdictQueueOpaque])
	t.Logf("CROCHET : %v", s.hook)
	t.Logf("VUE C drapeaux+0x14 : %v", s.drapeaux)
	t.Logf("VUE C court : %v", s.courts)
	t.Logf("VUE C champ10 : %v", s.champ10)
	t.Logf("VUE C cdc04 : %v", s.cdc04)
}
