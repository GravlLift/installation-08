package grammar

// jeu_darmes_desire.go — LE JEU D ARMES DESIRE DU BIPEDE DANS LES TRAMES DELTA : `i42
// biped-desired-weapon-set` ([consumeBipedDesiredWeaponSet]), recueilli par slot sur la marche des
// trames.
//
// Un delta ne porte `i42` que quand le jeu change : chaque lecture est un CHANGEMENT d arme, a la
// trame pres, la ou les images-cles ne le donnent qu une fois toutes les ~20 s
// (`types.KeyframeInventory.DrawnSlot`, le meme champ). Rien n est lu de plus : le deserialiseur
// publiait deja ses trois champs, ce canal recoit le slot avec eux.

import (
	"cmp"
	"slices"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar/lecture"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// canalDuJeuDArmes est le canal du jeu d armes desire de la marche des trames ([CanalDesTrames]).
type canalDuJeuDArmes struct {
	st   types.DrawnWeaponStats
	m    *MarcheDistribuee
	vues map[jeuDArmesCle]types.DrawnWeaponRead
	out  []types.DrawnWeaponRead
}

// jeuDArmesCle deduplique une lecture : une seconde traversee du meme record (chaine de transitoires
// de [decodeInferLoop]) re-publie la MEME lecture.
type jeuDArmesCle struct {
	slot uint32
	ts   uint64
}

func nouveauCanalDuJeuDArmes() *canalDuJeuDArmes {
	return &canalDuJeuDArmes{vues: map[jeuDArmesCle]types.DrawnWeaponRead{}}
}

// Interets : `i42` du bipede, dans les trames.
func (*canalDuJeuDArmes) Interets() []Interet {
	return []Interet{{Phase: PhaseTrames, TI: BipedTypeIndex, Composant: compBipedDesiredWeaponSet}}
}

// Brancher pose le crochet du jeu d armes desire.
func (c *canalDuJeuDArmes) Brancher(obs *Observation, m *MarcheDistribuee) {
	c.m = m
	obs.DesiredWeaponSetHook = c.recevoir
}

// Trame : rien a compter par trame, le crochet recoit les lectures pendant la marche.
func (*canalDuJeuDArmes) Trame(*lecture.Paquet) {}

// Clore vide la table de deduplication dans la sortie, triee par (instant, slot).
func (c *canalDuJeuDArmes) Clore(BilanDeMarche) {
	c.out = make([]types.DrawnWeaponRead, 0, len(c.vues))
	for _, r := range c.vues {
		c.out = append(c.out, r)
	}
	slices.SortFunc(c.out, func(a, b types.DrawnWeaponRead) int {
		return cmp.Or(cmp.Compare(a.TimestampUS, b.TimestampUS), cmp.Compare(a.Slot, b.Slot))
	})
}

// recevoir capte UNE lecture d `i42`. Le filtre est celui des etats de mouvement
// ([movementStateScanner.recevoir]) : la lecture ne vaut que sur un slot LIE AU BIPEDE dans la table
// d entites de la marche ; un NEW sur un slot neuf, lie apres sa traversee, est ecarte et compte.
func (c *canalDuJeuDArmes) recevoir(slot uint32, j JeuDArmes) {
	if e, ok := c.m.Entites.Entite(slot); !ok || e.TI != BipedTypeIndex {
		c.st.SlotUnbound++
		return
	}
	p := c.m.Paquet
	k := jeuDArmesCle{slot: slot, ts: p.TS}
	if _, deja := c.vues[k]; deja {
		c.st.Duplicates++
		return
	}
	c.vues[k] = types.DrawnWeaponRead{TimestampUS: p.TS, Slot: slot,
		Principal: int8(j.Principal), Second: int8(j.Second)} //nolint:gosec // emplacements -1..3
	c.st.Read++
}
