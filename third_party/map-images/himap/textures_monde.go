// Package himap — textures_monde.go : les textures que le maillage monde emporte.
package himap

import (
	"context"
	"fmt"
	"log/slog"
)

// Cotes de lecture. Un masque de decoupe garde les trous d'une tole perforee nets a 512 ; les
// textures de couche, peu nombreuses et repetees sur toute une surface, aussi. Les masques
// macro sont un par materiau (plusieurs centaines par carte) et etales sans repetition : 256
// suffit a placer les couches et tient l'export a quelques dizaines de megaoctets.
const (
	coteMasque      = 512
	coteCouche      = 512
	coteMasqueMacro = 256
	// coteSurface : une arme du rejeu tient quelques dizaines de pixels a l'ecran, et une quinzaine
	// de materiaux par arme, dizaines d'armes par match, tiennent en memoire graphique a 256.
	coteSurface = 256
)

// resoutTextures decode les masques de decoupe, les textures de couche et celles des surfaces dures
// (rangees avec les couches) des materiaux lus, dans
// l'index de la collecte (GeometrySearchPathMonde : modules de geometrie et objets Forge).
// Une texture illisible est comptee et journalisee : un masque absent laisse son materiau
// plein (aucun mur ne disparait), une couche absente n'est pas dessinee.
func (m *MaillageMonde) resoutTextures(ctx context.Context, idx *ModuleIndex) {
	m.Masques = map[uint32]Texture{}
	m.TexturesCouches = map[uint32]Texture{}
	charge := func(table map[uint32]Texture, illisibles *int, id uint32, cote int, role string) {
		if _, deja := table[id]; deja || id == 0 {
			return
		}
		t, err := LitBitmap(idx, id, cote)
		if err != nil {
			slog.WarnContext(ctx, "texture illisible", "role", role, "bitmap", fmt.Sprintf("%08x", id), "err", err)
			*illisibles++
			return
		}
		table[id] = t
	}
	for _, mat := range m.Materiaux {
		if mat.Decoupe != nil {
			charge(m.Masques, &m.MasquesIllisibles, mat.Decoupe.Bitmap, coteMasque, "decoupe")
		}
		if mat.Surface != nil {
			for _, id := range mat.Surface.bitmaps() {
				charge(m.TexturesCouches, &m.TexturesCouchesIllisibles, id, coteSurface, "surface dure")
			}
		}
		if mat.Emissif != nil {
			// LOCAL-CHANGE (infinite-theater-3d): the texture that masks the material's light.
			charge(m.TexturesCouches, &m.TexturesCouchesIllisibles, mat.Emissif.Bitmap, coteCouche, "emission")
		}
		if mat.Couches == nil {
			continue
		}
		charge(m.TexturesCouches, &m.TexturesCouchesIllisibles, mat.Couches.Masque, coteMasqueMacro, "masque macro")
		for _, k := range mat.Couches.Couches {
			charge(m.TexturesCouches, &m.TexturesCouchesIllisibles, k.Bitmap, coteCouche, "couche")
			charge(m.TexturesCouches, &m.TexturesCouchesIllisibles, k.Normale, coteCouche, "normale")
			charge(m.TexturesCouches, &m.TexturesCouchesIllisibles, k.Controle, coteCouche, "controle")
		}
	}
}
