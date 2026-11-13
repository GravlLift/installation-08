// Package himap — glb_sondes.go : la lumiere cuite (sondes d'irradiance) publiee dans le GLB.
//
// `scenes[0].extras.levelupProbes` :
//
//	{"tile": 8, "regions": [{"min": [x, y, z], "max": [x, y, z], "count": [nx, ny, nz],
//	  "priority": p, "blend": [xy, z], "irradiance": <bufferView>}, ...]}
//
// Bornes en AXES HALO, comme le soleil ; chaque `irradiance` designe une vue du tampon binaire
// qui porte les texels R11G11B10 de la region tels que le jeu les stocke (repere de l'octaedre et
// rangement : en-tete de sondes.go).
package himap

// CleSondesGLB : la cle de `scenes[0].extras` qui porte les sondes de la carte.
const CleSondesGLB = "levelupProbes"

// ajouteSondes verse l'irradiance de chaque region dans le tampon et rend la description des
// regions ; nil sans sondes.
func ajouteSondes(doc *gltfDoc, bin *tamponGLB, s *SondesLumiere) map[string]any {
	if s == nil || len(s.Regions) == 0 {
		return nil
	}
	regions := make([]map[string]any, 0, len(s.Regions))
	for _, r := range s.Regions {
		bin.aligne4()
		off := bin.Len()
		bin.ajoute(r.Irradiance)
		doc.BufferViews = append(doc.BufferViews, gltfBufferView{ByteOffset: off, ByteLength: len(r.Irradiance)})
		regions = append(regions, map[string]any{
			"min": r.Min, "max": r.Max, "count": r.Nombre, "priority": r.Priorite,
			"blend": [2]float64{r.FonduXY, r.FonduZ}, "irradiance": len(doc.BufferViews) - 1,
		})
	}
	return map[string]any{"tile": TuileSonde, "regions": regions}
}
