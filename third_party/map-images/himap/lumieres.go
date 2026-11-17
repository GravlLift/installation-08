// Package himap — lumieres.go : les lumieres posees d'une carte (lampes, projecteurs).
//
// SOURCE : le meme tag `stlm` que les sondes (sondes.go), bloc « runtime lights » a root+0x44,
// 0x2A8 o par lumiere (definition Z-15 `stlm.xml`, verifiee sur Recharge : 113 lumieres, taille
// du bloc egale a 113 x 0x2A8, remplissage 0xBC aux places de remplissage) :
//
//	+0x04 position (3 f32, axes Halo)       +0x10 orientation (3 f32, radians, brute)
//	+0x1C active (octet)                     +0x24 type (0 omni, 1 projecteur, 2 directionnelle,
//	                                                   3 plane, 4 soleil)
//	+0x28 couleur (3 f32, lineaire)          +0x34 energie de la source
//	+0x40 portee (attenuation lointaine)     +0x124 / +0x128 cones interieur / exterieur (degres)
//
// AXE D'UN PROJECTEUR (DirectionProjecteur) : vers le bas (-Z) a orientation nulle, puis incline
// par le deuxieme angle autour de X, puis tourne du premier autour de Z ; le troisieme tourne le
// faisceau sur lui-meme (sans effet sur un cone rond). Mesure sur Recharge, rayons contre la
// geometrie : 64 des 74 projecteurs au deuxieme angle nul ont un plafond a moins de 15 cm au-dessus
// d'eux, quels que soient le premier et le troisieme angle. Le sens de l'inclinaison n'est PAS
// tranche : sur les 21 projecteurs inclines, les huit variantes (axe X ou Y, signe, roulis
// d'abord ou non) font jeu egal ; la variante retenue est la plus plausible.
//
// La lumiere de type soleil est celle que le `dwsg` remplace (soleil.go) : elle n'est pas rendue.
// L'unite de l'energie n'est pas connue : elle se regle contre des captures du jeu.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"fmt"
	"math"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
)

const (
	stlmOffLumieres   = 0x44
	lumiereTaille     = 0x2A8
	lumOffPosition    = 0x04
	lumOffOrient      = 0x10
	lumOffActive      = 0x1C
	lumOffType        = 0x24
	lumOffCouleur     = 0x28
	lumOffEnergie     = 0x34
	lumOffPortee      = 0x40
	lumOffConeInt     = 0x124
	lumOffConeExt     = 0x128
	typeLumiereSoleil = 4
)

// TypeLumiere : l'enum du moteur.
type TypeLumiere int

// Types de lumiere du moteur.
const (
	LumiereOmni TypeLumiere = iota
	LumiereProjecteur
	LumiereDirectionnelle
	LumierePlane
)

// Lumiere : une lumiere posee, active, autre que le soleil.
type Lumiere struct {
	Position    [3]float64
	Orientation [3]float64
	Type        TypeLumiere
	Couleur     [3]float64
	Energie     float64
	Portee      float64
	// ConeInterieur, ConeExterieur : en degrees, pour un projecteur.
	ConeInterieur, ConeExterieur float64
}

// DirectionProjecteur : l'axe du faisceau, unitaire, en axes Halo (cf. l'en-tete).
func DirectionProjecteur(orientation [3]float64) [3]float64 {
	lacet, tangage := orientation[0], -orientation[1]
	// (0, 0, -1) incline autour de X : (0, sin t, -cos t) ; puis tourne autour de Z.
	y, z := math.Sin(tangage), -math.Cos(tangage)
	return [3]float64{-y * math.Sin(lacet), y * math.Cos(lacet), z}
}

// LitLumieres rend les lumieres posees actives, soleil exclu, du `stlm` de la structure jouee
// (SourcesLumiereDe). Une structure sans `stlm` n'en a aucune.
func LitLumieres(s SourcesLumiere) ([]Lumiere, error) {
	if s.LumiereStatique == 0 {
		return nil, nil
	}
	m, err := himodule.Open(s.ModuleStructure)
	if err != nil {
		return nil, err
	}
	defer func() { _ = m.Close() }()
	ti, err := tagLumiereStatique(m, s.LumiereStatique)
	if err != nil {
		return nil, err
	}
	return litBlocLumieres(ti)
}

func litBlocLumieres(ti tagInfo) ([]Lumiere, error) {
	tag := ti.tag
	racine, err := ti.rootBlockIndex()
	if err != nil {
		return nil, err
	}
	rabs, rtaille := ti.blockAbs(racine)
	if stlmOffLumieres+compteTagBlock+4 > rtaille {
		return nil, fmt.Errorf("himap: %s: root block of %#x bytes", GroupeLumiereStatique, rtaille)
	}
	n := u32(tag, rabs+stlmOffLumieres+compteTagBlock)
	cible := ti.subBlockTarget(racine, stlmOffLumieres)
	if n == 0 || cible < 0 {
		return nil, nil
	}
	abs, taille := ti.blockAbs(cible)
	if taille != n*lumiereTaille || abs+taille > len(tag) {
		return nil, fmt.Errorf("himap: %s: %d lights over %#x bytes, %#x bytes expected each",
			GroupeLumiereStatique, n, taille, lumiereTaille)
	}
	var out []Lumiere
	for i := 0; i < n; i++ {
		o := abs + i*lumiereTaille
		t := i32(tag, o+lumOffType)
		if tag[o+lumOffActive] == 0 || t == typeLumiereSoleil {
			continue
		}
		l := Lumiere{
			Type: TypeLumiere(t), Energie: f32(tag, o+lumOffEnergie), Portee: f32(tag, o+lumOffPortee),
			ConeInterieur: f32(tag, o+lumOffConeInt), ConeExterieur: f32(tag, o+lumOffConeExt),
		}
		for k := 0; k < 3; k++ {
			l.Position[k] = f32(tag, o+lumOffPosition+4*k)
			l.Orientation[k] = f32(tag, o+lumOffOrient+4*k)
			l.Couleur[k] = f32(tag, o+lumOffCouleur+4*k)
		}
		out = append(out, l)
	}
	return out, nil
}
