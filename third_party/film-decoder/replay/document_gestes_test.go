package replay

// document_gestes_test.go — LA PUBLICATION DES GESTES, SANS FILM (schema 108) : l axe de frames, le
// filtre des vies publiees, le libelle de chaque genre et l identite de la couverture.

import (
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// TestBuildPlayerActionsProjetteEtCompte : un geste avant l origine, un sur une vie sans piste, un
// sans acteur, trois publiables (un par genre) ; un degat n est pas un geste. MUTATIONS — un genre
// retire de [gestesPublies], le filtre des pistes publiees retire : ROUGE.
func TestBuildPlayerActionsProjetteEtCompte(t *testing.T) {
	const origin, step = 1_000_000, 100_000
	acteur := func(ts uint64, genre uint8, slot uint32) types.FilmActionMessage {
		return types.FilmActionMessage{TimestampUS: ts, Genre: genre, Actor: types.LifeKey{Slot: slot}, HasActor: true}
	}
	msgs := []types.FilmActionMessage{
		acteur(500_000, types.FilmActionReload, 520),
		acteur(1_200_000, types.FilmActionReload, 520),
		acteur(1_300_000, types.FilmActionThrowStart, 530),
		acteur(1_400_000, types.FilmActionMelee, 999),
		{TimestampUS: 1_450_000, Genre: types.FilmActionMelee},
		acteur(1_500_000, types.FilmActionMelee, 520),
		acteur(1_600_000, types.FilmActionDamage, 520),
	}
	var cov PlayerActionsCoverage
	out := buildPlayerActions(msgs, map[uint32]bool{520: true, 530: true}, origin, step, &cov)
	want := []PlayerAction{{T: 2, Ms: 200, Slot: 520, Kind: "reload"}, {T: 3, Ms: 300, Slot: 530, Kind: "throwStart"},
		{T: 5, Ms: 500, Slot: 520, Kind: "melee"}}
	if len(out) != len(want) {
		t.Fatalf("publies = %+v, attendu %+v", out, want)
	}
	for i := range want {
		if out[i] != want[i] {
			t.Fatalf("geste %d = %+v, attendu %+v", i, out[i], want[i])
		}
	}
	wantCov := PlayerActionsCoverage{ActionsRead: 6, ActionsPublished: 3, ActionsNoTrack: 2, ActionsBeforeOrigin: 1}
	if cov != wantCov {
		t.Fatalf("couverture = %+v, attendu %+v", cov, wantCov)
	}
}
