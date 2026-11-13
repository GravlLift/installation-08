package replay

import (
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
)

// tirDePlace rend un tir de la place `place` par l unite `slot` a la frame `fr` (pas de 100 ms).
func tirDePlace(place int, slot uint32, fr int) grammar.FireEvent {
	return grammar.FireEvent{TimestampUS: uint64(fr) * 100_000, FilmIndex: place, HasShooter: true,
		Unit: grammar.UnitRef{Present: true, Slot: slot}}
}

// TestPlacesDeControleSuccession : deux joueurs se succedent sur une place. Chacun la tient sur sa
// presence, jusqu au coeur de l autre ; l ecart que leurs presences se disputent n est a personne.
func TestPlacesDeControleSuccession(t *testing.T) {
	occ := occupantsPlats(map[uint32]int{10: 3, 20: 7, 30: 5})
	horloge := replayClock{origin: 0, step: 100_000, frames: 1000}
	fire := []grammar.FireEvent{
		tirDePlace(3, 10, 100), tirDePlace(3, 10, 300), // joueur 3, place 3, coeur [100, 300]
		tirDePlace(3, 20, 600), tirDePlace(3, 20, 800), // joueur 7 arrive a la place 3, coeur [600, 800]
		tirDePlace(5, 30, 50),                            // joueur 5 seul a sa place
		{TimestampUS: 1, FilmIndex: 9, HasShooter: true}, // sans unite : ne lie rien
	}
	vies := map[int][2]int{3: {0, 500}, 7: {400, 999}, 5: {0, 999}}
	p := lirePlacesDeControle(fire, occ, horloge, vies, true)
	if p.cov.Bindings != 5 || p.cov.Players != 3 || p.cov.MultiPlace != 0 || p.cov.Overlaps != 0 {
		t.Fatalf("couverture = %+v", p.cov)
	}
	cas := []struct {
		place, fr, joueur int
		tenue             bool
	}{
		{3, 0, 3, true}, {3, 399, 3, true}, // presence du joueur 3 avant l ecart disputé
		{3, 400, 0, false}, {3, 500, 0, false}, // [400, 500] : les deux presences se recouvrent
		{3, 501, 7, true}, {3, 999, 7, true},
		{5, 999, 5, true},
		{9, 10, 0, false},
	}
	for _, c := range cas {
		j, ok := p.joueurA(c.place, c.fr)
		if ok != c.tenue || (ok && j != c.joueur) {
			t.Errorf("place %d frame %d : joueur %d (%v), attendu %d (%v)", c.place, c.fr, j, ok, c.joueur, c.tenue)
		}
	}
	if pl, ok := p.placeDe(7, 700); !ok || pl != 3 {
		t.Errorf("placeDe(7, 700) = %d, %v", pl, ok)
	}
}

// TestPlacesDeControleCoeursContradictoires : deux joueurs dont les tirs designent la meme place au
// meme moment se contredisent ; le recouvrement n est a personne et il est compte.
func TestPlacesDeControleCoeursContradictoires(t *testing.T) {
	occ := occupantsPlats(map[uint32]int{10: 1, 20: 2})
	fire := []grammar.FireEvent{tirDePlace(4, 10, 100), tirDePlace(4, 10, 500),
		tirDePlace(4, 20, 300), tirDePlace(4, 20, 700)}
	p := lirePlacesDeControle(fire, occ, replayClock{step: 100_000, frames: 1000}, nil, true)
	if p.cov.Overlaps != 1 {
		t.Fatalf("recouvrements = %d, attendu 1", p.cov.Overlaps)
	}
	for fr, attendu := range map[int]int{100: 1, 299: 1, 501: 2, 700: 2} {
		if j, ok := p.joueurA(4, fr); !ok || j != attendu {
			t.Errorf("frame %d : joueur %d (%v), attendu %d", fr, j, ok, attendu)
		}
	}
	if _, ok := p.joueurA(4, 400); ok {
		t.Errorf("frame 400 : le recouvrement des coeurs ne doit etre tenu par personne")
	}
}

// TestPlacesDeControleIndexHorsPlace : sur un film ou l index de tireur n est pas la place, rien
// n est lu.
func TestPlacesDeControleIndexHorsPlace(t *testing.T) {
	occ := occupantsPlats(map[uint32]int{10: 1})
	p := lirePlacesDeControle([]grammar.FireEvent{tirDePlace(4, 10, 100)}, occ, replayClock{step: 100_000}, nil, false)
	if p.cov.Read || p.cov.Bindings != 0 {
		t.Fatalf("couverture = %+v", p.cov)
	}
	if _, ok := p.joueurA(4, 100); ok {
		t.Fatal("aucune place ne doit etre tenue")
	}
}
