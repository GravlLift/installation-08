// Package himap — glb_lumieres.go : les lumieres posees publiees dans le GLB.
//
// `scenes[0].extras.levelupLights` : une entree par lampe omni ou projecteur (les autres types
// ne sont pas publies), `{"type": "omni" | "spot", "position": [x, y, z], "direction": [x, y,
// z], "color": [r, g, b], "energy": e, "range": r, "cone": [interieur, exterieur]}`. Position et
// direction du faisceau (DirectionProjecteur) en AXES HALO, cones entiers en degres.
package himap

// CleLumieresGLB : la cle de `scenes[0].extras` qui porte les lumieres posees.
const CleLumieresGLB = "levelupLights"

var nomsTypesLumiere = map[TypeLumiere]string{LumiereOmni: "omni", LumiereProjecteur: "spot"}

// extrasLumieres rend la liste publiable ; nil si aucune lampe n'est d'un type publie.
func extrasLumieres(ls []Lumiere) []map[string]any {
	var out []map[string]any
	for _, l := range ls {
		nom, ok := nomsTypesLumiere[l.Type]
		if !ok {
			continue
		}
		out = append(out, map[string]any{
			"type": nom, "position": l.Position, "direction": DirectionProjecteur(l.Orientation), "color": l.Couleur,
			"energy": l.Energie, "range": l.Portee, "cone": [2]float64{l.ConeInterieur, l.ConeExterieur},
		})
	}
	return out
}
