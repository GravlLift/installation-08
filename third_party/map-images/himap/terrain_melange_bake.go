// Package himap — terrain_melange_bake.go : bakes a terrain's palette blend into the layered
// material the viewer draws (LOCAL-CHANGE (infinite-theater-3d), see terrain_melange.go).
package himap

import (
	"fmt"
	"image"
	"log/slog"
	"math"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
)

// coteCouleurPalette : the size a palette color map is read at to measure its average color;
// terrainRugositeMin : the roughness of the packed map's darkest red.
const (
	coteCouleurPalette = 64
	terrainRugositeMin = 0.8
	// terrainIntensiteNormale : the ground's normal maps are authored for a lit relief seen at
	// player height; at full strength the dirt reads as crumpled foil.
	terrainIntensiteNormale = 0.5
)

// melangeCuit is a terrain's baked blend: its material, the synthetic textures it references
// (mask atlas, white), and the atlas frame in world units (x0, top y, width, height).
type melangeCuit struct {
	materiau Materiau
	textures map[uint32]Texture
	atlas    [4]float64
	aires    []float64
}

// IDs of the synthetic textures of a terrain, derived from its tag ID.
func idsSynthetiques(terrain uint32) (masque, blanc uint32) {
	return terrain ^ 0xa5000000, terrain ^ 0xa6000000
}

// cuitMelangeTerrain evaluates every node's weight programs over the tiles read, groups the
// palette into at most four looks and bakes the sequential mask. ok=false when the terrain has
// no readable blend (the caller then keeps the single palette color).
func cuitMelangeTerrain(idx *ModuleIndex, s sourceTerrain, p plageTerrain, tuiles []tuileTerrain, noeuds []int, id uint32, caps TextureCaps) (melangeCuit, bool) {
	var out melangeCuit
	mel, ok := litMelangeTerrain(s)
	if !ok || len(tuiles) == 0 {
		return out, false
	}
	mod, file, ok := idx.entree(s.bitmap)
	if !ok {
		return out, false
	}
	ressources, err := mod.Ressources(file)
	if err != nil {
		return out, false
	}
	lit := newDecodeCache(mod, ressources).lit
	echantillonGPU := echantillonneurGPU(idx, mel, caps)
	tx, ty := p.x1-p.x0+1, p.y1-p.y0+1
	W, H := tx*terrainCellules, ty*terrainCellules
	np := len(mel.palette)
	poids := make([][]float32, np)
	for i := range poids {
		poids[i] = make([]float32, W*H)
	}
	lus := 0
	for i, t := range tuiles {
		entrees := entreesNoeud(s, noeuds[i], lit, echantillonGPU)
		coin := [2]float64{p.origine[0] + float64(t.X*terrainCellules)*p.pas[0], p.origine[1] + float64(t.Y*terrainCellules)*p.pas[1]}
		pn := mel.poidsNoeud(s, noeuds[i], entrees, coin, p.pas)
		if pn == nil {
			continue
		}
		lus++
		ox, oy := (t.X-p.x0)*terrainCellules, (p.y1-t.Y)*terrainCellules
		for k, w := range pn {
			if w == nil {
				continue
			}
			for y := 0; y < terrainCellules; y++ {
				copy(poids[k][(oy+y)*W+ox:(oy+y)*W+ox+terrainCellules], w[y*terrainCellules:(y+1)*terrainCellules])
			}
		}
	}
	if lus == 0 {
		return out, false
	}
	// Normalize per cell and measure each entry's area as the cells it wins: overlapping layers
	// (Live Fire's grass and dry grass share their cells) would otherwise split a look that
	// covers most of the ground below one that wins nowhere.
	aires := make([]float64, np)
	for c := 0; c < W*H; c++ {
		total := float32(0)
		for k := range poids {
			total += poids[k][c]
		}
		if total <= 0 {
			continue
		}
		best := 0
		for k := range poids {
			poids[k][c] /= total
			if poids[k][c] > poids[best][c] {
				best = k
			}
		}
		aires[best]++
	}
	couleurs := make([][3]float32, np)
	for k, e := range mel.palette {
		couleurs[k] = e.teinte
		if e.couleur == 0 {
			for c := range couleurs[k] {
				couleurs[k][c] = (e.degrade[0][c] + e.degrade[1][c] + e.degrade[2][c]) / 3
			}
			continue
		}
		if t, err := LitBitmap(idx, e.couleur, coteCouleurPalette); err == nil {
			m := couleurMoyenneLineaire(t.Image)
			for c := range couleurs[k] {
				couleurs[k][c] *= m[c]
			}
		}
	}
	groupe, reps := groupesPalette(aires, couleurs)
	masque := image.NewNRGBA(image.Rect(0, 0, W, H))
	for c := 0; c < W*H; c++ {
		var g [terrainGroupesMax]float32
		total := float32(0)
		for k := range poids {
			g[groupe[k]] += poids[k][c]
			total += poids[k][c]
		}
		if total <= 0 {
			g[0] = 1
		}
		m := masqueSequentiel(g)
		masque.Pix[c*4], masque.Pix[c*4+1], masque.Pix[c*4+2], masque.Pix[c*4+3] = 255, octet(float64(m[0])), octet(float64(m[1])), octet(float64(m[2]))
	}
	idMasque, idBlanc := idsSynthetiques(id)
	blanc := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	for i := range blanc.Pix {
		blanc.Pix[i] = 255
	}
	couches := make([]Couche, 0, len(reps))
	for _, r := range reps {
		e := mel.palette[r]
		k := Couche{Sorte: CoucheCouleur, Bitmap: e.couleur, Transfo: Transfo{Echelle: e.echelle}, Teinte: e.teinte, Opacite: 1,
			Normale: e.normale, TransfoNormale: Transfo{Echelle: e.echelle}, IntensiteNormale: terrainIntensiteNormale,
			// Ground is matte: the packed map's red (the viewer's roughness channel) is remapped
			// into a rough range and nothing is metal, else the grass reads wet.
			Controle: e.paquet, TransfoControle: Transfo{Echelle: e.echelle}, Matiere: &MatiereCouche{Blanc: 1, Noir: terrainRugositeMin}}
		switch {
		case k.Bitmap == 0 && e.paquet != 0:
			// No color map: the gradient, indexed by the packed map's alpha (a `rohg` layer).
			k.Sorte, k.Bitmap, k.Teinte = CoucheDegrade, e.paquet, [3]float32{1, 1, 1}
			k.Haut, k.Milieu, k.Bas = e.degrade[0], e.degrade[1], e.degrade[2]

		case k.Bitmap == 0:
			k.Bitmap = idBlanc
		}
		couches = append(couches, k)
	}
	out.materiau = Materiau{ID: id, Couches: &Couches{Masque: idMasque, JeuUV: jeuUVNiveau, Couches: couches}}
	out.textures = map[uint32]Texture{idMasque: {Image: masque}, idBlanc: {Image: blanc}}
	haut := p.origine[1] + float64((p.y1+1)*terrainCellules)*p.pas[1]
	out.atlas = [4]float64{p.origine[0] + float64(p.x0*terrainCellules)*p.pas[0], haut, float64(W) * p.pas[0], float64(H) * p.pas[1]}
	out.aires = aires
	parts := make([]string, 0, np)
	tot := 0.0
	for _, a := range aires {
		tot += a
	}
	for k, a := range aires {
		if a > 0 && tot > 0 {
			parts = append(parts, fmt.Sprintf("%d:%.1f%%>g%d", k, 100*a/tot, groupe[k]))
		}
	}
	slog.Info("terrain melange", "id", fmt.Sprintf("%08x", id), "noeuds", lus, "groupes", reps, "aires", parts)
	return out, true
}

// couleurMoyenneLineaire averages an sRGB image in linear light.
func couleurMoyenneLineaire(img *image.NRGBA) [3]float32 {
	var s [3]float64
	n := 0
	for i := 0; i+3 < len(img.Pix); i += 4 {
		for c := 0; c < 3; c++ {
			v := float64(img.Pix[i+c]) / 255
			if v <= 0.04045 {
				v /= 12.92
			} else {
				v = math.Pow((v+0.055)/1.055, 2.4)
			}
			s[c] += v
		}
		n++
	}
	if n == 0 {
		return [3]float32{1, 1, 1}
	}
	return [3]float32{float32(s[0] / float64(n)), float32(s[1] / float64(n)), float32(s[2] / float64(n))}
}

// cacheEntrees decodes each input texture resource of a terrain's heightmap pool once.
type cacheEntrees struct {
	mod        *himodule.Module
	ressources []himodule.File
	images     map[int]*image.NRGBA
}

func newDecodeCache(mod *himodule.Module, ressources []himodule.File) *cacheEntrees {
	return &cacheEntrees{mod: mod, ressources: ressources, images: map[int]*image.NRGBA{}}
}

func (c *cacheEntrees) lit(r, canaux int) *image.NRGBA {
	if img, ok := c.images[r]; ok {
		return img
	}
	var img *image.NRGBA
	if r >= 0 && r < len(c.ressources) {
		if d, err := c.mod.Extract(c.ressources[r]); err == nil {
			img = decodeEntree(c.ressources[r].Donnees(d), canaux)
		}
	}
	c.images[r] = img
	return img
}

// echantillonneurGPU samples a channel of a shared interpreter bitmap at a world position,
// tiled by its UV scale. The bitmap is read at the build's layer side (LOCAL-CHANGE
// (infinite-theater-3d)).
func echantillonneurGPU(idx *ModuleIndex, mel melangeTerrain, caps TextureCaps) func(i, canal int, wx, wy float64) float32 {
	gpu := map[int]*image.NRGBA{}
	return func(i, canal int, wx, wy float64) float32 {
		if i < 0 || i >= len(mel.partagesGPU) {
			return 0
		}
		img, ok := gpu[i]
		if !ok {
			if t, err := LitBitmap(idx, mel.partagesGPU[i].id, caps.Couche); err == nil { // LOCAL-CHANGE (infinite-theater-3d)
				img = t.Image
			}
			gpu[i] = img
		}
		if img == nil {
			return 0
		}
		e := mel.partagesGPU[i].echelle
		u, v := wx*float64(e[0]), wy*float64(e[1])
		w, h := img.Rect.Dx(), img.Rect.Dy()
		x := int(math.Floor((u-math.Floor(u))*float64(w))) % w
		y := int(math.Floor((v-math.Floor(v))*float64(h))) % h
		return float32(img.Pix[y*img.Stride+x*4+canal]) / 255
	}
}
