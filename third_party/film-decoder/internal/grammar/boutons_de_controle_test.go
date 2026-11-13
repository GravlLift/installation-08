package grammar

// boutons_de_controle_test.go — LES BOUTONS DE POSTURE DE LA VUE C : la regle du collecteur sur des
// verdicts synthetiques, puis la lecture sur une bobine reelle.

import (
	"path/filepath"
	"slices"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/source"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// entreeDeBoutons rend une entree de controle de l index `i`, bloc present, drapeaux `d` (-1 = absents).
func entreeDeBoutons(i, d int) EntreeDeControle {
	e := EntreeDeControle{Index: i, Bloc: true, Champs: champsAbsents()}
	e.Champs.Drapeaux, e.Champs.Analogique = d, [2]int{31, 31}
	return e
}

// TestBoutonsDeControleRegle : etat initial, changement, bits non identifies ignores, entree sans bloc
// muette, couple seul change, vue non fermee ignoree, silence au-dela du seuil = passage inconnu, fin de marche = inconnu.
func TestBoutonsDeControleRegle(t *testing.T) {
	var st types.ControlInputStats
	c := nouveauCollecteurDesBoutons(&st)
	fermee := func(es ...EntreeDeControle) LectureVueC { return LectureVueC{Fermee: true, Entrees: es} }
	c.trame(1_000, fermee(entreeDeBoutons(3, -1)), true)                            // etat initial : 0
	c.trame(2_000, fermee(entreeDeBoutons(3, 1), entreeDeBoutons(5, 4)), true)      // 3 accroupi ; 5 saut
	c.trame(3_000, fermee(entreeDeBoutons(3, 1|2|8), entreeDeBoutons(5, -1)), true) // bits 1 et 3 : non publies
	c.trame(4_000, fermee(EntreeDeControle{Index: 3}), true)                        // sans bloc : ne dit rien
	manche := entreeDeBoutons(5, -1)
	manche.Champs.Analogique = [2]int{62, 0}
	c.trame(4_500, fermee(manche), true)                   // le couple seul change
	c.trame(5_000, fermee(entreeDeBoutons(3, -1)), false)  // vue non fermee : rien
	c.trame(500_000, fermee(entreeDeBoutons(3, -1)), true) // silence de 497 ms
	c.clore()
	n, x := [2]int8{31, 31}, [2]int8{types.ControlStickAbsent, types.ControlStickAbsent}
	want := []types.ControlInputChange{
		{Index: 3, TimestampUS: 1_000, Stick: n},
		{Index: 3, TimestampUS: 2_000, Buttons: types.ControlButtonCrouch, Stick: n},
		{Index: 5, TimestampUS: 2_000, Buttons: types.ControlButtonJump, Stick: n},
		{Index: 3, TimestampUS: 3_000, Unknown: true, Stick: x},
		{Index: 5, TimestampUS: 3_000, Stick: n},
		{Index: 5, TimestampUS: 4_500, Stick: [2]int8{62, 0}},
		{Index: 5, TimestampUS: 4_500, Unknown: true, Stick: x},
		{Index: 3, TimestampUS: 500_000, Stick: n},
		{Index: 3, TimestampUS: 500_000, Unknown: true, Stick: x},
	}
	if !slices.Equal(c.out, want) {
		t.Fatalf("changements\n got %+v\nwant %+v", c.out, want)
	}
	if st.Entries != 8 || st.WithoutBlock != 1 || st.WithFlags != 3 || st.Silences != 1 || st.SilenceMS != 497 ||
		st.Indexes != 2 || st.Changes != 6 || !st.Scanned {
		t.Fatalf("stats %+v", st)
	}
}

// TestBoutonsDeControleSurUneBobine : sur la mini-bobine `000d5950` (HI_1_13_0), la marche de production
// rend des pressions du bouton d accroupi et des impulsions de saut, et une impulsion de saut dure UN
// tick (son relachement suit a moins de 50 ms dans la grande majorite des cas).
// MUTATIONS — le masque des bits publies a 0, le bit 0 ou le bit 2 retires de
// [types.ControlButtonsKnown], les drapeaux ignores dans [collecteurDesBoutons.trame] : ROUGE.
func TestBoutonsDeControleSurUneBobine(t *testing.T) {
	film, err := source.LoadDir(filepath.Join("..", "facts", "killsource", "testdata", "minibobine_000d5950"), nil)
	if err != nil {
		t.Fatalf("bobine : %v", err)
	}
	m, err := ScanMarcheDesTrames(NewFilmContext(film))
	if err != nil {
		t.Fatalf("marche : %v", err)
	}
	pressions, sauts, courts := 0, 0, 0
	etat := map[int]types.ControlInputChange{}
	for i, c := range m.ControlInputs {
		if i > 0 && c.TimestampUS < m.ControlInputs[i-1].TimestampUS {
			t.Fatalf("changements non tries au rang %d", i)
		}
		avant, vu := etat[c.Index]
		if !c.Unknown && c.Buttons&types.ControlButtonCrouch != 0 && (!vu || avant.Unknown || avant.Buttons&types.ControlButtonCrouch == 0) {
			pressions++
		}
		if !c.Unknown && c.Buttons&types.ControlButtonJump != 0 && (!vu || avant.Unknown || avant.Buttons&types.ControlButtonJump == 0) {
			sauts++
		}
		if vu && !avant.Unknown && avant.Buttons&types.ControlButtonJump != 0 && c.Buttons&types.ControlButtonJump == 0 &&
			c.TimestampUS-avant.TimestampUS < 50_000 {
			courts++
		}
		etat[c.Index] = c
	}
	st := m.ControlInputStats
	t.Logf("000d5950 : %d changements, %d pressions d accroupi, %d sauts dont %d d un tick ; stats %+v",
		len(m.ControlInputs), pressions, sauts, courts, st)
	if !st.Scanned || pressions < seuilDesPressions || sauts < seuilDesSauts || courts*100 < sauts*seuilDesSautsCourtsPct {
		t.Fatalf("pressions %d (au moins %d), sauts %d (au moins %d), d un tick %d (au moins %d %%)", pressions,
			seuilDesPressions, sauts, seuilDesSauts, courts, seuilDesSautsCourtsPct)
	}
}

// Les seuils de [TestBoutonsDeControleSurUneBobine], sous les comptes mesures sur la bobine le 2026-11-09 :
// 225 changements sur 8 index, 15 pressions d accroupi, 69 sauts dont 65 relaches au tick suivant.
const (
	seuilDesPressions      = 12
	seuilDesSauts          = 60
	seuilDesSautsCourtsPct = 80
)
