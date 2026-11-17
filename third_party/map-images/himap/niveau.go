// Package himap — niveau.go : quelle lumiere va avec quelle structure, lu du scenario.
//
// Un module porte souvent plusieurs sbsp et autant de `stlm` : la structure jouee et un decor
// lointain, ou les quatre structures du module commun que se partagent Live Fire et le tutoriel.
// Le scenario (`levl`) de la carte dit quel `stlm` eclaire quel sbsp, et quel etat du monde
// (`dwsg`, le soleil) vaut pour la carte.
//
// SOURCE : le tag `levl` du module `pc` de la carte. Mesure sur les 26 cartes installees : chaque
// sbsp et chaque `stlm` de leurs modules y est nomme, une fois, par sa structure.
//
//	racine +0x7AC : bloc des structures, 0xDC o par structure
//	  +0x00 reference du sbsp
//	  +0x60 bloc de sa lumiere, 0 ou 1 entree de 0x7C o : +0x04 reference du `stlm`
//	racine +0xAEC : reference du `dwsg`
//
// Une reference porte le GlobalID de sa cible a refOffGlobalID ; une reference vide vaut
// 0xFFFFFFFF.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
)

const (
	levlChampStructures    = 0x7AC
	levlStrideStructure    = 0xDC
	levlStructureOffBSP    = 0x00
	levlStructureChampLum  = 0x60
	levlStrideLumiere      = 0x7C
	levlLumiereOffSTLM     = 0x04
	levlOffEtatDuMonde     = 0xAEC
	referenceVide          = 0xFFFFFFFF
	groupeScenario         = "levl"
	nomVarianteRendu       = "pc"
	nomVarianteDefinitions = "any"
)

// StructureNiveau : une structure du scenario. LumiereStatique vaut 0 quand elle n'en a pas.
type StructureNiveau struct {
	BSP             uint32
	LumiereStatique uint32
}

// Niveau : les structures du scenario d'une carte, et son etat du monde (0 = aucun).
type Niveau struct {
	EtatDuMonde uint32
	Structures  []StructureNiveau
}

// LitNiveau lit le scenario du module `pc` d'une carte native.
func LitNiveau(cheminModuleCarte string) (Niveau, error) {
	m, err := himodule.Open(cheminModuleCarte)
	if err != nil {
		return Niveau{}, err
	}
	defer func() { _ = m.Close() }()
	levls := m.Files(groupeScenario)
	if len(levls) != 1 {
		return Niveau{}, fmt.Errorf("himap: %d %s tags in %s (1 expected)", len(levls), groupeScenario, cheminModuleCarte)
	}
	ti, err := tagDeEntree(m, levls[0])
	if err != nil {
		return Niveau{}, fmt.Errorf("himap: %s: %w", groupeScenario, err)
	}
	return litNiveau(ti)
}

func litNiveau(ti tagInfo) (Niveau, error) {
	racine, err := ti.rootBlockIndex()
	if err != nil {
		return Niveau{}, err
	}
	rabs, rtaille := ti.blockAbs(racine)
	if levlOffEtatDuMonde+refOffGlobalID+4 > rtaille {
		return Niveau{}, fmt.Errorf("himap: %s: root block of %#x bytes", groupeScenario, rtaille)
	}
	out := Niveau{EtatDuMonde: idReference(ti.tag, rabs+levlOffEtatDuMonde)}
	n := u32(ti.tag, rabs+levlChampStructures+compteTagBlock)
	cible := ti.subBlockTarget(racine, levlChampStructures)
	if n == 0 || cible < 0 {
		return out, nil
	}
	abs, taille := ti.blockAbs(cible)
	if taille != n*levlStrideStructure || abs+taille > len(ti.tag) {
		return Niveau{}, fmt.Errorf("himap: %s: %d structures over %#x bytes, %#x bytes expected each",
			groupeScenario, n, taille, levlStrideStructure)
	}
	for k := 0; k < n; k++ {
		o := abs + k*levlStrideStructure
		s := StructureNiveau{BSP: idReference(ti.tag, o+levlStructureOffBSP)}
		if u32(ti.tag, o+levlStructureChampLum+compteTagBlock) > 0 {
			l := ti.subBlockTarget(cible, k*levlStrideStructure+levlStructureChampLum)
			if l < 0 {
				return Niveau{}, fmt.Errorf("himap: %s: structure %d without a light block", groupeScenario, k)
			}
			labs, ltaille := ti.blockAbs(l)
			if ltaille < levlStrideLumiere || labs+ltaille > len(ti.tag) {
				return Niveau{}, fmt.Errorf("himap: %s: light of structure %d over %#x bytes", groupeScenario, k, ltaille)
			}
			s.LumiereStatique = idReference(ti.tag, labs+levlLumiereOffSTLM)
		}
		out.Structures = append(out.Structures, s)
	}
	return out, nil
}

// idReference rend le GlobalID d'une reference de tag, 0 pour une reference vide.
func idReference(tag []byte, o int) uint32 {
	id := uint32(u32(tag, o+refOffGlobalID))
	if id == referenceVide {
		return 0
	}
	return id
}

// SourcesLumiere : ou lire la lumiere de la structure jouee d'une carte.
type SourcesLumiere struct {
	// ModuleStructure : le module `pc` qui porte le sbsp et son `stlm`.
	ModuleStructure string
	// LumiereStatique : le GlobalID du `stlm` de la structure ; 0 = aucune lumiere cuite.
	LumiereStatique uint32
	// ModuleEtat : le module `any` qui porte le `dwsg` ; vide quand aucun ne le porte.
	ModuleEtat string
	// EtatDuMonde : le GlobalID du `dwsg` de la carte ; 0 = aucun.
	EtatDuMonde uint32
}

// SourcesLumiereDe resout la lumiere du sbsp `bsp` (MaillageMonde.BSP) : le scenario vient du
// module de la carte, la structure du module de geometrie (le meme, sauf carte deportee). Le
// `dwsg` est cherche dans la variante `any` de l'un puis de l'autre. Erreur quand le scenario est
// illisible ou ne nomme pas ce sbsp.
func SourcesLumiereDe(cheminModuleCarte, cheminModuleGeometrie string, bsp uint32) (SourcesLumiere, error) {
	n, err := LitNiveau(cheminModuleCarte)
	if err != nil {
		return SourcesLumiere{}, err
	}
	out := SourcesLumiere{ModuleStructure: cheminModuleGeometrie, EtatDuMonde: n.EtatDuMonde}
	trouve := false
	for _, s := range n.Structures {
		if s.BSP == bsp {
			out.LumiereStatique, trouve = s.LumiereStatique, true
			break
		}
	}
	if !trouve {
		return SourcesLumiere{}, fmt.Errorf("himap: the scenario of %s does not name sbsp %#x", filepath.Base(cheminModuleCarte), bsp)
	}
	if out.EtatDuMonde != 0 {
		out.ModuleEtat = moduleQuiPorte([]string{cheminModuleCarte, cheminModuleGeometrie}, GroupeEtatDuMonde, out.EtatDuMonde)
	}
	return out, nil
}

// moduleQuiPorte rend la variante `any` du premier module qui porte le tag `id`, vide sinon.
func moduleQuiPorte(cheminsPC []string, groupe string, id uint32) string {
	for _, c := range cheminsPC {
		a, ok := varianteDefinitions(c)
		if !ok {
			continue
		}
		m, err := himodule.Open(a)
		if err != nil {
			continue
		}
		_, porte := entreeParID(m, groupe, id)
		_ = m.Close()
		if porte {
			return a
		}
	}
	return ""
}

// varianteDefinitions rend le meme module dans la variante `any` du depot, quel que soit son
// dossier (`levels/multi/<carte>` comme `globals`) : seul le dossier de variante change.
// ModuleVariante, elle, ne connait que les dossiers de cartes.
func varianteDefinitions(cheminPC string) (string, bool) {
	parties := strings.Split(filepath.Clean(cheminPC), string(filepath.Separator))
	for i := len(parties) - 1; i >= 0; i-- {
		if !strings.EqualFold(parties[i], nomVarianteRendu) {
			continue
		}
		parties[i] = nomVarianteDefinitions
		p := strings.Join(parties, string(filepath.Separator))
		if _, err := os.Stat(p); err != nil {
			return "", false
		}
		return p, true
	}
	return "", false
}
