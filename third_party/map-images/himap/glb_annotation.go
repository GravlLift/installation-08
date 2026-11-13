// Package himap — glb_annotation.go : les extras des materiaux d'un GLB completes par l'appelant.
//
// Ce que le lecteur ne tire pas des tags (le style de revetement d'un materiau, lu a la construction
// dans une reference externe) s'ajoute apres l'ecriture, par la meme lecture generique que
// glb_images_externes.go : le document est relu en JSON (nombres en texte), chaque materiau passe a
// l'appelant avec ses extras, et tout champ inconnu passe tel quel.
package himap

import (
	"bytes"
	"encoding/json"
)

// AnnoteMateriauxGLB rend le GLB dont `annote` a pu modifier les extras de chaque materiau (nombres
// en json.Number) ; un materiau sans extras en recoit une table vide. Le GLB est rendu tel quel
// quand `annote` ne change rien.
func AnnoteMateriauxGLB(glb []byte, annote func(extras map[string]any) bool) ([]byte, error) {
	doc, bin, err := ouvreGLB(glb)
	if err != nil {
		return nil, err
	}
	mats, _ := doc["materials"].([]any)
	change := false
	for _, x := range mats {
		mat, _ := x.(map[string]any)
		if mat == nil {
			continue
		}
		extras, _ := mat["extras"].(map[string]any)
		if extras == nil {
			extras = map[string]any{}
		}
		if annote(extras) {
			mat["extras"] = extras
			change = true
		}
	}
	if !change {
		return glb, nil
	}
	var out bytes.Buffer
	if err := ecritGLBGenerique(&out, doc, bin); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// NombreJSON lit un entier non signe 32 bits d'une valeur d'extras relue (json.Number) ; faux sinon.
func NombreJSON(v any) (uint32, bool) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, false
	}
	i, err := n.Int64()
	if err != nil || i < 0 || i > 0xffffffff {
		return 0, false
	}
	return uint32(i), true
}
