// Package himap — textures_monde.go : les textures que le maillage monde emporte.
package himap

import (
	"context"
	"fmt"
	"log/slog"
)

// coteSurface : une arme du rejeu tient quelques dizaines de pixels a l'ecran, et une quinzaine
// de materiaux par arme, dizaines d'armes par match, tiennent en memoire graphique a 256.
const coteSurface = 256

// TextureCaps (LOCAL-CHANGE (infinite-theater-3d)) : les cotes de lecture des textures d'une
// carte, choisies par build. Standard est l'ancien jeu de constantes (masques de decoupe et
// couches a 512, masques macro et echantillons a 256) : un build standard est byte-a-byte celui
// d'avant. High double ces cotes pour des textures plus nettes ; son fichier est separate,
// built a la premiere demande. Un masque de decoupe garde les trous d'une tole perforee nets a
// 512 ; les textures de couche, peu nombreuses et repetees sur toute une surface, aussi. Les
// masques macro sont un par materiau (plusieurs centaines par carte) et etales sans repetition :
// 256 suffit a placer les couches et tient l'export a quelques dizaines de megaoctets. Les
// echantillons sont ceux qu'un style Forge dessine, plusieurs centaines par carte Forge,
// repetes sur la surface : 256 tient l'export a moins de deux fois la carte.
type TextureCaps struct {
	Masque       int // masques de decoupe
	Couche       int // textures de couche (couche, normale, controle, emission)
	MasqueMacro  int // masques macro, masques de style, controles ASG
	Echantillon  int // echantillons des styles Forge
}

// CapsStandard (LOCAL-CHANGE (infinite-theater-3d)) : l'ancien jeu de cotes, non change.
var CapsStandard = TextureCaps{Masque: 512, Couche: 512, MasqueMacro: 256, Echantillon: 256}

// CapsHigh (LOCAL-CHANGE (infinite-theater-3d)) : les memes textures a double cote.
var CapsHigh = TextureCaps{Masque: 1024, Couche: 1024, MasqueMacro: 512, Echantillon: 512}

// textureCapsOf rend les cotes d'un build : le choix des options, ou les cotes standard quand
// les options n'en donnent aucune (le defaut garde la sortie d'avant).
func textureCapsOf(c TextureCaps) TextureCaps {
	if c == (TextureCaps{}) {
		return CapsStandard
	}
	return c
}

// resoutTextures decode les masques de decoupe, les textures de couche et celles des surfaces dures
// (rangees avec les couches) des materiaux lus, dans
// l'index de la collecte (GeometrySearchPathMonde : modules de geometrie et objets Forge).
// Une texture illisible est comptee et journalisee : un masque absent laisse son materiau
// plein (aucun mur ne disparait), une couche absente n'est pas dessinee.
func (m *MaillageMonde) resoutTextures(ctx context.Context, idx *ModuleIndex) {
	caps := m.capsFor()
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
		if z := mat.Zones; z != nil && m.stylesForge != nil {
			// LOCAL-CHANGE (infinite-theater-3d): what a Forge style may light on the material.
			for _, id := range []uint32{z.params.asg, z.params.masque0, z.params.masque1} {
				charge(m.TexturesCouches, &m.TexturesCouchesIllisibles, id, caps.MasqueMacro, "masque de style")
			}
			charge(m.TexturesCouches, &m.TexturesCouchesIllisibles, z.params.normale, caps.Couche, "normale")
		}
		if mat.Decoupe != nil {
			charge(m.Masques, &m.MasquesIllisibles, mat.Decoupe.Bitmap, caps.Masque, "decoupe")
		}
		if mat.Surface != nil {
			for _, id := range mat.Surface.bitmaps() {
				charge(m.TexturesCouches, &m.TexturesCouchesIllisibles, id, coteSurface, "surface dure")
			}
		}
		if mat.Emissif != nil {
			// LOCAL-CHANGE (infinite-theater-3d): the texture that masks the material's light.
			charge(m.TexturesCouches, &m.TexturesCouchesIllisibles, mat.Emissif.Bitmap, caps.Couche, "emission")
		}
		if mat.Couches == nil {
			continue
		}
		charge(m.TexturesCouches, &m.TexturesCouchesIllisibles, mat.Couches.Masque, caps.MasqueMacro, "masque macro")
		// LOCAL-CHANGE (infinite-theater-3d): a Forge style material's masks and ASG are one per
		// object, spread without repeating, like macro masks; read before the layers that share
		// the ASG as their control map, so both read it at the same size.
		for _, k := range mat.Couches.Couches {
			if k.ControleASG {
				charge(m.TexturesCouches, &m.TexturesCouchesIllisibles, k.Controle, caps.MasqueMacro, "asg")
			}
		}
		if s := mat.Couches.Style; s != nil {
			for _, id := range []uint32{s.Masque0, s.Masque1, s.ASG} {
				charge(m.TexturesCouches, &m.TexturesCouchesIllisibles, id, caps.MasqueMacro, "masque de style")
			}
		}
		for _, k := range mat.Couches.Couches {
			charge(m.TexturesCouches, &m.TexturesCouchesIllisibles, k.Bitmap, caps.Couche, "couche")
			charge(m.TexturesCouches, &m.TexturesCouchesIllisibles, k.Normale, caps.Couche, "normale")
			charge(m.TexturesCouches, &m.TexturesCouchesIllisibles, k.Controle, caps.Couche, "controle")
		}
	}
	// LOCAL-CHANGE (infinite-theater-3d): the swatches only a Forge style draws (the material's
	// other zones, the objects' own styles), after the layers above so a swatch those also draw
	// keeps their size.
	if m.stylesForge == nil {
		return
	}
	echantillons := func(k *Couche) {
		if k != nil {
			charge(m.TexturesCouches, &m.TexturesCouchesIllisibles, k.Bitmap, caps.Echantillon, "style forge")
			charge(m.TexturesCouches, &m.TexturesCouchesIllisibles, k.Normale, caps.Echantillon, "style forge normale")
		}
	}
	for _, mat := range m.Materiaux {
		if mat.Zones != nil {
			for _, zn := range mat.Zones.zones {
				echantillons(zn.k)
			}
			echantillons(mat.Zones.salete)
		}
	}
	for _, s := range m.stylesForge {
		for _, k := range append(s.Zones[:], s.Salete) {
			echantillons(k)
		}
	}
}
