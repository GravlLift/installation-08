// Package himap — glb_emissif.go : la lumiere propre d'un materiau dans le GLB.
//
// glTF standard : `emissiveFactor` (couleur lineaire, chaque composante dans [0, 1]) et, pour
// une force au-dela de 1, l'extension `KHR_materials_emissive_strength`. Une couleur du jeu
// au-dessus de 1 est ramenee dans [0, 1] et son excedent passe dans la force : couleur x force
// reste la valeur du jeu.
package himap

const extEmissiveStrength = "KHR_materials_emissive_strength"

func appliqueEmissif(doc *gltfDoc, g *gltfMaterial, e Emissif) {
	plus := max(e.Couleur[0], e.Couleur[1], e.Couleur[2])
	if plus <= 0 || e.Force <= 0 {
		return
	}
	echelle := max(plus, 1)
	c := [3]float32{e.Couleur[0] / echelle, e.Couleur[1] / echelle, e.Couleur[2] / echelle}
	g.EmissiveFactor = &c
	force := e.Force * echelle
	if force == 1 {
		return
	}
	if g.Extensions == nil {
		g.Extensions = map[string]any{}
	}
	g.Extensions[extEmissiveStrength] = map[string]any{"emissiveStrength": force}
	for _, x := range doc.ExtUsed {
		if x == extEmissiveStrength {
			return
		}
	}
	doc.ExtUsed = append(doc.ExtUsed, extEmissiveStrength)
}
