// Package himap — soleil.go : la direction du soleil d'une carte, lue dans le jeu.
//
// SOURCE. Le soleil que le jeu affiche est decrit par le tag `dwsg` (« dynamic world state
// globals ») que nomme le scenario de la carte (niveau.go), dans un module `any` : bloc
// « Dynamic Suns » (champ TagBlock a root+0x54),
// premier enregistrement de 0x34 octets :
//
//	+0x00 drapeaux u16 (bits ci-dessous)      +0x04 couleur (3 x f32, lineaire)
//	+0x14 intensite f32                       +0x20 angle horaire f32 (degres)
//	+0x24 latitude f32 (degres)               +0x28 azimut f32 (degres)
//	+0x2C saison f32
//
// Le bit « Override Primary Sun » remplace la lumiere « Sun » cuite dans le `stlm` : celle-ci
// n'est pas le soleil vu en jeu, elle n'est pas lue ici.
//
// CONVENTION (voir DirectionSoleil). La direction suit la geometrie solaire usuelle dans un
// repere local Est-Nord-Haut, tourne de l'azimut autour de Z. SEULE RECHARGE EST VERIFIEE
// CONTRE UNE IMAGE DU JEU : angle horaire 0, latitude 28, azimut 250, saison 0 -> azimut 160,
// elevation 85,44 (soleil presque au zenith, tache de la salle centrale d'une capture
// officielle). Cette ancre fixe le sens de rotation de l'azimut, son origine, et la saison 0 =
// solstice de juin (declinaison +23,44). Le reste est la geometrie solaire, pas une mesure :
// angle horaire en degres, positif l'apres-midi (soleil vers l'ouest) ; saison = fraction
// d'annee depuis le solstice de juin (declinaison 23,44 x cos(2 pi saison)). Les valeurs
// rencontrees sont 0 partout sauf -0,5 (Highpower, alors solstice de decembre) : ni le sens
// ni l'etendue de la saison ne sont confirmes au-dela de 0.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
)

// GroupeEtatDuMonde : le groupe de tag des « dynamic world state globals ».
const GroupeEtatDuMonde = "dwsg"

const (
	dwsgOffSoleils   = 0x54 // champ TagBlock « Dynamic Suns » du bloc racine
	soleilTaille     = 0x34
	soleilOffDrap    = 0x00
	soleilOffCouleur = 0x04
	soleilOffIntens  = 0x14
	soleilOffHeure   = 0x20
	soleilOffLat     = 0x24
	soleilOffAzimut  = 0x28
	soleilOffSaison  = 0x2C
	// compteTagBlock : le nombre d'elements d'un champ TagBlock vit a +0x10 du champ.
	compteTagBlock = 0x10

	// InclinaisonAxe : la declinaison solaire aux solstices, en degres.
	InclinaisonAxe = 23.44
)

// Bits du champ de drapeaux d'un soleil dynamique.
const (
	SoleilRemplacePrincipal uint16 = 1 << 0
	SoleilCouleur           uint16 = 1 << 1
	SoleilIntensite         uint16 = 1 << 2
	SoleilHeure             uint16 = 1 << 5
	SoleilLatitude          uint16 = 1 << 6
	SoleilAzimut            uint16 = 1 << 7
	SoleilSaison            uint16 = 1 << 8

	// soleilPosition : les bits sans lesquels la position du soleil n'est pas decrite.
	soleilPosition = SoleilRemplacePrincipal | SoleilHeure | SoleilLatitude | SoleilAzimut | SoleilSaison
)

// ParametresSoleil : le premier soleil dynamique d'un `dwsg`, tel qu'il est stocke.
type ParametresSoleil struct {
	Drapeaux     uint16
	Couleur      [3]float64
	Intensite    float64
	AngleHoraire float64
	Latitude     float64
	Azimut       float64
	Saison       float64
}

// Soleil : le soleil d'une carte. Direction est unitaire, en axes monde Halo (x, y, z ; z en
// haut), et pointe de la scene VERS le soleil. Couleur et Intensite ne sont renseignees que si
// le `dwsg` les porte (AvecCouleur, AvecIntensite).
type Soleil struct {
	Direction     [3]float64
	Couleur       [3]float64
	AvecCouleur   bool
	Intensite     float64
	AvecIntensite bool
}

// litParametresSoleil decode un enregistrement « Dynamic Suns » de 0x34 octets.
func litParametresSoleil(b []byte) (ParametresSoleil, error) {
	if len(b) < soleilTaille {
		return ParametresSoleil{}, fmt.Errorf("himap: dynamic sun truncated (%d bytes)", len(b))
	}
	f := func(o int) float64 { return float64(math.Float32frombits(binary.LittleEndian.Uint32(b[o:]))) }
	return ParametresSoleil{
		Drapeaux:     binary.LittleEndian.Uint16(b[soleilOffDrap:]),
		Couleur:      [3]float64{f(soleilOffCouleur), f(soleilOffCouleur + 4), f(soleilOffCouleur + 8)},
		Intensite:    f(soleilOffIntens),
		AngleHoraire: f(soleilOffHeure),
		Latitude:     f(soleilOffLat),
		Azimut:       f(soleilOffAzimut),
		Saison:       f(soleilOffSaison),
	}, nil
}

// DirectionSoleil rend la direction unitaire VERS le soleil, en axes monde Halo.
//
// Geometrie solaire dans le repere local (Est, Nord, Haut), angles en degres, H = angle
// horaire (0 = midi solaire, positif l'apres-midi), phi = latitude, delta = Declinaison(saison) :
//
//	Est  = -cos(delta) sin(H)
//	Nord =  cos(phi) sin(delta) - sin(phi) cos(delta) cos(H)
//	Haut =  sin(phi) sin(delta) + cos(phi) cos(delta) cos(H)
//
// puis rotation de l'azimut A autour de Z : l'Est local a le lacet monde A (depuis +X vers +Y),
// le Nord le lacet A + 90. Recharge (0, 28, 250, 0) donne (-0,0753, 0,0274, 0,9968).
func DirectionSoleil(angleHoraire, latitude, azimut, saison float64) [3]float64 {
	rad := math.Pi / 180
	h, phi, delta, a := angleHoraire*rad, latitude*rad, Declinaison(saison)*rad, azimut*rad
	est := -math.Cos(delta) * math.Sin(h)
	nord := math.Cos(phi)*math.Sin(delta) - math.Sin(phi)*math.Cos(delta)*math.Cos(h)
	haut := math.Sin(phi)*math.Sin(delta) + math.Cos(phi)*math.Cos(delta)*math.Cos(h)
	return [3]float64{
		est*math.Cos(a) - nord*math.Sin(a),
		est*math.Sin(a) + nord*math.Cos(a),
		haut,
	}
}

// Declinaison rend la declinaison solaire (degres) d'une saison : fraction d'annee depuis le
// solstice de juin, 0 -> +InclinaisonAxe, +-0,5 -> -InclinaisonAxe (cf. l'en-tete du fichier).
func Declinaison(saison float64) float64 {
	return InclinaisonAxe * math.Cos(2*math.Pi*saison)
}

// Soleil rend le soleil decrit par ces parametres. ok=false quand le `dwsg` ne decrit pas la
// position du soleil (un bit de soleilPosition absent), quand le soleil est eteint (intensite
// declaree nulle ou negative) ou sous l'horizon : jamais de valeur par defaut.
func (p ParametresSoleil) Soleil() (Soleil, bool) {
	if p.Drapeaux&soleilPosition != soleilPosition {
		return Soleil{}, false
	}
	s := Soleil{Direction: DirectionSoleil(p.AngleHoraire, p.Latitude, p.Azimut, p.Saison)}
	if s.Direction[2] <= 0 {
		return Soleil{}, false
	}
	if p.Drapeaux&SoleilIntensite != 0 {
		if p.Intensite <= 0 {
			return Soleil{}, false
		}
		s.Intensite, s.AvecIntensite = p.Intensite, true
	}
	if p.Drapeaux&SoleilCouleur != 0 {
		s.Couleur, s.AvecCouleur = p.Couleur, true
	}
	return s, true
}

// ErrSansSoleil : le `dwsg` de la carte ne porte aucun soleil dynamique.
var ErrSansSoleil = errors.New("himap: no dynamic sun")

// LitParametresSoleil lit le premier soleil dynamique du `dwsg` `id` (SourcesLumiere.EtatDuMonde)
// d'un module `any`. ErrSansSoleil si id vaut 0 ou si le bloc de soleils est vide ; erreur si le
// tag est absent du module.
func LitParametresSoleil(cheminModuleAny string, id uint32) (ParametresSoleil, error) {
	if id == 0 {
		return ParametresSoleil{}, ErrSansSoleil
	}
	m, err := himodule.Open(cheminModuleAny)
	if err != nil {
		return ParametresSoleil{}, err
	}
	defer func() { _ = m.Close() }()
	f, ok := entreeParID(m, GroupeEtatDuMonde, id)
	if !ok {
		return ParametresSoleil{}, fmt.Errorf("himap: %s %#x absent from %s", GroupeEtatDuMonde, id, cheminModuleAny)
	}
	raw, err := m.Extract(f)
	if err != nil {
		return ParametresSoleil{}, err
	}
	return litSoleilDwsg(raw)
}

// litSoleilDwsg navigue du bloc racine d'un tag `dwsg` a son premier soleil dynamique.
func litSoleilDwsg(raw []byte) (ParametresSoleil, error) {
	ti, err := meilleurTagInfo(raw)
	if err != nil {
		return ParametresSoleil{}, fmt.Errorf("himap: %s: %w", GroupeEtatDuMonde, err)
	}
	racine, err := ti.rootBlockIndex()
	if err != nil {
		return ParametresSoleil{}, err
	}
	rabs, rtaille := ti.blockAbs(racine)
	if dwsgOffSoleils+compteTagBlock+4 > rtaille {
		return ParametresSoleil{}, fmt.Errorf("himap: %s: root block of %#x bytes", GroupeEtatDuMonde, rtaille)
	}
	cible := ti.subBlockTarget(racine, dwsgOffSoleils)
	if cible < 0 || u32(raw, rabs+dwsgOffSoleils+compteTagBlock) == 0 {
		return ParametresSoleil{}, ErrSansSoleil
	}
	abs, taille := ti.blockAbs(cible)
	n := u32(raw, rabs+dwsgOffSoleils+compteTagBlock)
	if taille != n*soleilTaille || abs+taille > len(raw) {
		return ParametresSoleil{}, fmt.Errorf("himap: %s: %d suns over %#x bytes, %#x bytes expected each",
			GroupeEtatDuMonde, n, taille, soleilTaille)
	}
	return litParametresSoleil(raw[abs : abs+soleilTaille])
}

// LitSoleil rend le soleil d'une carte native, lu du `dwsg` que designent ses sources de lumiere.
// ok=false si la carte n'a pas de soleil (aucun `dwsg`, ou cf. ParametresSoleil.Soleil) ; erreur
// si aucun module ne porte son `dwsg` ou si la lecture echoue.
func LitSoleil(src SourcesLumiere) (Soleil, bool, error) {
	if src.EtatDuMonde == 0 {
		return Soleil{}, false, nil
	}
	if src.ModuleEtat == "" {
		return Soleil{}, false, fmt.Errorf("himap: %s %#x not found", GroupeEtatDuMonde, src.EtatDuMonde)
	}
	p, err := LitParametresSoleil(src.ModuleEtat, src.EtatDuMonde)
	if errors.Is(err, ErrSansSoleil) {
		return Soleil{}, false, nil
	}
	if err != nil {
		return Soleil{}, false, err
	}
	s, ok := p.Soleil()
	return s, ok, nil
}
