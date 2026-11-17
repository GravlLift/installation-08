// Package himap — animations_spartan.go : les graphes d'animation d'un modele, lus depuis son
// `hlmt`, avec ceux dont ils heritent.
//
// Le `hlmt` du Spartan (celui de l'armure par defaut, armure_defaut.go) reference son graphe
// propre ; celui-ci herite d'un graphe racine qui porte la plupart des animations : l'arbre des
// modes du graphe propre designe ses animations par (graphe herite, rang). Les deux vivent dans
// `pc/globals`, que l'index d'une carte installee couvre.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"context"
	"fmt"
	"log/slog"
)

// profondeurMaxHeritage : au-dela, une chaine d'heritage est tenue pour une boucle.
const profondeurMaxHeritage = 8

// GraphesAnimation : un graphe d'animation et tous ceux dont il herite, par GlobalID.
type GraphesAnimation struct {
	// Propre : le graphe du modele.
	Propre *GrapheAnimation
	parID  map[uint32]*GrapheAnimation
}

// Graphe rend le graphe de GlobalID `id` de la chaine, nil hors chaine.
func (gs *GraphesAnimation) Graphe(id uint32) *GrapheAnimation { return gs.parID[id] }

// Tous rend les graphes de la chaine, le propre d'abord puis ses parents dans l'ordre de lecture.
func (gs *GraphesAnimation) Tous() []*GrapheAnimation {
	out := []*GrapheAnimation{gs.Propre}
	vus := map[uint32]bool{gs.Propre.ID: true}
	for i := 0; i < len(out); i++ {
		for _, p := range out[i].Parents {
			if g := gs.parID[p]; g != nil && !vus[p] {
				vus[p] = true
				out = append(out, g)
			}
		}
	}
	return out
}

// Resout rend le graphe et le rang de l'animation qu'une entree du graphe `depuis` designe.
func (gs *GraphesAnimation) Resout(depuis *GrapheAnimation, e EntreeMode) (*GrapheAnimation, int, error) {
	g := depuis
	if e.Graphe != grapheLocal {
		if e.Graphe < 0 || e.Graphe >= len(depuis.Parents) {
			return nil, 0, fmt.Errorf("entry %s: inherited graph %d of %d", e.Chemin(), e.Graphe, len(depuis.Parents))
		}
		if g = gs.parID[depuis.Parents[e.Graphe]]; g == nil {
			return nil, 0, fmt.Errorf("entry %s: graph %08x not read", e.Chemin(), depuis.Parents[e.Graphe])
		}
	}
	if e.Animation < 0 || e.Animation >= len(g.Animations) {
		return nil, 0, fmt.Errorf("entry %s: animation %d of %d of graph %08x", e.Chemin(), e.Animation, len(g.Animations), g.ID)
	}
	return g, e.Animation, nil
}

// GraphesDuSpartan lit les graphes d'animation du Spartan (ModeSpartan, armure par defaut).
func (a *Arsenal) GraphesDuSpartan(ctx context.Context) (*GraphesAnimation, error) {
	armure, err := armureParDefaut(ctx, a.geo, ModeSpartan)
	if err != nil {
		return nil, fmt.Errorf("%w: Spartan's default armor: %w", ErrGrapheIllisible, err)
	}
	return a.GraphesDuModele(ctx, armure.Modele)
}

// GraphesDuModele lit le graphe d'animation que le `hlmt` reference, et ceux dont il herite.
func (a *Arsenal) GraphesDuModele(ctx context.Context, hlmt uint32) (*GraphesAnimation, error) {
	tag, err := a.geo.Extract(hlmt)
	if err != nil {
		return nil, fmt.Errorf("%w : hlmt %08x : %w", ErrGrapheIllisible, hlmt, err)
	}
	refs := refsInlineDuGroupe(tag, a.geo, GroupeGrapheAnimation)
	if len(refs) != 1 {
		return nil, fmt.Errorf("%w: hlmt %08x references %d graphs (%08x): exactly one expected", ErrGrapheIllisible, hlmt, len(refs), refs)
	}
	return a.GraphesDepuis(ctx, refs[0])
}

// litChaine lit le graphe `id` et, recursivement, ses parents.
func (a *Arsenal) litChaine(ctx context.Context, gs *GraphesAnimation, id uint32, prof int) (*GrapheAnimation, error) {
	if g := gs.parID[id]; g != nil {
		return g, nil
	}
	if prof > profondeurMaxHeritage {
		return nil, fmt.Errorf("%w: inheritance of more than %d graphs from %08x", ErrGrapheIllisible, profondeurMaxHeritage, id)
	}
	if grp, _, ok := a.geo.Lookup(id); !ok || grp != GroupeGrapheAnimation {
		return nil, fmt.Errorf("%w: %08x is not a %q tag of the modules", ErrGrapheIllisible, id, GroupeGrapheAnimation)
	}
	tag, err := a.geo.Extract(id)
	if err != nil {
		return nil, fmt.Errorf("%w : %08x : %w", ErrGrapheIllisible, id, err)
	}
	g, err := LitGrapheAnimation(id, tag)
	if err != nil {
		return nil, err
	}
	gs.parID[id] = g
	slog.InfoContext(ctx, "animation graph read", "id", fmt.Sprintf("%08x", id), "os", len(g.Os),
		"animations", len(g.Animations), "entrees", len(g.Entrees), "parents", len(g.Parents))
	for _, p := range g.Parents {
		if _, err := a.litChaine(ctx, gs, p, prof+1); err != nil {
			return nil, err
		}
	}
	return g, nil
}
