// Package himap — surface_dure.go : les textures des materiaux de surface dure (armes).
//
// Le shader de surface dure ne porte pas les couches des shaders de niveau : la couleur d'une arme
// vient du systeme de revetements du jeu (styles de materiau du modele, non lus ici). Le materiau
// lie quatre images, aux emplacements de son bloc postprocess :
//
//	masque A, masque B : les zones de revetement (une zone par canal R, V, B ; noir = zone de base)
//	ASG                : occlusion (R), rayures d'usure (V), salissure (B)
//	normale            : X, Y (convention DirectX, V vers le bas de l'image)
//
// Les noms des parametres du shader (hachages) ne sont pas resolus : la table tient les
// emplacements, lus sur le shader. Le role de chaque image est celui des noms des fichiers
// extraits par la communaute (`asg_control`, `mask_0_control`, `mask_1_control`, `normal`).
package himap

// emplacementsSurface : les emplacements des quatre images dans le bloc postprocess d'un shader de
// surface dure.
type emplacementsSurface struct {
	masqueA, masqueB, normale, asg int
}

// shadersSurfaceDure : les shaders de surface dure des armes, par GlobalID. Les deux portent les
// memes images dans le meme ordre ; le second les range 4 octets plus tot (constate sur leurs
// images : zones a aplats, zones a liseres, normale, occlusion a rayures).
var shadersSurfaceDure = map[uint32]emplacementsSurface{
	0xa12c98fe: {masqueA: 4, masqueB: 12, normale: 20, asg: 28},
	0x4dac018a: {masqueA: 0, masqueB: 8, normale: 16, asg: 24},
}

// SurfaceDure : les images d'un materiau de surface dure, par GlobalID de bitmap (0 : absente).
type SurfaceDure struct {
	MasqueA uint32
	MasqueB uint32
	ASG     uint32
	Normale uint32
}

// surfaceDureDuShader rend les images d'un materiau de surface dure ; nil pour un autre shader, ou
// quand le materiau ne lie aucune image.
func surfaceDureDuShader(shader uint32, textures map[int]uint32) *SurfaceDure {
	e, ok := shadersSurfaceDure[shader]
	if !ok {
		return nil
	}
	s := SurfaceDure{
		MasqueA: textures[e.masqueA],
		MasqueB: textures[e.masqueB],
		ASG:     textures[e.asg],
		Normale: textures[e.normale],
	}
	if s == (SurfaceDure{}) {
		return nil
	}
	return &s
}

// bitmaps rend les images liees, sans les absentes.
func (s SurfaceDure) bitmaps() []uint32 {
	var out []uint32
	for _, id := range []uint32{s.MasqueA, s.MasqueB, s.ASG, s.Normale} {
		if id != 0 {
			out = append(out, id)
		}
	}
	return out
}
