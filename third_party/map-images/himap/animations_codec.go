// Package himap — animations_codec.go : le decodage des donnees compressees d'une animation en
// pistes locales par os.
//
// Le blob d'un membre de ressource (animations.go) est la concatenation de 19 sections, dans
// l'ordre des emplacements ; celles que lit ce fichier :
//
//	0  pose statique, codec 1 (brut)          2  drapeaux des os statiques
//	1  pistes animees (codec 3 ou 10)         3  drapeaux des os animes
//	4  deplacement de racine, par image       17 pose statique, codec 11 (tables partagees)
//
// Drapeaux : trois tableaux de bits de meme taille (rotation, translation, echelle), bit de poids
// faible d'abord ; le n-ieme bit allume d'un tableau est la n-ieme piste du flux correspondant.
//
// En-tete d'un flux (48 o) : codec u8 +0, comptes u16 de rotations +2, translations +4, echelles
// +6, deux flottants +8 / +12 (non lus), debut des translations u32 +16, des echelles u32 +20, pas
// par piste u32 de rotation +24, translation +28, echelle +32 ; les rotations commencent a +48.
//
//	codec 3  : piste par piste ; rotation = 4 x i16 / 32767 (x, y, z, w) par image, translation =
//	           3 x f32 par image, echelle = f32 par image
//	codec 1  : la meme disposition sur une image
//	codec 11 : un index u16 par piste dans les tables partagees du graphe (rotations a +48,
//	           translations et echelles a leur debut)
//	codec 10 : courbes revisees (cles et segments de Hermite), en pistes animees seulement :
//	           animations_courbes.go ; une variante non lue rend CourbeNonLueError
//
// Pose d'un os a une image : la piste animee si son bit anime est allume, sinon la valeur statique
// si son bit statique l'est, sinon la pose de repos du modele (PisteOs vide).
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"errors"
	"fmt"
)

// Codecs des flux d'animation.
const (
	CodecAucun           = 0
	CodecStatiqueBrut    = 1
	CodecQuantifie       = 3
	CodecCourbeRevisee   = 10
	CodecStatiquePartage = 11
)

// Emplacements des sections d'un membre.
const (
	sectionStatique        = 0
	sectionAnimee          = 1
	sectionDrapeauxStatiq  = 2
	sectionDrapeauxAnimes  = 3
	sectionDeplacement     = 4
	sectionStatiquePartage = 17
)

// Grammaire de l'en-tete d'un flux.
const (
	fluxEntete          = 48
	fluxOffRotations    = 2
	fluxOffTranslations = 4
	fluxOffEchelles     = 6
	fluxOffDebutTrans   = 16
	fluxOffDebutEch     = 20
	fluxOffPasRot       = 24
	fluxOffPasTrans     = 28
	fluxOffPasEch       = 32
	octetsRotation      = 8
	octetsTranslation   = 12
	octetsEchelle       = 4
	octetsIndexPartage  = 2
	tableauxDrapeaux    = 3
)

// ErrCodecNonDecode : l'animation est dans un codec que ce lecteur ne decode pas.
var ErrCodecNonDecode = errors.New("himap: animation codec not decoded")

// ErrAnimationIllisible : les donnees de l'animation ne tiennent pas dans leur blob.
var ErrAnimationIllisible = errors.New("himap: unreadable animation data")

// CodecNonDecodeError porte le codec refuse ; errors.Is(err, ErrCodecNonDecode).
type CodecNonDecodeError struct{ Codec int }

func (e CodecNonDecodeError) Error() string {
	return fmt.Sprintf("%v : codec %d", ErrCodecNonDecode, e.Codec)
}

// Is rattache l'erreur a ErrCodecNonDecode.
func (e CodecNonDecodeError) Is(cible error) bool { return cible == ErrCodecNonDecode }

// MouvementNonLuError porte une sorte de deplacement de racine non lue (angle-axe) ;
// errors.Is(err, ErrCodecNonDecode).
type MouvementNonLuError struct{ Mouvement Mouvement }

func (e MouvementNonLuError) Error() string {
	return fmt.Sprintf("%v : sorte de mouvement %d", ErrCodecNonDecode, e.Mouvement)
}

// Is rattache l'erreur a ErrCodecNonDecode.
func (e MouvementNonLuError) Is(cible error) bool { return cible == ErrCodecNonDecode }

// PisteOs : les valeurs locales d'un os, axes Halo. Une piste animee porte une valeur par image,
// une piste statique une seule, une piste vide laisse la pose de repos.
type PisteOs struct {
	Rotations    [][4]float64
	Translations [][3]float64
	Echelles     []float64
}

// ClipAnimation : une animation decodee.
type ClipAnimation struct {
	Graphe    uint32
	Animation AnimationGraphe
	// Codec : celui des pistes animees (CodecAucun pour une pose fixe).
	Codec  int
	Images int
	// Os : une piste par os du graphe.
	Os []PisteOs
	// Deplacement : par image, le deplacement de racine (dx, dy, dz, dlacet) ; les composantes que
	// la sorte de mouvement ne porte pas valent 0. Vide sans mouvement.
	Deplacement [][4]float64
}

// fluxLu : l'en-tete d'un flux.
type fluxLu struct {
	codec                    int
	nRot, nTrans, nEch       int
	debutTrans, debutEch     int
	pasRot, pasTrans, pasEch int
	octets                   []byte
}

// Decode decode l'animation de rang `rang`.
func (g *GrapheAnimation) Decode(rang int) (*ClipAnimation, error) {
	if rang < 0 || rang >= len(g.Animations) {
		return nil, fmt.Errorf("%w: animation %d outside the %d of graph %08x", ErrAnimationIllisible, rang, len(g.Animations), g.ID)
	}
	a := g.Animations[rang]
	m, ok := g.membres[[2]int{a.Groupe, a.Membre}]
	if !ok {
		return nil, fmt.Errorf("%w: animation %d without a resource member (%d, %d)", ErrAnimationIllisible, rang, a.Groupe, a.Membre)
	}
	sec := sectionsDuMembre(m)
	c := &ClipAnimation{Graphe: g.ID, Animation: a, Images: a.Images, Os: make([]PisteOs, len(g.Os))}
	statiques, animes, err := drapeauxDuMembre(sec, len(g.Os))
	if err != nil {
		return nil, fmt.Errorf("animation %d : %w", rang, err)
	}
	// Les pistes animees d'abord : une animation d'un codec non decode se compte comme telle,
	// quelle que soit sa pose statique.
	if err := c.pistesAnimees(sec[sectionAnimee], animes); err != nil {
		return nil, fmt.Errorf("animation %d : %w", rang, err)
	}
	if err := g.poseStatique(c, sec, statiques); err != nil {
		return nil, fmt.Errorf("animation %d : %w", rang, err)
	}
	if err := c.litDeplacement(sec[sectionDeplacement]); err != nil {
		return nil, fmt.Errorf("animation %d : %w", rang, err)
	}
	return c, nil
}

// sectionsDuMembre decoupe le blob d'un membre en ses 19 sections.
func sectionsDuMembre(m membreRessource) [sectionsParMembre][]byte {
	var out [sectionsParMembre][]byte
	o := 0
	for s, t := range m.tailles {
		out[s] = m.blob[o : o+t]
		o += t
	}
	return out
}

// drapeauxDuMembre rend, pour les os statiques puis animes, les rangs d'os de chaque tableau
// (rotation, translation, echelle) dans l'ordre de leurs bits.
func drapeauxDuMembre(sec [sectionsParMembre][]byte, nOs int) (statiques, animes [tableauxDrapeaux][]int, err error) {
	if statiques, err = rangsDesDrapeaux(sec[sectionDrapeauxStatiq], nOs); err != nil {
		return statiques, animes, fmt.Errorf("static flags: %w", err)
	}
	if animes, err = rangsDesDrapeaux(sec[sectionDrapeauxAnimes], nOs); err != nil {
		return statiques, animes, fmt.Errorf("animated flags: %w", err)
	}
	return statiques, animes, nil
}

// rangsDesDrapeaux lit trois tableaux de bits de meme taille ; une section vide n'allume rien.
func rangsDesDrapeaux(b []byte, nOs int) ([tableauxDrapeaux][]int, error) {
	var out [tableauxDrapeaux][]int
	if len(b) == 0 {
		return out, nil
	}
	if len(b)%tableauxDrapeaux != 0 || len(b)/tableauxDrapeaux*8 < nOs {
		return out, fmt.Errorf("%w: %d bytes of flags for %d bones", ErrAnimationIllisible, len(b), nOs)
	}
	t := len(b) / tableauxDrapeaux
	for k := 0; k < tableauxDrapeaux; k++ {
		for i := 0; i < t*8; i++ {
			if b[k*t+i/8]&(1<<(i%8)) == 0 {
				continue
			}
			if i >= nOs {
				return out, fmt.Errorf("%w: bit %d set for %d bones", ErrAnimationIllisible, i, nOs)
			}
			out[k] = append(out[k], i)
		}
	}
	return out, nil
}

// litFlux lit l'en-tete d'un flux ; un flux vide rend un codec nul.
func litFlux(b []byte) (fluxLu, error) {
	if len(b) == 0 {
		return fluxLu{}, nil
	}
	if c := int(b[0]); c == CodecCourbeRevisee {
		// Les courbes ont leur propre en-tete (animations_courbes.go), lu par pistesAnimees : ici,
		// en pose statique, le codec est refuse avant toute lecture d'en-tete.
		return fluxLu{}, CodecNonDecodeError{Codec: c}
	}
	if len(b) < fluxEntete {
		return fluxLu{}, fmt.Errorf("%w: stream of %d bytes (codec %d)", ErrAnimationIllisible, len(b), b[0])
	}
	return fluxLu{
		codec: int(b[0]), nRot: int(u16(b, fluxOffRotations)), nTrans: int(u16(b, fluxOffTranslations)),
		nEch: int(u16(b, fluxOffEchelles)), debutTrans: u32(b, fluxOffDebutTrans), debutEch: u32(b, fluxOffDebutEch),
		pasRot: u32(b, fluxOffPasRot), pasTrans: u32(b, fluxOffPasTrans), pasEch: u32(b, fluxOffPasEch), octets: b,
	}, nil
}

// borne verifie qu'une plage [o, o+n) tient dans le flux.
func (f fluxLu) borne(o, n int) error {
	if o < 0 || n < 0 || o+n > len(f.octets) {
		return fmt.Errorf("%w: read [%d, %d) outside a stream of %d bytes (codec %d)", ErrAnimationIllisible, o, o+n, len(f.octets), f.codec)
	}
	return nil
}

// verifieComptes compare les comptes de l'en-tete aux drapeaux.
func (f fluxLu) verifieComptes(rangs [tableauxDrapeaux][]int) error {
	if f.nRot != len(rangs[0]) || f.nTrans != len(rangs[1]) || f.nEch != len(rangs[2]) {
		return fmt.Errorf("%w: codec %d, header %d/%d/%d tracks, flags %d/%d/%d", ErrAnimationIllisible, f.codec,
			f.nRot, f.nTrans, f.nEch, len(rangs[0]), len(rangs[1]), len(rangs[2]))
	}
	return nil
}
