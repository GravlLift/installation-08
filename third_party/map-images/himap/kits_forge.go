// Package himap — kits_forge.go (LOCAL-CHANGE (infinite-theater-3d)) : les objets qu'un KIT
// Forge (`foki`) pose a la place d'un objet de variante.
//
// Un generateur d'objets (socle d'arme de pouvoir, ratelier d'arme, socle de bonus, de grenade,
// d'equipement) n'a pas de modele a lui : sa definition `food` reference un kit, et le kit nomme
// les objets que le jeu pose a l'emplacement, avec leur pose locale. Sur les cartes classees, le
// socle d'arme de pouvoir est la machine `fca8a400`, le ratelier la machine `600ee7cb` et sa
// plaque de fond (le `scen` `334192be`), le socle de bonus `418ec009`, celui de grenade `f6ff874b`
// et celui d'equipement `58f5b4af` : leurs modeles du jeu, avec leurs materiaux.
//
// GRAMMAIRE (mesuree sur les 27 kits du module Forge, 26 portent la liste) : le champ racine +0x2c
// est un bloc d'un record de definition, dont le champ +0xa4 est la liste des objets du kit, 176
// octets par objet. Un objet porte une reference de tag (GlobalID a +0x0c, groupe a +0x18), sa
// position locale (+0x78), son lacet, son tangage et son roulis (+0x84, meme convention que les
// placements du scenario) et son echelle par axe (+0x90).
//
// QUELS KITS SE POSENT : ceux qui comptent une MACHINE parmi leurs objets. Sur les 27 kits, ce
// sont les cinq generateurs ci-dessus et quatre autres : deux dont la machine `b5683e48` (son
// `mode` `37406072` n'a aucune section : le kit pose les deux `bloc` que la variante de son modele
// attache, objets_attaches.go), la machine `61f03e87` (absente des cartes mesurees) et `153adfbb`, du seul
// mode Infection. Les autres kits ne posent que des decors et des caisses : les mises en scene
// de debut de manche (quatre mannequins `73704db6`, des cameras `07d77f31`/`ec0bd653`), des
// emetteurs de son, la zone de capture `f95a2c76` (sans geometrie), tous dessines aux materiaux
// du shader `8d3568e0` des reperes de l'editeur, sauf les mannequins et une plaque `d137aa6c`.
// Le jeu ne les montre pas en partie ; un kit sans machine ne pose donc rien.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"context"
	"log/slog"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

// GroupeKit : le groupe d'un kit d'objets Forge.
const GroupeKit = "foki"

// GroupeMachine : le groupe des machines, l'objet qui fait d'un kit un dispositif pose.
const GroupeMachine = "mach"

// Grammaire d'un kit (voir l'en-tete).
const (
	kitOffDefinition  = 0x2c
	kitOffObjets      = 0xa4
	kitObjOffRef      = 0x0c
	kitObjOffPosition = 0x78
	kitObjOffRotation = 0x84
	kitObjOffEchelle  = 0x90
	kitObjTailleMin   = kitObjOffEchelle + 12
)

// objetKit est un objet d'un kit : sa reference et sa pose dans le repere de l'objet de variante.
type objetKit struct {
	ref    uint32
	groupe string
	pose   Instance
}

// pieceKit est un objet de kit resolu : son modele et sa pose locale.
type pieceKit struct {
	mv   *modeleVariante
	pose Instance
}

// lisObjetsKit rend les objets d'un tag `foki` dont le groupe est un groupe d'objet pose
// (groupesPlaces), dans l'ordre du kit ; nil quand la grammaire ne s'y lit pas.
func lisObjetsKit(tag []byte) []objetKit {
	ti, err := meilleurTagInfo(tag)
	if err != nil {
		return nil
	}
	root, err := ti.rootBlockIndex()
	if err != nil {
		return nil
	}
	def, ok := blocDuChamp(ti, root, kitOffDefinition)
	if !ok {
		return nil
	}
	l, ok := lienDuChamp(ti, def, kitOffObjets)
	if !ok {
		return nil
	}
	n := compteChamp(ti, l)
	abs, taille := ti.blockAbs(l.target)
	if n <= 0 || taille%n != 0 || taille/n < kitObjTailleMin || abs < 0 || abs+taille > len(tag) {
		return nil
	}
	stride := taille / n
	var out []objetKit
	for i := range n {
		r := tag[abs+i*stride : abs+(i+1)*stride]
		g := groupeInverse(r[kitObjOffRef+refOffGroupe : kitObjOffRef+refOffGroupe+4])
		if !groupesPlaces[g] {
			continue
		}
		out = append(out, objetKit{ref: uint32(u32(r, kitObjOffRef)), groupe: g, pose: poseObjetKit(r)})
	}
	return out
}

// poseObjetKit lit la pose locale d'un record d'objet de kit.
func poseObjetKit(r []byte) Instance {
	p := PlacementScenario{
		Position: [3]float64{f32(r, kitObjOffPosition), f32(r, kitObjOffPosition+4), f32(r, kitObjOffPosition+8)},
		Lacet:    f32(r, kitObjOffRotation),
		Tangage:  f32(r, kitObjOffRotation+4),
		Roulis:   f32(r, kitObjOffRotation+8),
		Echelle:  1,
	}
	in := p.Instance()
	in.Scale = [3]float64{f32(r, kitObjOffEchelle), f32(r, kitObjOffEchelle+4), f32(r, kitObjOffEchelle+8)}
	return in
}

// lienDuChamp rend le lien TagBlock que le bloc `owner` porte a `off`, s'il pointe un bloc.
func lienDuChamp(ti tagInfo, owner, off int) (lienBloc, bool) {
	for _, l := range liensBlocs(ti) {
		if l.owner == owner && l.fieldOff == off && l.target >= 0 {
			return l, true
		}
	}
	return lienBloc{}, false
}

// blocDuChamp rend le bloc d'un record unique que le bloc `owner` porte a `off`.
func blocDuChamp(ti tagInfo, owner, off int) (int, bool) {
	l, ok := lienDuChamp(ti, owner, off)
	if !ok || compteChamp(ti, l) != 1 {
		return 0, false
	}
	return l.target, true
}

// kitAvecMachine dit si le kit compte une machine parmi ses objets (voir l'en-tete).
func kitAvecMachine(objets []objetKit) bool {
	for _, o := range objets {
		if o.groupe == GroupeMachine {
			return true
		}
	}
	return false
}

// kitsDesTypes rend, pour chaque type d'objet dont la definition reference un kit pose, le
// modele que forment les objets du kit. `assets` met les modeles ouverts en commun.
func kitsDesTypes(ctx context.Context, objets []mapvar.Object, idx *ModuleIndex,
	forge *himodule.Module, assets map[uint32]*RuntimeGeoAsset) map[int32]*modeleVariante {
	foods := map[uint32]himodule.File{}
	for _, f := range forge.Files("food") {
		foods[f.GlobalID] = f
	}
	out := map[int32]*modeleVariante{}
	for _, o := range objets {
		f, ok := foods[uint32(o.TypeID)]
		if _, vu := out[o.TypeID]; vu || !ok {
			continue
		}
		out[o.TypeID] = nil
		tag, err := forge.Extract(f)
		if err != nil {
			continue
		}
		if pieces := piecesDuFood(ctx, idx, tag, assets); len(pieces) > 0 {
			out[o.TypeID] = &modeleVariante{pieces: pieces}
		}
	}
	for ty, mv := range out {
		if mv == nil {
			delete(out, ty)
		}
	}
	return out
}

// piecesDuFood rend les objets resolus du premier kit que reference une definition `food`.
func piecesDuFood(ctx context.Context, idx *ModuleIndex, food []byte, assets map[uint32]*RuntimeGeoAsset) []pieceKit {
	kits := refsTypeesDuGroupe(food, idx, GroupeKit)
	if len(kits) == 0 {
		return nil
	}
	tag, err := idx.Extract(kits[0])
	if err != nil {
		slog.DebugContext(ctx, "unreadable Forge kit", "id", kits[0], "err", err)
		return nil
	}
	objets := lisObjetsKit(tag)
	if !kitAvecMachine(objets) {
		return nil
	}
	var out []pieceKit
	for _, o := range objets {
		// LOCAL-CHANGE (infinite-theater-3d, from The Library): an object whose model has no section
		// poses the objects its model variant attaches (objets_attaches.go).
		out = append(out, modelesObjetKit(ctx, idx, o, assets)...)
	}
	return out
}

// modeleObjetKit ouvre le modele d'un objet de kit (`hlmt` -> `rtgo`/`mode`) ; nil s'il manque.
func modeleObjetKit(ctx context.Context, idx *ModuleIndex, o objetKit, assets map[uint32]*RuntimeGeoAsset) *modeleVariante {
	if g, _, ok := idx.Lookup(o.ref); !ok || g != o.groupe {
		return nil
	}
	objet, err := idx.Extract(o.ref)
	if err != nil {
		return nil
	}
	ref, ok := modeleDuHlmt(ctx, idx, objet)
	if !ok {
		return nil
	}
	a, deja := assets[ref.id]
	if !deja {
		a = ouvreAsset(ctx, idx, ref.id, ref.groupe)
		assets[ref.id] = a
	}
	if a == nil {
		return nil
	}
	mv := &modeleVariante{modelePose: lisModelePose(a, ref.groupe, nil), ombre: map[int]bool{}}
	for _, k := range mv.maillages {
		mv.ombre[k] = horsPasseVisible(a, k)
	}
	if ref.groupe == GroupeRtgo {
		mv.sansPalette = true
		mv.origine = origineDuRtgo(a, mv.maillages, unMode(modeDuObjet(ctx, idx, objet, assets, 0)))
	}
	return mv
}

// composeInstance rend la pose monde d'un objet pose a `local` dans le repere de `parent` : le
// point local v va a parent(local(v)). L'echelle des deux poses passe dans la base rendue.
func composeInstance(parent, local Instance) Instance {
	lineaire := func(d [3]float64, s float64) [3]float64 {
		var w [3]float64
		for a := range 3 {
			w[a] = s * (d[0]*parent.Scale[0]*parent.Forward[a] + d[1]*parent.Scale[1]*parent.Left[a] + d[2]*parent.Scale[2]*parent.Up[a])
		}
		return w
	}
	return Instance{
		Scale:    [3]float64{1, 1, 1},
		Position: parent.LocalToWorld(local.Position),
		Forward:  lineaire(local.Forward, local.Scale[0]),
		Left:     lineaire(local.Left, local.Scale[1]),
		Up:       lineaire(local.Up, local.Scale[2]),
		AABBMin:  parent.AABBMin,
		AABBMax:  parent.AABBMax,
	}
}
