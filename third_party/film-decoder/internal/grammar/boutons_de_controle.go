package grammar

// boutons_de_controle.go — LES BOUTONS DE POSTURE LUS DANS LA VUE DE CONTROLE : accroupi (bit 0 des
// drapeaux +0x14 de l entree `kind 0`) et saut (bit 2), avec le couple analogique du deplacement, par index de
// controle, en CHANGEMENTS
// (`types.ControlInputChange` ; le contrat est ecrit en tete de `types/grammar_boutons.go`).
//
// # UN LECTEUR DU CANAL DU TIR CONTINU
//
// La vue C n a qu un crochet ([Observation.VueControleHook]) et le canal du tir continu le tient ; un
// second canal qui le poserait serait refuse ([ErrCrochetDejaPose]). Le collecteur des boutons recoit
// donc, du canal du tir continu, le verdict de chaque trame a sa cloture ([collecteurTirContinu.fermer]).
// Il ne lit aucun bit : drapeaux et couple sont ceux que [consumeEntreeControle] a deja lus.
//
// # LA REGLE
//
// Seule une vue C FERMEE rend des entrees. Une entree sans bloc de controle ne dit rien des boutons.
// Pour chaque index : la premiere entree lue etablit l etat ; une entree dont les deux bits ou le couple
// different de l etat le change ; une entree lue plus de [types.ControlButtonSilenceUS] apres la precedente
// rend d abord l etat INCONNU depuis la precedente. La fin de la marche rend inconnu l etat de chaque
// index connu, a sa derniere entree lue.

import (
	"cmp"
	"slices"

	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// etatDesBoutons est l etat courant d un index de controle : ses boutons et son couple analogique.
type etatDesBoutons struct {
	vu      bool
	dernier uint64
	boutons uint8
	manche  [2]int8
}

// etatLu est ce qu une entree avec bloc dit : ses boutons identifies et son couple analogique brut.
type etatLu struct {
	boutons uint8
	manche  [2]int8
}

// collecteurDesBoutons plie les entrees de controle des vues fermees en changements.
type collecteurDesBoutons struct {
	st    *types.ControlInputStats
	out   []types.ControlInputChange
	etats [joueursDeControle]etatDesBoutons
}

func nouveauCollecteurDesBoutons(st *types.ControlInputStats) *collecteurDesBoutons {
	return &collecteurDesBoutons{st: st}
}

// trame recoit le verdict de la trame d instant `ts` ; `lue` dit que sa vue C est fermee.
func (c *collecteurDesBoutons) trame(ts uint64, l LectureVueC, lue bool) {
	if !lue {
		return
	}
	for _, e := range l.Entrees {
		if e.Index < 0 || e.Index >= joueursDeControle {
			continue
		}
		c.st.Entries++
		if !e.Bloc {
			c.st.WithoutBlock++
			continue
		}
		lu := etatLu{manche: [2]int8{int8(e.Champs.Analogique[0]), int8(e.Champs.Analogique[1])}} //nolint:gosec // R(6) ou -1
		if e.Champs.Drapeaux != ChampDeControleAbsent {
			c.st.WithFlags++
			lu.boutons = uint8(e.Champs.Drapeaux) & types.ControlButtonsKnown //nolint:gosec // R(5)
		}
		c.entree(e.Index, ts, lu)
	}
}

// entree applique l etat `lu` de l index `i` lu a l instant `ts`.
func (c *collecteurDesBoutons) entree(i int, ts uint64, lu etatLu) {
	s := &c.etats[i]
	switch {
	case !s.vu:
		c.st.Indexes++
		c.changer(i, ts, lu)
	case ts > s.dernier && ts-s.dernier > types.ControlButtonSilenceUS:
		c.inconnu(i, s.dernier)
		c.st.Silences++
		c.st.SilenceMS += int64((ts - s.dernier) / 1000) //nolint:gosec // duree d un film
		c.changer(i, ts, lu)
	case lu.boutons != s.boutons || lu.manche != s.manche:
		c.changer(i, ts, lu)
	}
	s.vu, s.dernier, s.boutons, s.manche = true, ts, lu.boutons, lu.manche
}

// changer publie l etat connu `lu` de l index `i` a l instant `ts`.
func (c *collecteurDesBoutons) changer(i int, ts uint64, lu etatLu) {
	c.out = append(c.out, types.ControlInputChange{Index: i, TimestampUS: ts, Buttons: lu.boutons, Stick: lu.manche})
	c.st.Changes++
}

// inconnu publie le passage inconnu de l index `i` a partir de l instant `ts`.
func (c *collecteurDesBoutons) inconnu(i int, ts uint64) {
	c.out = append(c.out, types.ControlInputChange{Index: i, TimestampUS: ts, Unknown: true,
		Stick: [2]int8{types.ControlStickAbsent, types.ControlStickAbsent}})
}

// clore rend inconnu, a sa derniere entree lue, l etat de chaque index connu, puis trie la sortie par
// (instant, index) : l ordre ne depend que du film.
func (c *collecteurDesBoutons) clore() {
	for i := range c.etats {
		if s := c.etats[i]; s.vu {
			c.inconnu(i, s.dernier)
		}
	}
	sortControlInputs(c.out)
	c.st.Scanned = true
}

// sortControlInputs ordonne les changements sur (instant, index), de facon STABLE : pour un meme
// index a un meme instant, le passage inconnu, publie apres l etat lu, le suit.
func sortControlInputs(out []types.ControlInputChange) {
	slices.SortStableFunc(out, func(a, b types.ControlInputChange) int {
		return cmp.Or(cmp.Compare(a.TimestampUS, b.TimestampUS), cmp.Compare(a.Index, b.Index))
	})
}
