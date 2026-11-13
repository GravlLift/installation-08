package replay

// document_actions_joueur_test.go — LA PUBLICATION DES ACTIONS DU JOUEUR, SANS FILM (schema 107) :
// l axe de frames, le filtre des vies publiees, les comptes de la couverture, et l aller-retour du
// fichier de faits.

import (
	"reflect"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// TestBuildDrawnWeaponsProjetteEtCompte : une lecture avant l origine, une sur un slot sans piste et
// deux publiables ; l emplacement -1 ne se publie pas. L identite de la couverture tient.
func TestBuildDrawnWeaponsProjetteEtCompte(t *testing.T) {
	const origin, step = 1_000_000, 100_000
	reads := []types.DrawnWeaponRead{
		{TimestampUS: 500_000, Slot: 520, Principal: 1, Second: -1},
		{TimestampUS: 1_250_000, Slot: 520, Principal: 2, Second: -1},
		{TimestampUS: 1_300_000, Slot: 999, Principal: 0, Second: -1},
		{TimestampUS: 1_900_000, Slot: 520, Principal: -1, Second: 3},
	}
	var cov PlayerActionsCoverage
	out := buildDrawnWeapons(reads, types.DrawnWeaponStats{Read: 4, SlotUnbound: 2}, map[uint32]bool{520: true},
		origin, step, &cov)
	if len(out) != 2 || out[0].T != 2 || *out[0].D != 2 || out[0].D2 != nil || out[1].T != 9 || out[1].D != nil ||
		*out[1].D2 != 3 {
		t.Fatalf("publies = %+v, attendu {t 2, d 2} et {t 9, d2 3}", out)
	}
	if cov.DrawnRead != 4 || cov.DrawnSlotUnbound != 2 || cov.DrawnPublished != 2 || cov.DrawnNoTrack != 1 ||
		cov.DrawnBeforeOrigin != 1 {
		t.Fatalf("couverture = %+v", cov)
	}
	if cov.DrawnRead != cov.DrawnPublished+cov.DrawnNoTrack+cov.DrawnBeforeOrigin {
		t.Fatalf("identite de la couverture rompue : %+v", cov)
	}
}

// TestBuildDamagesNeGardeQueLesVictimesPubliees : un degat sur un vehicule (slot sans piste) est
// ecarte et compte ; un responsable sans piste laisse `by` absent ; les autres genres sont ignores.
func TestBuildDamagesNeGardeQueLesVictimesPubliees(t *testing.T) {
	const origin, step = 0, 100_000
	msgs := []types.FilmActionMessage{
		{TimestampUS: 200_000, Genre: types.FilmActionDamage, Actor: types.LifeKey{Slot: 520}, HasActor: true,
			Other: types.LifeKey{Slot: 530}, HasOther: true, Source: 77, HasSource: true},
		{TimestampUS: 300_000, Genre: types.FilmActionDamage, Actor: types.LifeKey{Slot: 800}, HasActor: true},
		{TimestampUS: 400_000, Genre: types.FilmActionDamage, Actor: types.LifeKey{Slot: 530}, HasActor: true,
			Other: types.LifeKey{Slot: 900}, HasOther: true},
		{TimestampUS: 500_000, Genre: 38, Actor: types.LifeKey{Slot: 520}, HasActor: true},
	}
	var cov PlayerActionsCoverage
	out := buildDamages(msgs, map[uint32]bool{520: true, 530: true}, origin, step, &cov)
	if len(out) != 2 || out[0].T != 2 || out[0].Slot != 520 || *out[0].By != 530 || *out[0].Src != 77 ||
		out[1].Slot != 530 || out[1].By != nil || out[1].Src != nil {
		t.Fatalf("publies = %+v", out)
	}
	want := PlayerActionsCoverage{DamagesRead: 3, DamagesPublished: 2, DamagesNoTrack: 1, DamagesWithoutAuthor: 1}
	if cov != want {
		t.Fatalf("couverture = %+v, attendu %+v", cov, want)
	}
}

// TestLesActionsDuJoueurFontLAllerRetourDesFaits : ce que [encodeActionsDuJoueur] ecrit,
// [decodeActionsDuJoueur] le relit a l identique, emplacements negatifs compris.
func TestLesActionsDuJoueurFontLAllerRetourDesFaits(t *testing.T) {
	drawn := []types.DrawnWeaponRead{{TimestampUS: 10, Slot: 520, Principal: -1, Second: -1},
		{TimestampUS: 40, Slot: 777, Principal: 3, Second: 1}}
	st := types.DrawnWeaponStats{Read: 2, SlotUnbound: 5, Duplicates: 1}
	actions := []types.FilmActionMessage{{TimestampUS: 7, Genre: types.FilmActionDamage,
		Actor: types.LifeKey{Slot: 520, Gen: 3}, HasActor: true, Other: types.LifeKey{Slot: 530, Gen: 1},
		HasOther: true, Source: 0xFFFFFFFF, HasSource: true}, {TimestampUS: 9, Genre: 40}}
	var w gwriter
	encodeActionsDuJoueur(&w, drawn, st, actions)
	r := &greader{b: w.b}
	gotDrawn, gotSt, gotActions := decodeActionsDuJoueur(r)
	if r.err != nil {
		t.Fatalf("relecture : %v", r.err)
	}
	if !reflect.DeepEqual(gotDrawn, drawn) || gotSt != st || !reflect.DeepEqual(gotActions, actions) {
		t.Fatalf("aller-retour : %+v %+v %+v", gotDrawn, gotSt, gotActions)
	}
}
