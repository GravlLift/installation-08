// Package himap — moduleindex.go : resoudre un GlobalID de tag a travers PLUSIEURS modules.
//
// POURQUOI, ET C'EST MESURE (2026-08-08, ridgeline, 10 357 instances). Les references de
// geometrie d'une carte ne pointent PAS toutes dans le module de cette carte : 324 des 548
// references distinctes y sont, mais 70 vivent dans `globals/common`, 102 dans
// `globals/multiplayer` et 29 dans `globals/multiplayer_r3`. Le module de la carte ne
// couvre que **26 % des instances**. Une chaine « une carte = un module » rendrait donc une
// carte aux trois quarts vide en se croyant complete.
//
// Le handoff ne signalait ce piege que pour la COLLISION ; il vaut aussi pour le rendu.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
)

// ModuleIndex resout un GlobalID de tag vers l'entree qui le porte, sur un ensemble de
// modules ouverts.
type ModuleIndex struct {
	modules []*himodule.Module
	chemins []string
	parID   map[uint32]refEntree
}

type refEntree struct {
	module  int
	fichier himodule.File
}

// NewModuleIndex ouvre les modules donnes et indexe leurs entrees par GlobalID.
//
// Un module illisible est une ERREUR, jamais un silence : un index partiel rendrait une
// carte trouee sans que rien ne le dise.
func NewModuleIndex(chemins ...string) (*ModuleIndex, error) {
	idx := &ModuleIndex{parID: map[uint32]refEntree{}}
	for _, p := range chemins {
		m, err := himodule.Open(p)
		if err != nil {
			return nil, fmt.Errorf("himap: open %s: %w", p, err)
		}
		i := len(idx.modules)
		idx.modules = append(idx.modules, m)
		idx.chemins = append(idx.chemins, p)
		for _, f := range m.Files("") {
			// Premier arrive, premier servi : le module de la carte est passe en tete, il
			// doit primer sur un homonyme global.
			if _, deja := idx.parID[f.GlobalID]; !deja {
				idx.parID[f.GlobalID] = refEntree{module: i, fichier: f}
			}
		}
	}
	return idx, nil
}

// Close relache les modules ouverts par l'index.
//
// POURQUOI CA COMPTE ICI PLUS QU'AILLEURS. Un index couvre la carte PLUS tous les modules
// globaux — 16,2 Go d'archives sur l'installation de reference (`globals` 7,4 Go, `common`
// 2,7 Go, `multiplayer` 0,9 Go, plus leurs compagnons `_hd1`) — et la cuisson en construit
// un PAR CARTE. Vingt-six cartes sans fermeture, ce sont vingt-six jeux de projections tenues
// jusqu'a la fin du processus.
//
// Rend la PREMIERE erreur rencontree, apres avoir tente de fermer tous les modules : abandonner
// au premier echec laisserait les suivants ouverts.
func (idx *ModuleIndex) Close() error {
	var premiere error
	for _, m := range idx.modules {
		if err := m.Close(); err != nil && premiere == nil {
			premiere = err
		}
	}
	idx.modules, idx.parID = nil, nil
	return premiere
}

// GeometrySearchPath rend l'ordre de recherche d'une carte : son module d'abord, puis les
// modules globaux. C'est cet ordre qui donne la priorite au contenu de la carte.
func GeometrySearchPath(deployRoot, moduleCarte string) ([]string, error) {
	chemins := []string{moduleCarte}
	globs, err := filepath.Glob(filepath.Join(deployRoot, "pc", "globals", "*.module"))
	if err != nil {
		return nil, err
	}
	for _, g := range globs {
		if _, err := os.Stat(g); err == nil {
			chemins = append(chemins, g)
		}
	}
	return chemins, nil
}

// GeometrySearchPathMonde ajoute a GeometrySearchPath le module de geometrie des objets Forge
// (la structure de certaines cartes natives pose des objets du catalogue Forge comme instances de
// son sbsp, et leurs `rtgo` ne vivent que la), puis les modules `any` de CheminsMateriaux, ou
// vivent les tags des objets que pose le scenario (`scen`, `mach`, `bloc`, `hlmt`). Places en
// dernier, ils ne priment sur aucune geometrie `pc`. Le rendu vu du dessus garde
// GeometrySearchPath.
func GeometrySearchPathMonde(deployRoot, moduleCarte string) ([]string, error) {
	chemins, err := GeometrySearchPath(deployRoot, moduleCarte)
	if err != nil {
		return nil, err
	}
	if p := cheminGeometrieForge(deployRoot); existeFichier(p) {
		chemins = append(chemins, p)
	}
	objets, err := CheminsMateriaux(deployRoot, moduleCarte)
	if err != nil {
		return nil, err
	}
	return append(chemins, objets...), nil
}

// moduleScenario rend le module dont le `levl` pose les objets du scenario : celui de la carte.
func (o OptionsCuisson) moduleScenario() string {
	if o.CheminModuleCarte != "" {
		return o.CheminModuleCarte
	}
	return o.CheminModule
}

// modulesCarteDeportee rend, pour une carte dont la geometrie vit dans un autre module (Live
// Fire), le module de la carte et son jumeau `any` : ils portent les tags des objets que pose son
// scenario et leurs materiaux. Places en dernier, ils ne priment sur rien de ce que la geometrie
// trouve deja. Rien pour une carte qui porte sa geometrie.
func (o OptionsCuisson) modulesCarteDeportee() []string {
	if o.CheminModuleCarte == "" || o.CheminModuleCarte == o.CheminModule {
		return nil
	}
	out := []string{o.CheminModuleCarte}
	if j, ok := jumeauAny(o.RacineDeploy, o.CheminModuleCarte); ok {
		out = append(out, j)
	}
	return out
}

// jumeauAny rend le module `any` jumeau d'un module `pc`, s'il existe.
func jumeauAny(deployRoot, modulePC string) (string, bool) {
	rel, err := filepath.Rel(filepath.Join(deployRoot, "pc"), modulePC)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", false
	}
	jumeau := filepath.Join(deployRoot, "any", rel)
	return jumeau, existeFichier(jumeau)
}

// cheminGeometrieForge rend le module `pc` des objets Forge : leurs `rtgo` et leurs bitmaps.
func cheminGeometrieForge(deployRoot string) string {
	return filepath.Join(deployRoot, "pc", "globals", "forge", "forge_objects-rtx-new.module")
}

// cheminDefinitionsForge rend le module `any` des objets Forge : leurs definitions `food`, dont
// le GlobalID est le type_id d'un objet du `.mvar`.
func cheminDefinitionsForge(deployRoot string) string {
	return filepath.Join(deployRoot, "any", "globals", "forge", "forge_objects-rtx-new.module")
}

// Lookup dit si un GlobalID est connu, et de quel module il vient.
func (idx *ModuleIndex) Lookup(id uint32) (groupe, module string, ok bool) {
	e, ok := idx.parID[id]
	if !ok {
		return "", "", false
	}
	return e.fichier.Group, idx.chemins[e.module], true
}

// Extract rend les octets decompresses du tag d'un GlobalID.
func (idx *ModuleIndex) Extract(id uint32) ([]byte, error) {
	e, ok := idx.parID[id]
	if !ok {
		return nil, fmt.Errorf("himap: GlobalID %#x absent from the %d indexed modules", id, len(idx.modules))
	}
	return idx.modules[e.module].Extract(e.fichier)
}

// ExtractWithResources rend les octets du tag ET son blob de ressources.
//
// Les deux vont ensemble : le tag ne porte que des descripteurs, dont les offsets designent
// des octets du blob. Les separer serait offrir un decodage a moitie.
func (idx *ModuleIndex) ExtractWithResources(id uint32) (tag, blob []byte, err error) {
	e, ok := idx.parID[id]
	if !ok {
		return nil, nil, fmt.Errorf("himap: GlobalID %#x absent from the %d indexed modules", id, len(idx.modules))
	}
	m := idx.modules[e.module]
	tag, err = m.Extract(e.fichier)
	if err != nil {
		return nil, nil, err
	}
	blob, err = m.ResourceBlob(e.fichier)
	if err != nil {
		return nil, nil, err
	}
	return tag, blob, nil
}

// entree rend le module et l'entree d'un GlobalID, pour les lecteurs qui choisissent eux-memes
// parmi les ressources (les niveaux de mip d'un bitmap).
func (idx *ModuleIndex) entree(id uint32) (*himodule.Module, himodule.File, bool) {
	e, ok := idx.parID[id]
	if !ok {
		return nil, himodule.File{}, false
	}
	return idx.modules[e.module], e.fichier, true
}

// Taille rend le nombre d'entrees indexees (diagnostic).
func (idx *ModuleIndex) Taille() int { return len(idx.parID) }
