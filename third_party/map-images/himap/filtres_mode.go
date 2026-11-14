// Package himap — filtres_mode.go (LOCAL-CHANGE (infinite-theater-3d)) : les objets d'une
// variante que le mode de jeu de la partie ne cree pas.
//
// Un objet du `.mvar` porte des labels de mode : `<mode>_include` (il n'existe que dans ce mode)
// et `<mode>_exclude` (il n'existe pas dans ce mode), voir mapvar/objectives.go. Un objet qui
// porte plusieurs `_include` existe dans chacun de ces modes (une zone de Bastion qui sert aussi
// de colline). La couche d'objets se construit pour UNE partie, donc pour son mode : elle garde
// un objet sans filtre d'inclusion, ou dont un filtre d'inclusion est celui du mode, et ecarte
// celui qu'un filtre d'exclusion du mode retire.
//
// CE QUE CELA RETIRE d'une partie a Slayer : les socles de drapeau (`ctf_include`), le point
// d'apparition du crane (`oddball_include`), les reperes au sol des zones (type -877512201,
// `strongholds_include`, `landgrab_include`, `firefight_include` et le filtre de KOTH connu par
// son seul hash) et les objets du seul mode Infection, deja ecartes avant ce fichier.
package himap

import (
	"strings"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

// FiltresMode sont les labels de mode (par hash) que le mode de la partie active : ses filtres
// d'inclusion et ses filtres d'exclusion. La valeur zero est une partie sans mode connu : aucun
// objet a filtre d'inclusion n'y est cree.
type FiltresMode struct {
	Inclus map[int32]bool
	Exclus map[int32]bool
}

// suffixeInclusion : le suffixe des labels de filtre d'inclusion par mode (mapvar.isModeIncludeLabel).
const suffixeInclusion = "_include"

// estFiltreInclusion dit si un label est un filtre d'inclusion par mode : un label resolu en
// `<mode>_include`, ou le filtre de KOTH, dont le nom n'est pas retrouve mais le role etabli.
// Un hash non resolu n'est jamais juge.
func estFiltreInclusion(h int32) bool {
	if h == mapvar.LabelHashHillInclude {
		return true
	}
	n := mapvar.LabelName(h)
	return len(n) > len(suffixeInclusion) && strings.HasSuffix(n, suffixeInclusion)
}

// ecarte dit si le mode ne cree pas l'objet : un de ses labels est un filtre d'exclusion du mode,
// ou il porte des filtres d'inclusion dont aucun n'est celui du mode.
func (f FiltresMode) ecarte(o mapvar.Object) bool {
	inclus, actif := false, false
	for _, h := range o.Labels {
		if f.Exclus[h] {
			return true
		}
		if estFiltreInclusion(h) {
			inclus = true
			actif = actif || f.Inclus[h]
		}
	}
	return inclus && !actif
}
