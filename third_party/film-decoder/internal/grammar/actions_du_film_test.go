package grammar

// actions_du_film_test.go — LES ACTIONS DU JOUEUR SUR UNE BOBINE REELLE (mini-bobine killsource) : le jeu
// d armes desire de la marche des trames et les messages d action de la vue A (degats, rechargement,
// lancer amorce, coup), et le recoupement des deux voies, independantes, sur les memes slots bipedes.

import (
	"maps"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/source"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// TestActionsDuJoueurSurUneBobine : sur la mini-bobine killsource `000d5950` (HI_1_13_0, six chunks
// contigus), la marche rend des changements d arme sur des slots bipedes, la vue A ses messages
// d action, et les deux voies — le slot du record pour `i42`, la reference de domaine 1 ou 2 plus sa base pour
// les messages — nomment les MEMES slots ; la vue A garde les quatre genres et eux seuls.
// MUTATIONS — la base des domaines 1 et 2 a 0 ou 0x100, le slot du crochet d `i42` remplace par 0,
// un des genres 0, 38, 39, 40 retire de [genreDAction] ou un cinquieme ajoute : ROUGE.
func TestActionsDuJoueurSurUneBobine(t *testing.T) {
	film, err := source.LoadDir(filepath.Join("..", "facts", "killsource", "testdata", "minibobine_000d5950"), nil)
	if err != nil {
		t.Fatalf("bobine : %v", err)
	}
	fc := NewFilmContext(film)
	m, err := ScanMarcheDesTrames(fc)
	if err != nil {
		t.Fatalf("marche : %v", err)
	}
	armes := map[uint32]bool{}
	for i, d := range m.DrawnWeapons {
		if d.Principal < -1 || d.Principal > 3 || d.Second < -1 || d.Second > 3 {
			t.Fatalf("lecture %d = %+v : emplacement hors de -1..3", i, d)
		}
		if i > 0 && d.TimestampUS < m.DrawnWeapons[i-1].TimestampUS {
			t.Fatalf("lectures non triees par instant au rang %d", i)
		}
		armes[d.Slot] = true
	}
	bipedes := maps.Clone(armes)
	for _, s := range m.MovementStates {
		bipedes[s.Slot] = true
	}
	if m.DrawnWeaponStats.Read != len(m.DrawnWeapons) || len(m.DrawnWeapons) < seuilDesChangementsDArme {
		t.Fatalf("changements d arme : %d lus (stats %+v), attendu au moins %d et Read egal", len(m.DrawnWeapons),
			m.DrawnWeaponStats, seuilDesChangementsDArme)
	}
	lus, surUnBipede := map[uint8]int{}, map[uint8]int{}
	for _, a := range ScanFilmActions(fc) {
		lus[a.Genre]++
		if a.HasActor && bipedes[a.Actor.Slot] {
			surUnBipede[a.Genre]++
		}
	}
	t.Logf("000d5950 : %d changements d arme sur %d slots ; par genre, lus %v, sur un slot bipede de la marche %v",
		len(m.DrawnWeapons), len(armes), lus, surUnBipede)
	for _, g := range []uint8{types.FilmActionDamage, types.FilmActionReload, types.FilmActionThrowStart,
		types.FilmActionMelee} {
		if lus[g] < seuilsDesActions[g] || surUnBipede[g]*100 < lus[g]*seuilDeRecoupementPct {
			t.Errorf("genre %d : %d lus, %d sur un slot de la marche, attendu au moins %d et %d %%", g, lus[g],
				surUnBipede[g], seuilsDesActions[g], seuilDeRecoupementPct)
		}
	}
	if len(lus) != len(seuilsDesActions) {
		t.Errorf("genres gardes %v, attendu les seuls %v", lus, seuilsDesActions)
	}
}

// Les seuils de [TestActionsDuJoueurSurUneBobine], fixes sous les comptes mesures sur la bobine le
// 2026-11-09 : 57 changements d arme sur 17 slots ; 80 degats dont 78 (97,5 %) sur un slot bipede de
// la marche, 51 rechargements, 10 lancers amorces et 3 coups, tous sur un slot bipede.
const (
	seuilDesChangementsDArme = 50
	seuilDeRecoupementPct    = 90
)

var seuilsDesActions = map[uint8]int{types.FilmActionDamage: 70, types.FilmActionReload: 45,
	types.FilmActionThrowStart: 8, types.FilmActionMelee: 2}
