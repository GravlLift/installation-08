// Package himap — accessoires_armure.go : les ACCESSOIRES d'armure (tags `ocad`), modeles rigides a
// part que le jeu pose a un marqueur du Spartan (marqueurs.go) : accessoires de casque, de poitrine,
// de poignet, de hanche, et la geometrie visible des epaulieres.
//
// Grammaire du `ocad`, lue sur les 1 578 tags des modules globaux (440 o, deux de 608 o) :
//
//	racine (40 o) : entrees TagBlock +16 (compte a +32) ; 1 entree (2 pour deux tags)
//	entree (56 o) : modele = reference de tag `hlmt` (GlobalID a +8), variante StringID +28 (0 : celle
//	                par defaut), marqueurs TagBlock +32 (compte a +48), u16 +52 non lu (0 a 4 selon la
//	                place de l'accessoire)
//	marqueur (40 o) : nom StringID +0, translation 3 x f32 +4, rotation (x, y, z, w) 4 x f32 +16,
//	                  deux f32 +32 (1, 1 partout ; non lus)
//
// Le `hlmt` mene a un `mode` d'un noeud, une region, une section, rigide : le modele se lit comme
// une arme. Le marqueur de l'entree est un decalage dans le repere de l'instance du marqueur du
// Spartan qui porte son nom (identite sur les tags mesures).
package himap

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
)

// GroupeAccessoire : le groupe des accessoires de personnalisation.
const GroupeAccessoire = "ocad"

// Grammaire du `ocad`.
const (
	ocadOffEntrees        = 16
	ocadEntreeStride      = 56
	ocadEntreeOffVariante = 28
	ocadEntreeOffMarq     = 32
	ocadMarqueurStride    = 40
	ocadMarqOffTrans      = 4
	ocadMarqOffRot        = 16
)

// ErrAccessoireIllisible : le tag n'est pas un `ocad` lisible.
var ErrAccessoireIllisible = errors.New("himap: accessoire illisible")

// MarqueurAccessoire : le marqueur ou se pose une entree, et son decalage dans le repere de
// l'instance de ce marqueur.
type MarqueurAccessoire struct {
	Nom         uint32
	Translation [3]float64
	// Rotation : quaternion (x, y, z, w), axes Halo.
	Rotation [4]float64
}

// EntreeAccessoire : un modele pose par l'accessoire.
type EntreeAccessoire struct {
	// Modele : le GlobalID du `hlmt` ; Variante : sa variante (0 : celle par defaut).
	Modele, Variante uint32
	Marqueurs        []MarqueurAccessoire
	// octets : l'enregistrement, ou se lisent les references du modele.
	octets []byte
}

// Accessoire : un tag `ocad` lu.
type Accessoire struct {
	ID      uint32
	Entrees []EntreeAccessoire
}

// LitAccessoire lit un tag `ocad` deja decompresse.
func LitAccessoire(id uint32, tag []byte) (Accessoire, error) {
	ti, err := meilleurTagInfo(tag)
	if err != nil {
		return Accessoire{}, fmt.Errorf("%w : %08x : %w", ErrAccessoireIllisible, id, err)
	}
	offs, cibles, err := ti.rootBlockRefs()
	if err != nil {
		return Accessoire{}, fmt.Errorf("%w : %08x : %w", ErrAccessoireIllisible, id, err)
	}
	out := Accessoire{ID: id}
	for i, o := range offs {
		if o != ocadOffEntrees {
			continue
		}
		abs, taille := ti.blockAbs(cibles[i])
		if abs < 0 || taille%ocadEntreeStride != 0 || abs+taille > len(ti.tag) {
			return out, fmt.Errorf("%w : %08x : entrees sur %d o", ErrAccessoireIllisible, id, taille)
		}
		sous := ti.sousBlocsParOffset(cibles[i])
		for k := 0; k < taille/ocadEntreeStride; k++ {
			rec := abs + k*ocadEntreeStride
			e := EntreeAccessoire{
				Modele:   uint32(u32(ti.tag, rec+8)),
				Variante: uint32(u32(ti.tag, rec+ocadEntreeOffVariante)),
				octets:   ti.tag[rec : rec+ocadEntreeStride],
			}
			n := u32(ti.tag, rec+ocadEntreeOffMarq+tagBlockCountOffset)
			if bloc, ok := sous[k*ocadEntreeStride+ocadEntreeOffMarq]; ok && n > 0 {
				mAbs, mTaille := ti.blockAbs(bloc)
				if mAbs < 0 || mTaille != n*ocadMarqueurStride || mAbs+mTaille > len(ti.tag) {
					return out, fmt.Errorf("%w : %08x : %d marqueurs sur %d o", ErrAccessoireIllisible, id, n, mTaille)
				}
				for j := 0; j < n; j++ {
					e.Marqueurs = append(e.Marqueurs, lisMarqueurAccessoire(ti.tag[mAbs+j*ocadMarqueurStride:]))
				}
			}
			out.Entrees = append(out.Entrees, e)
		}
		return out, nil
	}
	return out, fmt.Errorf("%w : %08x : pas d'entrees a la racine +%d", ErrAccessoireIllisible, id, ocadOffEntrees)
}

// lisMarqueurAccessoire decode un marqueur d'entree (40 o).
func lisMarqueurAccessoire(rec []byte) MarqueurAccessoire {
	m := MarqueurAccessoire{Nom: uint32(u32(rec, 0))}
	for c := 0; c < 3; c++ {
		m.Translation[c] = f32(rec, ocadMarqOffTrans+4*c)
	}
	for c := 0; c < 4; c++ {
		m.Rotation[c] = f32(rec, ocadMarqOffRot+4*c)
	}
	return m
}

// AccessoiresDuModele rend, tries par GlobalID, les accessoires dont chaque entree a des marqueurs
// et dont tous les marqueurs sont parmi `noms` (les marqueurs d'un modele : MarqueursDuMode). Les
// autres (breloques d'arme...) sont comptes dans `autres`. Un `ocad` illisible est journalise et
// compte dans `illisibles`.
func (a *Arsenal) AccessoiresDuModele(ctx context.Context, noms map[uint32]bool) (out []Accessoire, autres, illisibles int) {
	ids := a.geo.EntreesDuGroupe(GroupeAccessoire)
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for _, id := range ids {
		tag, err := a.geo.Extract(id)
		if err == nil {
			var acc Accessoire
			if acc, err = LitAccessoire(id, tag); err == nil {
				if portePar(acc, noms) {
					out = append(out, acc)
				} else {
					autres++
				}
				continue
			}
		}
		slog.WarnContext(ctx, "accessoire illisible", "id", fmt.Sprintf("%08x", id), "err", err)
		illisibles++
	}
	return out, autres, illisibles
}

// portePar dit si chaque entree de l'accessoire a des marqueurs, tous parmi `noms`.
func portePar(acc Accessoire, noms map[uint32]bool) bool {
	if len(acc.Entrees) == 0 {
		return false
	}
	for _, e := range acc.Entrees {
		if len(e.Marqueurs) == 0 {
			return false
		}
		for _, m := range e.Marqueurs {
			if !noms[m.Nom] {
				return false
			}
		}
	}
	return true
}

// ModeleAccessoire rend le maillage rigide d'une entree d'accessoire, dans le repere de son modele,
// materiaux et textures resolus ; ErrSansModele quand le `hlmt` ne mene a aucun modele lisible.
func (a *Arsenal) ModeleAccessoire(ctx context.Context, e EntreeAccessoire) (*MaillageMonde, error) {
	id, groupe, ok := modeleParHlmtRecursif(ctx, a.geo, e.octets, map[uint32]bool{}, 0)
	if !ok {
		return nil, fmt.Errorf("%w : hlmt %08x sans modele", ErrSansModele, e.Modele)
	}
	asset := ouvreAsset(ctx, a.geo, id, groupe)
	if asset == nil {
		return nil, fmt.Errorf("%w : modele %08x du hlmt %08x illisible", ErrSansModele, id, e.Modele)
	}
	mp := lisModelePose(asset, groupe, varianteDuPlacement(ctx, a.geo, e.octets, e.Variante))
	m := &MaillageMonde{SurfacesBrutes: true}
	m.poseModele(&mp, PlacementScenario{Echelle: 1}.Instance())
	m.Ombre = GroupeMaillage{}
	if m.Structure.Triangles() == 0 {
		return nil, fmt.Errorf("%w : hlmt %08x sans triangle visible", ErrSansModele, e.Modele)
	}
	m.lisMateriaux(a.mats, a.geo)
	m.resoutTextures(ctx, a.geo)
	return m, nil
}
