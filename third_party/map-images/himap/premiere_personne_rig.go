// Package himap — premiere_personne_rig.go : le rig a la premiere personne d'une arme, bras du
// Spartan et arme sur UN squelette, celui du graphe FP de l'arme, avec ses animations.
//
// SQUELETTE : les os du graphe FP, dans son ordre (les pistes de ses animations), chacun avec la pose
// de repos et la matrice inverse de liaison du noeud du meme nom, pris au `mode` des bras puis a
// celui de l'arme ; un os qu'aucun ne porte (os d'appoint du graphe) reste a l'identite, aucun
// sommet ne s'y lie. Le parent est celui du graphe : la racine de l'arme est enfant de `b_r_hand`.
// Chaque maillage garde ses sommets dans le repere de son `mode` : la matrice inverse de liaison de
// son propre `mode` les ramene a l'os, le graphe les place. La pose de repos du rig n'a donc pas de
// sens visuel (l'arme y tient a la main droite de repos) : seule une animation pose l'ensemble.
//
// REPERE : celui du graphe, axes Halo, unites du jeu ; racine `b_pedestal` a l'origine, l'arme
// pointee vers +X en attente.
package himap

import (
	"context"
	"fmt"
	"log/slog"
)

// ActionPremierePersonne : une action dont le rig cuit les animations.
type ActionPremierePersonne struct {
	Nom string
	// Surcouche : l'action se cherche aussi par son nom (ClipsDeLAction), l'arbre ne portant pas les
	// surcouches ni certaines actions d'une fois (le propulseur, le grappin).
	Surcouche bool
	// Jeu : le niveau « jeu » du chemin de l'action (ClipsDeLActionDuJeu), vide pour `any`. L'usage
	// d'un equipement est l'action `equipment_activate` sous le jeu de cet equipement ; son clip
	// s'appelle `<jeu>:<action>` (NomActionDuJeu).
	Jeu string
}

// Jeux d'equipement de l'arbre FP (StringID nommes par murmur3 sur le graphe de chaque arme, 79
// graphes sur 79) : le repulseur (`ability_knockback`), le capteur de menace
// (`ability_location_sensor`), le camouflage actif et le translocateur (`quantum`). Un cinquieme
// (#6132b1e2) reste sans nom.
const (
	ActionUsageEquipement = "equipment_activate"
	JeuRepulseur          = "knockback"
	JeuCapteurMenace      = "location"
	JeuCamo               = "camo"
	JeuTranslocateur      = "quantum"
)

// NomActionDuJeu rend le nom d'action d'un rig pour l'action `action` du jeu `jeu` : l'action seule
// sans jeu, `<jeu>:<action>` sinon (l'ordre du chemin du jeu, jeu avant action).
func NomActionDuJeu(jeu, action string) string {
	if jeu == "" {
		return action
	}
	return jeu + ":" + action
}

// JeuMurDeploye (LOCAL-CHANGE) is the FP tree's fifth equipment set, whose text no dictionary has
// found (1.9 million two-word candidates tried), so it is named by its StringID form. The game picks
// an equipment's set from the item `eqip` its ability (`sofa`) references: field root +0x904, word
// +0x338 of that block. Read on the family A palette (sofd d91958af), that word is this set for the
// drop wall (rank 2, eqip c12e5469; rank 19, 37c87a13) and the repair field (rank 23, 5c8e2316).
// The same word names `location` for the threat sensor, shroud screen and threat seeker, `camo`
// for active camo and overshield, `knockback` and `quantum` for the repulsor and translocator
// (TestJeuxPremierePersonneDesEquipements).
const JeuMurDeploye = "#6132b1e2"

// ActionsPremierePersonne : les actions cuites dans chaque rig, quand le graphe de l'arme les porte.
var ActionsPremierePersonne = []ActionPremierePersonne{
	{Nom: "idle"}, {Nom: "fire_1"}, {Nom: "fire_2"}, {Nom: "overcharged"},
	{Nom: "reload_full"}, {Nom: "reload_empty"}, {Nom: "reload_enter"}, {Nom: "reload_continue_full"},
	{Nom: "reload_continue_empty"}, {Nom: "reload_exit"}, {Nom: "chamber_1"}, {Nom: "chamber_empty"}, {Nom: "chamber_full"},
	{Nom: "ready"}, {Nom: "put_away"}, {Nom: "melee_strike_1"}, {Nom: "melee_strike_2"}, {Nom: "melee_lunge"},
	{Nom: "throw_grenade"}, {Nom: "sprint_enter"}, {Nom: "sprint_enter_slow"}, {Nom: "sprint_loop"},
	{Nom: "sprint_loop_airborne"}, {Nom: "sprint_exit"}, {Nom: "sprint_exit_left"}, {Nom: "sprint_exit_right"},
	{Nom: "slide_enter"}, {Nom: "slide_loop"}, {Nom: "slide_exit"}, {Nom: "clamber"},
	{Nom: "overheated"}, {Nom: "vent_enter"}, {Nom: "vent_loop"}, {Nom: "vent_exit"},
	{Nom: "moving", Surcouche: true}, {Nom: "jump", Surcouche: true}, {Nom: "fall", Surcouche: true},
	{Nom: "land_soft", Surcouche: true}, {Nom: "land_hard", Surcouche: true}, {Nom: "crouch", Surcouche: true},
	// Le propulseur (une direction par clip) et le tir du grappin.
	{Nom: "evade_front", Surcouche: true}, {Nom: "evade_back", Surcouche: true}, {Nom: "evade_left", Surcouche: true},
	{Nom: "evade_right", Surcouche: true}, {Nom: "grapple_hook_deploy", Surcouche: true},
	// L'usage des equipements portes.
	{Nom: ActionUsageEquipement, Jeu: JeuMurDeploye},
	{Nom: ActionUsageEquipement, Jeu: JeuRepulseur}, {Nom: ActionUsageEquipement, Jeu: JeuCapteurMenace},
	{Nom: ActionUsageEquipement, Jeu: JeuCamo}, {Nom: ActionUsageEquipement, Jeu: JeuTranslocateur},
}

// RigPremierePersonne : le rig d'une arme.
type RigPremierePersonne struct {
	Modele *ModeleAPeau
	Arme   SourcesArme
	Bras   SourcesBras
	// Clips : une animation glTF par animation distincte du graphe ; Actions : chaque action et
	// variante trouvee, et le nom du clip qui la porte (deux actions peuvent designer la meme
	// animation : Hydra, rechargements plein, vide et continuation).
	Clips   []ClipGLB
	Actions []ActionRig
	// Absentes : les actions de ActionsPremierePersonne que le graphe ne porte pas.
	Absentes []string
	// OsSansPose : les os du graphe qu'aucun `mode` ne porte.
	OsSansPose []string
	// SommetsBras : les premiers sommets de Modele.Maillage.Structure sont ceux des bras, la suite
	// ceux de l'arme.
	SommetsBras int
	// RacineArme : l'os de la racine de l'arme (premier noeud de son `mode`).
	RacineArme int
}

// ActionRig : une action et une variante, et l'animation glTF qui la joue.
type ActionRig struct {
	Action   string
	Variante int
	Source   string
	Clip     string
}

// NomClipPremierePersonne rend le nom glTF de la variante `v` d'une action : l'action seule pour la
// premiere, `<action>:var<v>` pour les suivantes.
func NomClipPremierePersonne(action string, v int) string {
	if v == 0 {
		return action
	}
	return fmt.Sprintf("%s:var%d", action, v)
}

// RigPremierePersonne lit le rig de l'arme `weap`. `armure` choisit la permutation de chaque region
// des bras (memes StringID de region et de permutation que le Spartan a la troisieme personne) ; nil :
// l'armure par defaut du Spartan. ErrSansPremierePersonne quand l'arme n'a pas de vue FP.
func (a *Arsenal) RigPremierePersonne(ctx context.Context, weap uint32, armure VarianteModele) (*RigPremierePersonne, error) {
	return a.rigPremierePersonne(ctx, weap, armure, false)
}

// RigPremierePersonneSansBras conserve le squelette et les clips sans la geometrie des bras.
func (a *Arsenal) RigPremierePersonneSansBras(ctx context.Context, weap uint32) (*RigPremierePersonne, error) {
	return a.rigPremierePersonne(ctx, weap, nil, true)
}

func (a *Arsenal) rigPremierePersonne(ctx context.Context, weap uint32, armure VarianteModele, sansBras bool) (*RigPremierePersonne, error) {
	src, err := a.SourcesArme(weap)
	if err != nil {
		return nil, err
	}
	bras, err := a.SourcesBras()
	if err != nil {
		return nil, err
	}
	if armure == nil && !sansBras {
		def, err := armureParDefaut(ctx, a.geo, ModeSpartan)
		if err != nil {
			return nil, fmt.Errorf("%w : armure par defaut : %w", ErrSansPremierePersonne, err)
		}
		armure = def.Variante
	}
	gs, err := a.GraphesDepuis(ctx, src.Graphe)
	if err != nil {
		return nil, fmt.Errorf("%w : %08x : %w", ErrSansPremierePersonne, weap, err)
	}
	r := &RigPremierePersonne{Arme: src, Bras: bras}
	if err := r.assemble(ctx, a, gs.Propre, armure, sansBras); err != nil {
		return nil, fmt.Errorf("%w : %08x : %w", ErrSansPremierePersonne, weap, err)
	}
	if err := r.litClips(gs); err != nil {
		return nil, fmt.Errorf("%w : %08x : %w", ErrSansPremierePersonne, weap, err)
	}
	slog.InfoContext(ctx, "rig a la premiere personne lu", "arme", fmt.Sprintf("%08x", weap), "os", len(r.Modele.Noeuds),
		"osSansPose", len(r.OsSansPose), "triangles", r.Modele.Maillage.Structure.Triangles(), "clips", len(r.Clips),
		"actions", len(r.Actions), "absentes", len(r.Absentes))
	return r, nil
}

// assemble pose le squelette du graphe, verse les bras puis l'arme, et lit leurs materiaux.
func (r *RigPremierePersonne) assemble(ctx context.Context, a *Arsenal, g *GrapheAnimation, armure VarianteModele, sansBras bool) error {
	brasTag, brasBlob, err := a.geo.ExtractWithResources(r.Bras.Mode)
	if err != nil {
		return fmt.Errorf("bras %08x : %w", r.Bras.Mode, err)
	}
	brasAsset, err := NewRenderModelAsset(brasTag, brasBlob)
	if err != nil {
		return fmt.Errorf("bras %08x : %w", r.Bras.Mode, err)
	}
	osBras, err := ModeNodes(brasTag)
	if err != nil {
		return fmt.Errorf("squelette des bras : %w", err)
	}
	arme, err := modeleDeLArme(ctx, a, r.Arme)
	if err != nil {
		return err
	}
	osArme, err := ModeNodes(arme.asset.info.tag)
	if err != nil || len(osArme) == 0 {
		return fmt.Errorf("squelette de l'arme (%d noeuds) : %w", len(osArme), err)
	}
	m := &ModeleAPeau{Maillage: &MaillageMonde{SurfacesBrutesDe: map[uint32]bool{}}}
	m.Noeuds, m.Noms, r.OsSansPose = squeletteDuGraphe(g, osBras, osArme)
	r.Modele, r.RacineArme = m, NoeudParNom(m.Noeuds, osArme[0].Name)
	if !sansBras {
		selBras := lisModelePose(brasAsset, GroupeMode, armure)
		if err := m.versePieces(ctx, brasAsset, &selBras, osBras); err != nil {
			return fmt.Errorf("bras : %w", err)
		}
		r.SommetsBras = len(m.Maillage.Structure.Sommets) / 3
		for _, id := range selBras.materiaux {
			m.Maillage.SurfacesBrutesDe[id] = true
		}
	}
	if err := m.versePieces(ctx, arme.asset, arme, osArme); err != nil {
		return fmt.Errorf("arme : %w", err)
	}
	if m.Maillage.Structure.Triangles() == 0 {
		return fmt.Errorf("aucun triangle visible")
	}
	m.Maillage.lisMateriaux(a.mats, a.geo)
	m.Maillage.resoutTextures(ctx, a.geo)
	return nil
}

// modeleDeLArme rend le modele que l'arme dessine : celui de sa vue a la troisieme personne dans sa
// variante « default » quand c'est le `mode` du bloc « first person », ce `mode` dans son modele par
// defaut sinon.
func modeleDeLArme(ctx context.Context, a *Arsenal, src SourcesArme) (*modelePose, error) {
	raw, err := a.geo.Extract(src.Arme)
	if err != nil {
		return nil, fmt.Errorf("arme : %w", err)
	}
	if id, _, ok := RefModeleVehicule(ctx, a.geo, raw); ok && id == src.Mode {
		if mp := modeleDuPlacement(ctx, a.geo, src.Arme, varianteDefaut); mp != nil {
			return mp, nil
		}
	}
	asset := ouvreAsset(ctx, a.geo, src.Mode, GroupeMode)
	if asset == nil {
		return nil, fmt.Errorf("modele %08x de l'arme illisible", src.Mode)
	}
	slog.InfoContext(ctx, "rig a la premiere personne : modele FP distinct du modele 3P", "arme", fmt.Sprintf("%08x", src.Arme),
		"mode", fmt.Sprintf("%08x", src.Mode))
	mp := lisModelePose(asset, GroupeMode, nil)
	return &mp, nil
}

// squeletteDuGraphe rend les os du graphe en noeuds (pose de repos et liaison des bras, puis de
// l'arme, par nom ; parent du graphe), leurs noms et les noms des os qu'aucun `mode` ne porte.
func squeletteDuGraphe(g *GrapheAnimation, bras, arme []Noeud) ([]Noeud, []string, []string) {
	noeuds := make([]Noeud, len(g.Os))
	noms := make([]string, len(g.Os))
	var sansPose []string
	for i, o := range g.Os {
		n := Noeud{Name: o.Nom, Quat: [4]float64{0, 0, 0, 1}, Scale: 1, InvAxes: [3][3]float64{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}}
		if j := NoeudParNom(bras, o.Nom); j >= 0 {
			n = bras[j]
		} else if j := NoeudParNom(arme, o.Nom); j >= 0 {
			n = arme[j]
		} else {
			sansPose = append(sansPose, NomDuNoeud(o.Nom))
		}
		n.Parent = o.Parent
		noeuds[i], noms[i] = n, NomDuNoeud(o.Nom)
	}
	return noeuds, noms, sansPose
}

// versePieces ajoute les sections de `sel` que le jeu dessine a l'ecran, leurs influences
// renumerotees des noeuds `source` de leur `mode` vers les os du squelette (par nom). Un noeud
// source absent du squelette, ou une section illisible, est une erreur : le rig serait faux.
func (m *ModeleAPeau) versePieces(ctx context.Context, asset *RuntimeGeoAsset, sel *modelePose, source []Noeud) error {
	vers := make([]uint16, len(source))
	for i, n := range source {
		j := NoeudParNom(m.Noeuds, n.Name)
		if j < 0 {
			return fmt.Errorf("noeud %s absent du graphe", NomDuNoeud(n.Name))
		}
		vers[i] = uint16(j)
	}
	in := PlacementScenario{Echelle: 1}.Instance()
	in.Materiaux = sel.materiaux
	for _, k := range sel.maillages {
		if horsPasseVisible(asset, k) {
			m.SectionsOmbre++
			continue
		}
		mesh := asset.Mesh(k)
		inf, err := asset.PeauDeSection(k, len(source))
		if err == nil && (mesh == nil || len(inf) != len(mesh.Vertices)) {
			err = fmt.Errorf("%w : section %d, maillage illisible ou de taille differente", ErrPeauIllisible, k)
		}
		if err != nil {
			return err
		}
		for v := range inf {
			for c := 0; c < OsParSommet; c++ {
				if int(inf[v].Os[c]) >= len(vers) {
					return fmt.Errorf("%w : section %d, os %d hors des %d noeuds", ErrPeauIllisible, k, inf[v].Os[c], len(vers))
				}
				inf[v].Os[c] = vers[inf[v].Os[c]]
			}
		}
		debut := len(m.Maillage.Structure.Sommets) / 3
		m.Maillage.Structure.ajoute(mesh, in, 0)
		m.Plages = append(m.Plages, PlageSection{Section: k, Debut: debut, Fin: len(m.Maillage.Structure.Sommets) / 3})
		m.Influences = append(m.Influences, inf...)
		m.SectionsDessinees++
	}
	slog.DebugContext(ctx, "pieces versees au rig", "sections", len(sel.maillages), "dessinees", m.SectionsDessinees)
	return nil
}

// litClips trouve et decode les animations de chaque action ; une animation designee par deux
// actions n'est ecrite qu'une fois, sous le nom de la premiere. Une animation d'un graphe herite a
// ses pistes dans l'ordre des os de ce graphe : elles sont reportees sur le squelette du rig par nom.
func (r *RigPremierePersonne) litClips(gs *GraphesAnimation) error {
	parAnimation := map[[2]uint32]string{}
	for _, ac := range ActionsPremierePersonne {
		clips, chemin, err := clipsDeLActionRig(gs, ac)
		if err != nil {
			return err
		}
		if len(clips) == 0 {
			r.Absentes = append(r.Absentes, NomActionDuJeu(ac.Jeu, ac.Nom))
			continue
		}
		for _, c := range clips {
			cle := [2]uint32{c.Graphe.ID, uint32(c.Rang)}
			nom, deja := parAnimation[cle]
			if !deja {
				nom = NomClipPremierePersonne(c.Action, c.Variante)
				decode, err := c.Graphe.Decode(c.Rang)
				if err != nil {
					return fmt.Errorf("action %s variante %d : %w", c.Action, c.Variante, err)
				}
				if c.Graphe != gs.Propre {
					decode = pistesSurSquelette(decode, c.Graphe.Os, gs.Propre.Os)
				}
				r.Clips = append(r.Clips, ClipGLB{Nom: nom, Clip: decode, Chemin: chemin,
					Cadence: CadenceAnimation(decode.Animation),
					Extras:  map[string]any{"action": c.Action, "variant": c.Variante, "source": c.Source}})
				parAnimation[cle] = nom
			}
			r.Actions = append(r.Actions, ActionRig{Action: c.Action, Variante: c.Variante, Source: c.Source, Clip: nom})
		}
	}
	return nil
}

// clipsDeLActionRig rend les animations d'une action du rig et le nom du jeu qui les designe
// (recopie dans les extras du clip) : par l'arbre et le nom pour une action sans jeu, par le chemin
// du jeu sinon.
func clipsDeLActionRig(gs *GraphesAnimation, ac ActionPremierePersonne) ([]ClipAction, string, error) {
	if ac.Jeu == "" {
		clips, err := gs.ClipsDeLAction(ac.Nom, ac.Surcouche)
		return clips, PrefixeNomPremierePersonne + ac.Nom, err
	}
	clips, err := gs.ClipsDeLActionDuJeu(ac.Jeu, ac.Nom)
	return clips, NomDuJeuPremierePersonne(ac.Jeu, ac.Nom), err
}

// pistesSurSquelette rend le clip `c`, decode sur les os `de` d'un graphe herite, avec une piste par
// os de `vers` (le squelette du rig), associees par nom : un os du rig que le graphe herite ne porte
// pas garde sa pose de repos (piste vide), une piste d'un os absent du rig est ignoree.
func pistesSurSquelette(c *ClipAnimation, de, vers []OsGraphe) *ClipAnimation {
	rang := make(map[uint32]int, len(de))
	for i, o := range de {
		rang[o.Nom] = i
	}
	out := *c
	out.Os = make([]PisteOs, len(vers))
	for i, o := range vers {
		if j, ok := rang[o.Nom]; ok && j < len(c.Os) {
			out.Os[i] = c.Os[j]
		}
	}
	return &out
}

// PoseRig rend la transformee modele de chaque os a l'image `k` du clip `c` (une piste statique vaut
// pour toutes les images ; un os sans piste garde sa pose de repos).
func (m *ModeleAPeau) PoseRig(c *ClipAnimation, k int) []Transforme {
	loc := make([]Noeud, len(m.Noeuds))
	for i, n := range m.Noeuds {
		if i < len(c.Os) {
			p := c.Os[i]
			if len(p.Rotations) > 0 {
				n.Quat = p.Rotations[min(k, len(p.Rotations)-1)]
			}
			if len(p.Translations) > 0 {
				n.Pos = p.Translations[min(k, len(p.Translations)-1)]
			}
			if len(p.Echelles) > 0 {
				n.Scale = p.Echelles[min(k, len(p.Echelles)-1)]
			}
		}
		loc[i] = n
	}
	out := make([]Transforme, len(loc))
	for i := range loc {
		out[i] = NodeModelTransform(loc, i)
	}
	return out
}

// ArmeEnAttente rend, a la premiere image du clip `idle`, la position de la racine de l'arme et son
// axe avant (+X du `mode` de l'arme, le canon) dans le repere du rig ; faux sans clip `idle`.
func (r *RigPremierePersonne) ArmeEnAttente() (pos, avant [3]float64, ok bool) {
	for _, c := range r.Clips {
		if c.Nom != "idle" {
			continue
		}
		t := r.Modele.PoseRig(c.Clip, 0)[r.RacineArme]
		return t.Trans, [3]float64{t.Rot[0], t.Rot[3], t.Rot[6]}, true
	}
	return pos, avant, false
}
