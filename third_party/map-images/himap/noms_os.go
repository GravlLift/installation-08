// Package himap — noms_os.go : le nom en clair des noeuds d'un squelette.
//
// Un noeud ne porte que le StringID de son nom, le murmur3 du texte (`mapvar.LabelHash`) : le
// texte n'est dans aucun tag. Il se retrouve en hachant un vocabulaire et en gardant les mots qui
// retombent sur un StringID du squelette. Le vocabulaire est celui des squelettes de Spartan
// (`b_` puis, pour un membre, le cote `l_` ou `r_`, la piece, un rang facultatif, un role
// facultatif et un second rang) ; un mot n'est retenu que si son hachage est celui du tag, jamais
// devine. Un noeud que le vocabulaire ne couvre pas garde un nom tire de son StringID.
package himap

import (
	"fmt"
	"sync"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

// Vocabulaire des noms de noeuds.
var (
	piecesCorps = []string{"pedestal", "aim_pitch", "aim_yaw", "pelvis", "spine", "neck", "head",
		"helmet", "camera", "torso", "abarmor", "backpack", "backarmor"}
	piecesMembre = []string{"thigh", "knee", "calf", "upperleg", "foot", "toe", "clav", "upperarm",
		"scap", "lowerback_armor", "shoulder", "forearm", "elbow", "elbow_armor", "hand", "wrist",
		"grip", "thumb", "index", "middle", "ring", "pinky"}
	rolesNoeud = []string{"", "_helper", "_fixup", "_twist", "_jiggle"}
	cotesNoeud = []string{"l_", "r_"}
)

// rangsNoeud : un rang absent, puis 0 a 4.
var rangsNoeud = []string{"", "0", "1", "2", "3", "4"}

var (
	nomsNoeudsUneFois sync.Once
	nomsNoeuds        map[uint32]string
)

// NomDuNoeud rend le nom en clair du StringID `id`, ou `noeud_<id>` hors vocabulaire.
func NomDuNoeud(id uint32) string {
	nomsNoeudsUneFois.Do(func() { nomsNoeuds = vocabulaireNoeuds() })
	if n, ok := nomsNoeuds[id]; ok {
		return n
	}
	return fmt.Sprintf("noeud_%08x", id)
}

// vocabulaireNoeuds hache chaque nom du vocabulaire.
func vocabulaireNoeuds() map[uint32]string {
	out := map[uint32]string{}
	ajoute := func(prefixe string, pieces []string) {
		for _, p := range pieces {
			for _, r1 := range rangsNoeud {
				for _, role := range rolesNoeud {
					for _, r2 := range rangsNoeud {
						nom := prefixe + p + r1 + role + r2
						out[uint32(mapvar.LabelHash(nom))] = nom
					}
				}
			}
		}
	}
	ajoute("b_", piecesCorps)
	for _, c := range cotesNoeud {
		ajoute("b_"+c, piecesMembre)
	}
	return out
}
