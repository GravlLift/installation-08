//go:build gamefiles

package himap

import (
	"context"
	"fmt"
	"path/filepath"
	"slices"
	"testing"
)

// armeFP : une arme du bac a sable arene, son `weap`, son graphe a la premiere personne et son
// modele (mesures sur le jeu installe ; le contenu du jeu ne bouge plus).
type armeFP struct {
	nom                  string
	weap, graphe, modele uint32
}

var armesFPArene = []armeFP{
	{"BR75", 0x2b1824d5, 0x6d609d45, 0xa2777b87}, {"MA40", 0x48c19d2d, 0xdd53cfcf, 0xee0d2074},
	{"Sidekick", 0xf408190f, 0x1f4a7607, 0xacaa14d9}, {"Commando", 0xfd98554c, 0xbf65ad9b, 0xcc12193a},
	{"Bandit", 0x2fb21c87, 0x92e3c85c, 0xfb41fd43}, {"BanditEvo", 0x6acdc44d, 0x92e3c85c, 0xfb41fd43},
	{"S7", 0x0a1992bc, 0x1221db37, 0xb6e71e06}, {"Bulldog", 0xb619d84a, 0x73b1d002, 0x2821752a},
	{"SPNKr", 0x71ab0a2c, 0x09bb42c9, 0xcf38e84b}, {"Needler", 0xb533957e, 0x67849ed4, 0xfc500ce1},
	{"PulseCarbine", 0x30484ea6, 0x6d0bb41b, 0x5796b4f9}, {"PlasmaPistol", 0xc3542946, 0xbb77a396, 0x00a8e557},
	{"Heatwave", 0x2ac9c2ff, 0xdd723ade, 0x2c84569f}, {"ShockRifle", 0x9387a8b9, 0x756062bf, 0xec1363e7},
	{"Stalker", 0xdaf193c7, 0x5ed9e3bc, 0x372d62e4}, {"Mangler", 0x80977ba5, 0x32db3acf, 0x211b32dc},
	{"Skewer", 0x0d20c469, 0x3db0aac0, 0xab85329d}, {"Cindershot", 0x230447b1, 0x0d37d887, 0x2f10d72d},
	{"Ravager", 0xc30d87c7, 0xb56d8d42, 0xbcc9d7d5}, {"SentinelBeam", 0xa0955e9e, 0x42c890e7, 0x17423cb7},
	{"Disruptor", 0x84bd29ed, 0x49489741, 0x3f860d9b}, {"EnergySword", 0x4ff3937e, 0xeda1ecbe, 0x2d9ac2a9},
	{"GravityHammer", 0x841ac5e5, 0x8d3a2954, 0x8d8b4288}, {"Hydra", 0x767db96d, 0xf7f84d62, 0xd355571d},
}

// noeudRacineArme : le premier noeud du `mode` de chaque arme, enfant de `b_r_hand` dans le graphe FP.
const noeudRacineArme uint32 = 0x1a2b72c5

// ouvreArsenalRecharge ouvre l'arsenal de la carte Recharge, saute le test sans jeu installe.
func ouvreArsenalRecharge(t *testing.T) *Arsenal {
	t.Helper()
	racine, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	levels, err := LevelsDir("pc")
	if err != nil {
		t.Skip(err)
	}
	a, err := OuvreArsenal(racine, filepath.Join(levels, "sgh_blueprint", "sgh_blueprint-rtx-new.module"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = a.Close() })
	return a
}

// TestSourcesBrasPremierePersonne : les globales joueur portent le modele des bras, son maillage de
// 80 noeuds et 14 regions et son graphe des bras seuls.
func TestSourcesBrasPremierePersonne(t *testing.T) {
	a := ouvreArsenalRecharge(t)
	s, err := a.SourcesBras()
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("bras : glpa %08x -> hlmt %08x -> mode %08x, jmad %08x", s.Globales, s.Modele, s.Mode, s.Graphe)
	if s != (SourcesBras{Globales: 0x003c79d2, Modele: 0x0000001f, Mode: 0x00003a73, Graphe: 0x2e8b077f}) {
		t.Errorf("sources des bras %+v", s)
	}
	raw, err := a.geo.Extract(s.Mode)
	if err != nil {
		t.Fatal(err)
	}
	c, err := LitComptesMode(raw)
	if err != nil {
		t.Fatal(err)
	}
	if c.Noeuds != 80 || c.Regions != 14 {
		t.Errorf("mode des bras %+v : attendu 80 noeuds, 14 regions", c)
	}
	// Les regions des bras sont des regions du Spartan a la troisieme personne (memes StringID).
	regsFP, _ := ModeRegions(raw)
	tp, _ := a.geo.Extract(ModeSpartan)
	regs3P, _ := ModeRegions(tp)
	for _, r := range regsFP {
		if !slices.ContainsFunc(regs3P, func(x Region) bool { return x.Name == r.Name }) {
			t.Errorf("region des bras %08x absente du Spartan", r.Name)
		}
	}
}

// TestArmesPremierePersonne : chaque arme de l'arene porte son bloc « first person » ; son modele
// est celui de sa vue a la troisieme personne ; son graphe porte les os des bras et les noeuds de
// l'arme (racine sous `b_r_hand`), et toutes ses animations se decodent.
func TestArmesPremierePersonne(t *testing.T) {
	ctx := context.Background()
	a := ouvreArsenalRecharge(t)
	bras, err := a.SourcesBras()
	if err != nil {
		t.Fatal(err)
	}
	brasRaw, _ := a.geo.Extract(bras.Mode)
	osBras, _ := ModeNodes(brasRaw)
	total, decodees := 0, 0
	for _, w := range armesFPArene {
		s, err := a.SourcesArme(w.weap)
		if err != nil {
			t.Errorf("%s : %v", w.nom, err)
			continue
		}
		if s.Graphe != w.graphe || s.Mode != w.modele {
			t.Errorf("%s : mode %08x graphe %08x, attendu %08x %08x", w.nom, s.Mode, s.Graphe, w.modele, w.graphe)
		}
		if id, _, ok := RefModeleVehicule(ctx, a.geo, mustExtract(t, a, w.weap)); !ok || id != s.Mode {
			t.Errorf("%s : modele 3P %08x (%v) different du modele FP %08x", w.nom, id, ok, s.Mode)
		}
		gs, err := a.GraphesDepuis(ctx, s.Graphe)
		if err != nil {
			t.Errorf("%s : %v", w.nom, err)
			continue
		}
		g := gs.Propre
		b := g.Bilan()
		total += len(g.Animations)
		decodees += b.Decodees
		if b.Decodees != len(g.Animations) {
			t.Errorf("%s : %d animations decodees sur %d (refus %v, illisibles %v)", w.nom, b.Decodees, len(g.Animations), b.NonDecodees, b.Illisibles)
		}
		verifieOsDuGraphe(t, w.nom, g, osBras, modeNoeuds(t, a, s.Mode))
		t.Logf("%-13s weap %08x @%d mode %08x jmad %08x : %d os, %d animations, %d parents", w.nom, w.weap, s.Offset, s.Mode, s.Graphe,
			len(g.Os), len(g.Animations), len(g.Parents))
	}
	t.Logf("total : %d animations, %d decodees", total, decodees)
	toutes, sans := a.ArmesPremierePersonne()
	t.Logf("index : %d weap avec bloc first person, %d sans", len(toutes), sans)
	for _, w := range armesFPArene {
		if !slices.ContainsFunc(toutes, func(s SourcesArme) bool { return s.Arme == w.weap }) {
			t.Errorf("%s absente de l'enumeration", w.nom)
		}
	}
}

// verifieOsDuGraphe : les os des bras et les noeuds de l'arme sont tous dans le graphe, la racine de
// l'arme sous `b_r_hand`.
func verifieOsDuGraphe(t *testing.T, nom string, g *GrapheAnimation, bras, arme []Noeud) {
	t.Helper()
	parNom := map[uint32]int{}
	for i, o := range g.Os {
		parNom[o.Nom] = i
	}
	manquants := 0
	for _, n := range append(append([]Noeud{}, bras...), arme...) {
		if _, ok := parNom[n.Name]; !ok {
			manquants++
		}
	}
	if manquants > 0 {
		t.Errorf("%s : %d os des bras ou de l'arme absents du graphe", nom, manquants)
	}
	r, ok := parNom[noeudRacineArme]
	if !ok || len(arme) == 0 || arme[0].Name != noeudRacineArme {
		t.Errorf("%s : racine de l'arme %08x absente ou pas premiere", nom, noeudRacineArme)
		return
	}
	if p := g.Os[r].Parent; p < 0 || g.Os[p].Nom != NomAnimation("b_r_hand") {
		t.Errorf("%s : racine de l'arme sous l'os %d, pas b_r_hand", nom, p)
	}
}

func mustExtract(t *testing.T, a *Arsenal, id uint32) []byte {
	t.Helper()
	raw, err := a.geo.Extract(id)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func modeNoeuds(t *testing.T, a *Arsenal, mode uint32) []Noeud {
	t.Helper()
	n, err := ModeNodes(mustExtract(t, a, mode))
	if err != nil {
		t.Fatal(err)
	}
	return n
}

// TestActionsPremierePersonne : l'arbre des modes fait foi pour une action ; ses variantes suivent
// la chaine « animation suivante » ; une surcouche se trouve par son nom.
func TestActionsPremierePersonne(t *testing.T) {
	ctx := context.Background()
	a := ouvreArsenalRecharge(t)
	graphe := func(nom string) *GraphesAnimation {
		for _, w := range armesFPArene {
			if w.nom == nom {
				gs, err := a.GraphesDepuis(ctx, w.graphe)
				if err != nil {
					t.Fatal(err)
				}
				return gs
			}
		}
		t.Fatalf("arme %s", nom)
		return nil
	}
	br := graphe("BR75")
	cas := []struct {
		gs     *GraphesAnimation
		action string
		parNom bool
		rangs  []int
		source string
	}{
		// fire_1 designe l'animation 21, dont le nom n'est pas first_person:fire_1, et sa variante 22.
		{br, "fire_1", false, []int{21, 22}, SourceArbre},
		{br, "reload_empty", false, []int{49}, SourceArbre},
		{br, "moving", true, []int{40, 41, 42}, SourceNom},
		{br, "moving", false, nil, ""},
		{br, "melee_lunge", true, nil, ""},
		// Hydra : rechargement plein, vide et continuation designent la meme animation.
		{graphe("Hydra"), "reload_full", false, []int{62}, SourceArbre},
		{graphe("Hydra"), "reload_continue_empty", false, []int{62}, SourceArbre},
	}
	for _, c := range cas {
		clips, err := c.gs.ClipsDeLAction(c.action, c.parNom)
		if err != nil {
			t.Errorf("%s : %v", c.action, err)
			continue
		}
		var rangs []int
		for i, x := range clips {
			rangs = append(rangs, x.Rang)
			if x.Variante != i || x.Source != c.source {
				t.Errorf("%s : clip %d variante %d source %q", c.action, i, x.Variante, x.Source)
			}
		}
		if fmt.Sprint(rangs) != fmt.Sprint(c.rangs) {
			t.Errorf("%s (par nom %v) : rangs %v, attendu %v", c.action, c.parNom, rangs, c.rangs)
		}
	}
}
