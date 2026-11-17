// Package himap — banniere_equipe.go : LA BANNIERE D'EQUIPE qu'une arme porte (le drapeau du CTF).
//
// Le drapeau (`weap` 2a392328) n'a pas de banniere dans son maillage : sa banniere est un effet
// (`effe`) attache a un marqueur de son modele, un par permutation d'equipe de la region
// d'equipe (eagle, cobra, ..., neutral). Cet effet est un jeu de systemes de particules dont
// chaque emetteur pose UNE particule de longue vie : un quad, pas un nuage. Deux de ces quads
// portent l'identite de la banniere :
//
//   - le TISSU : une particule en melange alpha, ancree par son bord (pivot x non nul), dont la
//     particule (`prt3`) lit un tableau de bitmaps couleur (la forme d'un drapeau ondulant, 30
//     images) ; la vue en garde la premiere image ;
//   - l'EMBLEME : la particule dont l'emetteur porte un SELECTEUR d'equipe non nul. C'est la seule
//     valeur qui differe d'un effet d'equipe a l'autre (0,1 eagle, 0,2 cobra, 0,3 hades, 0,4
//     valkyrie, 0,6 rampart, 0,7 cutlass, 0,8 valor, 0,9 hazard) ; elle choisit la couche
//     floor(v * profondeur) du tableau d'emblemes (8 couches : l'aigle, le cobra, le casque...).
//
// LECTURE : il n'existe pas de description publique des tags `effe` / `prt3` dans ce depot. Les
// offsets ci-dessous sont ceux lus sur le tag du jeu installe (comparaison des neuf effets
// d'equipe, qui ne different que par le selecteur) ; chaque lecture verifie la taille de son
// bloc et refuse plutot que de deviner.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"context"
	"errors"
	"fmt"
	"math"

	"github.com/woozymasta/bcn"
)

// ErrSansBanniere : l'arme n'attache aucun effet de banniere lisible.
var ErrSansBanniere = errors.New("himap: weapon without a team banner")

// AttacheEffet : un effet attache a un marqueur du modele de l'arme (bloc `attachments` du
// `weap`, lu par l'appelant avec la description du tag).
type AttacheEffet struct {
	Effet    uint32
	Marqueur uint32
}

// CoucheBanniere : un quad de la banniere, dans le repere de son marqueur (unites monde). Le quad
// est dans le plan (Y, Z) du marqueur : sa largeur suit +Y (l'embleme est decale de +0,175 sur Y,
// le centre du tissu ancre par son bord), sa hauteur suit +Z.
type CoucheBanniere struct {
	// Largeur, Hauteur : les cotes du quad, deux fois la taille de la particule (un rayon) par
	// son echelle : le tissu fait 0,375 x 0,28, son centre a 0,178 du marqueur, la ou l'embleme
	// est decale.
	Largeur, Hauteur float64
	// Pivot : le point d'ancrage du quad, en coordonnees normalisees [-0,5 ; 0,5] du quad
	// (x le long de la largeur, y le long de la hauteur).
	Pivot [2]float64
	// Decalage : la translation de la particule depuis le marqueur, axes Halo du marqueur.
	Decalage [3]float64
	// Alpha : l'opacite constante de l'emetteur.
	Alpha float64
	// Additif : la particule s'ajoute a la scene (melange 9) au lieu de la recouvrir (melange 3).
	Additif bool
}

// BanniereEquipe : la banniere d'une arme, lue sur ses effets d'equipe.
type BanniereEquipe struct {
	// Marqueur : la position du marqueur des effets, repere du modele, axes Halo.
	Marqueur   [3]float64
	Tissu      CoucheBanniere
	ImageTissu Texture
	Embleme    CoucheBanniere
	// Emblemes : l'image de l'embleme de chaque equipe, rang = couche du tableau choisie par le
	// selecteur de son effet ; vide quand aucun effet ne porte d'embleme.
	Emblemes []Texture
}

// Disposition de l'effet (lue, cf. en-tete).
const (
	effeOffNiveaux       = 0x5c  // racine : niveaux de detail (le premier est le plus proche)
	effeOffEvenements    = 0x64  // niveau : evenements
	effeTailleEvenement  = 0x5c  // un evenement
	effeOffSystemes      = 0x48  // evenement : systemes de particules
	effeTailleSysteme    = 0x78  // un systeme
	effeOffParticule     = 0x0c  // systeme : GlobalID de la particule `prt3`
	effeOffEmetteurs     = 0x5c  // systeme : emetteurs
	effeTailleEmetteur   = 0x5a8 // un emetteur
	emetOffDecalage      = 0x17c // translation x, y, z
	emetOffPivot         = 0x194 // pivot x, y
	emetOffTaille        = 0x290 // taille de la particule
	emetOffEchelleX      = 0x2b4
	emetOffEchelleY      = 0x2d8
	emetOffAlpha         = 0x4c0
	emetOffSelecteur     = 0x554 // selecteur d'equipe (0 hors embleme)
	prt3OffMelange       = 0x78  // racine de la particule : mode de melange (octet bas)
	melangeAlpha         = 3
	melangeAdditifAlpha  = 9
	tailleImageBanniere  = 512
	selecteurMinimal     = 1e-6
	niveauxEmetteurMaxi  = 64
	profondeurEmblemeMin = 2
)

// emetteur : ce que la vue lit d'un emetteur et de sa particule.
type emetteur struct {
	couche    CoucheBanniere
	selecteur float64
	images    []uint32 // les bitmaps de la particule, dans l'ordre de ses dependances
}

// BanniereEquipe lit la banniere des effets `attaches` (ceux du `weap` de l'arme) : le tissu et
// l'embleme de chaque equipe. ErrSansBanniere quand aucun effet n'en porte.
func (a *Arsenal) BanniereEquipe(weap uint32, attaches []AttacheEffet) (*BanniereEquipe, error) {
	b := &BanniereEquipe{}
	parCouche := map[int]Texture{}
	tissuLu := false
	for _, at := range attaches {
		ems, err := a.emetteursProches(at.Effet)
		if err != nil {
			continue
		}
		if !tissuLu {
			if c, img, ok := a.tissuDe(ems); ok {
				b.Tissu, b.ImageTissu, tissuLu = c, img, true
				b.Marqueur, _ = a.marqueurDeLArme(weap, at.Marqueur)
			}
		}
		if c, couche, img, ok := a.emblemeDe(ems); ok {
			b.Embleme = c
			parCouche[couche] = img
		}
	}
	if !tissuLu {
		return nil, fmt.Errorf("%w : %08x", ErrSansBanniere, weap)
	}
	for k := 0; k < len(parCouche); k++ {
		img, ok := parCouche[k]
		if !ok {
			return nil, fmt.Errorf("himap: emblems of %08x: layer %d missing", weap, k)
		}
		b.Emblemes = append(b.Emblemes, img)
	}
	return b, nil
}

// emetteursProches lit les emetteurs du niveau de detail le plus proche de l'effet `id`.
func (a *Arsenal) emetteursProches(id uint32) ([]emetteur, error) {
	raw, err := a.geo.Extract(id)
	if err != nil {
		return nil, err
	}
	ti, err := meilleurTagInfo(raw)
	if err != nil {
		return nil, err
	}
	rb, err := ti.rootBlockIndex()
	if err != nil {
		return nil, err
	}
	niveaux := ti.subBlockTarget(rb, effeOffNiveaux)
	evts := ti.subBlockTarget(niveaux, effeOffEvenements)
	if niveaux < 0 || evts < 0 {
		return nil, fmt.Errorf("himap: effect %08x without an event", id)
	}
	_, taille := ti.blockAbs(evts)
	var out []emetteur
	for e := 0; e < taille/effeTailleEvenement; e++ {
		sys := ti.subBlockTarget(evts, e*effeTailleEvenement+effeOffSystemes)
		if sys < 0 {
			continue
		}
		out = append(out, a.emetteursDuBloc(ti, sys)...)
	}
	return out, nil
}

// emetteursDuBloc lit le premier emetteur de chaque systeme du bloc `sys`.
func (a *Arsenal) emetteursDuBloc(ti tagInfo, sys int) []emetteur {
	abs, taille := ti.blockAbs(sys)
	var out []emetteur
	for s := 0; s < taille/effeTailleSysteme && s < niveauxEmetteurMaxi; s++ {
		em := ti.subBlockTarget(sys, s*effeTailleSysteme+effeOffEmetteurs)
		eabs, etaille := ti.blockAbs(em)
		if em < 0 || etaille < effeTailleEmetteur || eabs+effeTailleEmetteur > len(ti.tag) {
			continue
		}
		f := func(o int) float64 { return float64(f32Brut(ti.tag, eabs+o)) }
		e := emetteur{
			couche: CoucheBanniere{
				Largeur:  2 * f(emetOffTaille) * f(emetOffEchelleX),
				Hauteur:  2 * f(emetOffTaille) * f(emetOffEchelleY),
				Pivot:    [2]float64{f(emetOffPivot), f(emetOffPivot + 4)},
				Decalage: [3]float64{f(emetOffDecalage), f(emetOffDecalage + 4), f(emetOffDecalage + 8)},
				Alpha:    f(emetOffAlpha),
			},
			selecteur: f(emetOffSelecteur),
		}
		prt := uint32(u32(ti.tag, abs+s*effeTailleSysteme+effeOffParticule))
		if raw, err := a.geo.Extract(prt); err == nil {
			e.couche.Additif = melangeDeParticule(raw) == melangeAdditifAlpha
			e.images = dependancesDuGroupe(raw, GroupeBitmap)
			if melangeDeParticule(raw) != melangeAlpha && !e.couche.Additif {
				continue
			}
		}
		out = append(out, e)
	}
	return out
}

// melangeDeParticule : le mode de melange de la particule `prt3` (octet bas du champ), -1 illisible.
func melangeDeParticule(raw []byte) int {
	ti, err := meilleurTagInfo(raw)
	if err != nil {
		return -1
	}
	rb, err := ti.rootBlockIndex()
	if err != nil {
		return -1
	}
	abs, taille := ti.blockAbs(rb)
	if taille < prt3OffMelange+4 {
		return -1
	}
	return int(ti.tag[abs+prt3OffMelange])
}

// tissuDe : la couche du tissu (melange alpha, ancree par son bord) et la premiere image de son
// tableau couleur.
func (a *Arsenal) tissuDe(ems []emetteur) (CoucheBanniere, Texture, bool) {
	for _, e := range ems {
		if e.couche.Additif || math.Abs(e.couche.Pivot[0]) < selecteurMinimal || e.selecteur > selecteurMinimal {
			continue
		}
		for _, id := range e.images {
			if p, format, ok := a.profondeurBitmap(id); ok && p > 1 && !estNormale(format) {
				img, err := LitBitmap(a.geo, id, tailleImageBanniere)
				if err == nil {
					return e.couche, img, true
				}
			}
		}
	}
	return CoucheBanniere{}, Texture{}, false
}

// emblemeDe : la couche de l'embleme (emetteur a selecteur) et l'image de la couche choisie.
func (a *Arsenal) emblemeDe(ems []emetteur) (CoucheBanniere, int, Texture, bool) {
	for _, e := range ems {
		if e.selecteur <= selecteurMinimal {
			continue
		}
		for _, id := range e.images {
			p, _, ok := a.profondeurBitmap(id)
			if !ok || p < profondeurEmblemeMin {
				continue
			}
			couche := int(math.Floor(e.selecteur * float64(p)))
			img, err := LitCoucheBitmap(a.geo, id, couche, tailleImageBanniere)
			if err == nil {
				return e.couche, couche, img, true
			}
		}
	}
	return CoucheBanniere{}, 0, Texture{}, false
}

// estNormale : un format a deux canaux (RG8, RG8S, BC5, BC5S), celui des cartes de normales.
func estNormale(format int) bool {
	switch formatBitmap[format].f {
	case bcn.FormatRG8, bcn.FormatRG8S, bcn.FormatBC5, bcn.FormatBC5S:
		return true
	}
	return false
}

// marqueurDeLArme : la position du marqueur `nom` dans le modele de l'arme, axes Halo.
func (a *Arsenal) marqueurDeLArme(weap, nom uint32) ([3]float64, bool) {
	raw, err := a.geo.Extract(weap)
	if err != nil {
		return [3]float64{}, false
	}
	id, groupe, ok := RefModeleVehicule(context.Background(), a.geo, raw)
	if !ok || groupe != GroupeMode {
		return [3]float64{}, false
	}
	mode, err := a.geo.Extract(id)
	if err != nil {
		return [3]float64{}, false
	}
	groupes, err := MarqueursDuMode(mode)
	if err != nil {
		return [3]float64{}, false
	}
	for _, g := range groupes {
		if g.Nom == nom && len(g.Instances) > 0 {
			return g.Instances[0].Translation, true
		}
	}
	return [3]float64{}, false
}
