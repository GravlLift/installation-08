package grammar

// vue_a_actions_test.go — LES MESSAGES D ACTION DE LA VUE A ET LEUR CAPTURE (vue_a_actions.go,
// actions_du_film.go).

import (
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar/lecture"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// ecrireRefDomaine1 ecrit une reference gardee de domaine 1, sans sonde : porte, sonde a 0, index
// sur 13 bits, generation.
func (w *bitWriter) ecrireRefDomaine1(index, gen uint64) {
	w.bit(1)
	w.bit(0)
	w.bits(index, int(varWidthBits(1)))
	w.bits(gen, 2)
}

// ecrireDegatsApres ecrit un `damage_aftermath` (genre 0) : la victime et le responsable en domaine 1,
// la reference 2 absente, puis la charge de [chargeDegatsApres] avec la source `src` sous sa porte et
// tous les autres champs a leur forme la plus courte.
func (w *bitWriter) ecrireDegatsApres(victime, responsable uint64, src uint32) {
	w.bit(1)
	w.bits(uint64(GenreDegatsApres), LargeurGenreVueA)
	w.ecrireRefDomaine1(victime, 1)
	w.ecrireRefDomaine1(responsable, 2)
	w.bit(0)                    // ref2 (domaine 7) absente
	w.bit(1)                    // porte de la source
	w.bits(uint64(src), 32)     // la source
	w.bit(1)                    // FUN_1407f2058 : porte a 1, rien
	w.bits(0, largeurDirection) // FUN_14076dc04
	w.bit(0)                    // [+0x20]
	w.bits(0, 5+5+6)            // trois FUN_1406d84b4
	w.bit(0)                    // bloc froid : porte fermee
	w.bits(0, drapeauxDeDegats) // quinze drapeaux, le dernier a 0
	w.bits(0, 1+3+5+5+1+4)      // bit 19, [+0x5c], deux scalaires, echelle, FUN_1407f1f24
	w.bit(1)                    // FUN_1407f1e4c : porte a 1, rien
	w.bits(0, 4)                // [+0x58] = 0
	w.bit(0)                    // FUN_141015740 : porte fermee
	w.bits(0, int(bitLen(10)))  // FUN_1406d310c(10)
	w.bit(0)                    // reference de queue absente
}

// TestLaVueAGardeLesDegatsApres : un `damage_aftermath` suivi d un message vide se lit jusqu au
// terminateur, et la vue A garde le genre 0 avec ses deux references et sa source — les bits que
// [chargeDegatsApres] consommait deja. MUTATIONS — la porte de la source lue a l envers, la
// reference 1 non gardee, le genre 0 retire de [genreDAction] : ROUGE.
func TestLaVueAGardeLesDegatsApres(t *testing.T) {
	var w bitWriter
	w.bit(1) // bit de configuration
	w.ecrireDegatsApres(7, 3, 0xDEADBEEF)
	w.bit(0) // terminateur
	w.bits(0, 16)
	a := lireSous(w.buf, grammaireRecente())
	if !a.Porte || len(a.Actions) != 1 {
		t.Fatalf("vue A : portee %v, %d action(s), attendu portee et 1 (genres %v)", a.Porte, len(a.Actions), a.Genres)
	}
	m := a.Actions[0]
	if m.Genre != types.FilmActionDamage || !m.ADrapeau(lecture.ActionRef0) || !m.ADrapeau(lecture.ActionRef1) ||
		!m.ADrapeau(lecture.ActionSourceLue) {
		t.Fatalf("message = %+v, attendu genre 0, deux references et la source", m)
	}
	if m.Ref != [2]uint16{7, 3} || m.Gen != [2]uint8{1, 2} || m.Source != 0xDEADBEEF {
		t.Fatalf("message = %+v, attendu refs {7,3}, generations {1,2}, source 0xDEADBEEF", m)
	}
}

// TestUneActionPorteLaBaseDeSonDomaine : la vie d une reference de domaine 1 ou 2 est l index plus
// 0x200 (mesure : 100 % des rechargements, lancers et coups, 97 % des victimes de degat de 512155b9
// tombent sur un slot bipede vu sous cette base, 0 % sous 0, 256, 768, 1024).
func TestUneActionPorteLaBaseDeSonDomaine(t *testing.T) {
	m := lecture.MessageDAction{Genre: types.FilmActionDamage, Ref: [2]uint16{7, 3}, Gen: [2]uint8{1, 2},
		Source: 42, Drapeaux: lecture.ActionRef0 | lecture.ActionRef1 | lecture.ActionSourceLue}
	got := actionDuMessage(1000, m)
	want := types.FilmActionMessage{TimestampUS: 1000, Genre: 0,
		Actor: types.LifeKey{Slot: 0x200 + 7, Gen: 1}, HasActor: true,
		Other: types.LifeKey{Slot: 0x200 + 3, Gen: 2}, HasOther: true, Source: 42, HasSource: true}
	if got != want {
		t.Fatalf("action = %+v, attendu %+v", got, want)
	}
	for dom, base := range map[int]uint32{0: 0x200, 1: 0x200, 2: 0x200, 3: 0x300, 4: 0x200, 5: 0x400, 7: 0} {
		if b := baseDuDomaine(dom); b != base {
			t.Errorf("base du domaine %d = %#x, attendu %#x", dom, b, base)
		}
	}
}
