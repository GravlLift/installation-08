// Package himap — marqueurs.go : les MARQUEURS d'un render_model `mode`, ou le jeu pose ce qu'il
// attache au modele (les accessoires d'armure du Spartan : accessoires_armure.go).
//
// Grammaire, lue sur le Spartan (mode 3DB5318C, 127 groupes ; disposition confirmee par la
// recherche du lot 8 contre l'export d'Ekur, qui lit les memes champs) :
//
//	root +104  : groupes, 24 o = { nom StringID +0, instances TagBlock +4 (compte a +20) }
//	instance   : 56 o = { region int8 +0, permutation int32 +4, noeud u8 +8,
//	             translation 3 x f32 +12, rotation quaternion (x, y, z, w) 4 x f32 +24,
//	             f32 +40 et direction 3 x f32 +44 (non lus) }
//
// Une instance se pose dans le repere de son noeud : modele = noeud x T(translation) x R(rotation).
// Region et permutation sont des RANGS dans les blocs du `mode` (ModeRegions), -1 pour « toutes » :
// une instance liee a une piece ne vaut que quand cette piece est portee (une epauliere se pose ou
// l'epaule choisie la met). Un noeud hors du squelette (255) est une instance sans noeud.
package himap

import (
	"errors"
	"fmt"
)

// Grammaire des marqueurs d'un `mode`.
const (
	groupeMarqueursStride  = 24
	groupeMarqueursOffInst = 4
	instanceMarqueurStride = 56
	instMarqOffRegion      = 0
	instMarqOffPerm        = 4
	instMarqOffNoeud       = 8
	instMarqOffTranslation = 12
	instMarqOffRotation    = 24
	// SansNoeud : le rang de noeud d'une instance qui n'en a pas.
	SansNoeud = 255
)

// ErrMarqueursIllisibles : le bloc des marqueurs du `mode` manque ou a une forme inattendue.
var ErrMarqueursIllisibles = errors.New("himap: marqueurs du mode illisibles")

// InstanceMarqueur : une pose d'un marqueur, dans le repere de son noeud.
type InstanceMarqueur struct {
	// Region et Permutation : rangs dans ModeRegions, -1 = toutes.
	Region, Permutation int
	// Noeud : rang dans le squelette du `mode` (ModeNodes), SansNoeud sans noeud.
	Noeud       int
	Translation [3]float64
	// Rotation : quaternion (x, y, z, w), axes Halo.
	Rotation [4]float64
}

// GroupeMarqueurs : un marqueur nomme et ses instances.
type GroupeMarqueurs struct {
	Nom       uint32
	Instances []InstanceMarqueur
}

// MarqueursDuMode lit les groupes de marqueurs d'un tag `mode` deja decompresse ; un groupe sans
// instance est garde (vide). ErrMarqueursIllisibles quand le bloc manque ou qu'un bloc d'instances
// n'a pas le pas attendu.
func MarqueursDuMode(tag []byte) ([]GroupeMarqueurs, error) {
	ti, err := meilleurTagInfo(tag)
	if err != nil {
		return nil, fmt.Errorf("%w : %w", ErrMarqueursIllisibles, err)
	}
	offs, cibles, err := ti.rootBlockRefs()
	if err != nil {
		return nil, fmt.Errorf("%w : %w", ErrMarqueursIllisibles, err)
	}
	for i, o := range offs {
		if o != modeOffMarqueurs {
			continue
		}
		abs, taille := ti.blockAbs(cibles[i])
		if abs < 0 || taille%groupeMarqueursStride != 0 || abs+taille > len(ti.tag) {
			return nil, fmt.Errorf("%w : bloc de %d o", ErrMarqueursIllisibles, taille)
		}
		sous := ti.sousBlocsParOffset(cibles[i])
		out := make([]GroupeMarqueurs, 0, taille/groupeMarqueursStride)
		for g := 0; g < taille/groupeMarqueursStride; g++ {
			rec := abs + g*groupeMarqueursStride
			grp := GroupeMarqueurs{Nom: uint32(u32(ti.tag, rec))}
			n := u32(ti.tag, rec+groupeMarqueursOffInst+tagBlockCountOffset)
			bloc, ok := sous[g*groupeMarqueursStride+groupeMarqueursOffInst]
			if n > 0 && ok {
				iAbs, iTaille := ti.blockAbs(bloc)
				if iAbs < 0 || iTaille != n*instanceMarqueurStride || iAbs+iTaille > len(ti.tag) {
					return nil, fmt.Errorf("%w : groupe %08x, %d instances sur %d o", ErrMarqueursIllisibles, grp.Nom, n, iTaille)
				}
				for k := 0; k < n; k++ {
					o := iAbs + k*instanceMarqueurStride
					grp.Instances = append(grp.Instances, lisInstanceMarqueur(ti.tag[o:o+instanceMarqueurStride]))
				}
			}
			out = append(out, grp)
		}
		return out, nil
	}
	return nil, fmt.Errorf("%w : pas de bloc a la racine +%d", ErrMarqueursIllisibles, modeOffMarqueurs)
}

// ChoisitInstance rend l'instance du groupe que porte la selection `sel` (region -> permutation,
// StringID) : la premiere liee a une piece selectionnee, sinon la premiere liee a aucune region ;
// faux quand aucune ne convient.
func ChoisitInstance(g GroupeMarqueurs, regions []Region, sel map[uint32]uint32) (InstanceMarqueur, bool) {
	for _, in := range g.Instances {
		if in.Region < 0 || in.Region >= len(regions) {
			continue
		}
		reg := regions[in.Region]
		perm, nommee := sel[reg.Name]
		if nommee && (in.Permutation < 0 || (in.Permutation < len(reg.Permutations) && reg.Permutations[in.Permutation].Name == perm)) {
			return in, true
		}
	}
	for _, in := range g.Instances {
		if in.Region < 0 {
			return in, true
		}
	}
	return InstanceMarqueur{}, false
}

// DansLeModele rend la pose de l'instance dans le repere du modele en pose de repos : noeud x
// T(translation) x R(rotation).
func (in InstanceMarqueur) DansLeModele(noeuds []Noeud) Transforme {
	local := Transforme{Scale: 1, Rot: quatVersRot(in.Rotation), Trans: in.Translation}
	if in.Noeud == SansNoeud || in.Noeud >= len(noeuds) {
		return local
	}
	return Compose(NodeModelTransform(noeuds, in.Noeud), local)
}

// PoseGLTF rend une translation et une rotation du repere Halo en axes glTF (glb_peau.go : la
// translation devient (x, z, -y), le quaternion (x, z, -y, w), normalise).
func PoseGLTF(translation [3]float64, rotation [4]float64) ([3]float32, [4]float32) {
	t, q, _ := trsGLTF(Noeud{Pos: translation, Quat: rotation, Scale: 1})
	return t, q
}

// lisInstanceMarqueur decode un enregistrement d'instance de 56 o.
func lisInstanceMarqueur(rec []byte) InstanceMarqueur {
	in := InstanceMarqueur{
		Region:      int(int8(rec[instMarqOffRegion])),
		Permutation: i32(rec, instMarqOffPerm),
		Noeud:       int(rec[instMarqOffNoeud]),
	}
	for c := 0; c < 3; c++ {
		in.Translation[c] = f32(rec, instMarqOffTranslation+4*c)
	}
	for c := 0; c < 4; c++ {
		in.Rotation[c] = f32(rec, instMarqOffRotation+4*c)
	}
	return in
}
