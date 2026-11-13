// Package himap — glb_objets.go : les objets poses d'une couche de variante, publies dans le GLB.
//
// `scenes[0].extras.levelupObjects` : une entree par objet pose, `{"index": i, "type": t, "min":
// [x, y, z], "max": [x, y, z]}`. `index` est le rang de l'objet dans le `.mvar`, `type` son
// type_id, `min`/`max` la boite monde de ses sommets poses, en AXES HALO. La couche est fondue par
// materiau : cette table est le seul moyen de designer un objet dans la vue (inspecteur de
// surfaces).
package himap

// CleObjetsGLB : la cle de `scenes[0].extras` qui porte les objets poses.
const CleObjetsGLB = "levelupObjects"

// ObjetPose est un objet de variante pose : son rang dans le `.mvar`, son type et sa boite monde.
type ObjetPose struct {
	Index    int
	Type     int32
	Min, Max [3]float64
}

// extrasObjets rend la liste publiable ; nil sans objet pose.
func extrasObjets(objets []ObjetPose) []map[string]any {
	if len(objets) == 0 {
		return nil
	}
	out := make([]map[string]any, 0, len(objets))
	for _, o := range objets {
		out = append(out, map[string]any{"index": o.Index, "type": o.Type, "min": o.Min, "max": o.Max})
	}
	return out
}

// boiteDesSommets rend la boite des sommets `x,y,z` a la suite ; ok = faux sans sommet.
func boiteDesSommets(s []float32) (mn, mx [3]float64, ok bool) {
	if len(s) < 3 {
		return mn, mx, false
	}
	for a := range 3 {
		mn[a], mx[a] = float64(s[a]), float64(s[a])
	}
	for i := 3; i+2 < len(s); i += 3 {
		for a := range 3 {
			v := float64(s[i+a])
			mn[a], mx[a] = min(mn[a], v), max(mx[a], v)
		}
	}
	return mn, mx, true
}

// uneBoite rend la boite qui couvre a et b.
func uneBoite(amn, amx, bmn, bmx [3]float64) (mn, mx [3]float64) {
	for a := range 3 {
		mn[a], mx[a] = min(amn[a], bmn[a]), max(amx[a], bmx[a])
	}
	return mn, mx
}
