package himap

import (
	"image"
	"testing"
)

func uni(l, h int, r, g, b uint8) *Texture {
	img := image.NewNRGBA(image.Rect(0, 0, l, h))
	for i := 0; i < len(img.Pix); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = r, g, b, 255
	}
	return &Texture{Image: img}
}

func TestSurfaceDureDuShader(t *testing.T) {
	tex := map[int]uint32{4: 1, 12: 2, 20: 3, 28: 4, 36: 5}
	s := surfaceDureDuShader(0xa12c98fe, tex)
	if s == nil || *s != (SurfaceDure{MasqueA: 1, MasqueB: 2, Normale: 3, ASG: 4}) {
		t.Fatalf("surface = %+v", s)
	}
	// Le second shader range les memes images 4 octets plus tot.
	tot := surfaceDureDuShader(0x4dac018a, map[int]uint32{0: 1, 8: 2, 16: 3, 24: 4, 48: 5})
	if tot == nil || *tot != (SurfaceDure{MasqueA: 1, MasqueB: 2, Normale: 3, ASG: 4}) {
		t.Fatalf("surface 4dac018a = %+v", tot)
	}
	if surfaceDureDuShader(0x1234, tex) != nil {
		t.Error("un autre shader n'est pas une surface dure")
	}
	if surfaceDureDuShader(0xa12c98fe, map[int]uint32{36: 5}) != nil {
		t.Error("sans image liee, pas de surface")
	}
}

func TestPixelSurface(t *testing.T) {
	zero := [3]float64{}
	base, _, _ := pixelSurface(zero, zero, [3]float64{1, 0, 0})
	if base != grisZones[0] {
		t.Errorf("zone de base = %v, attendu %v", base, grisZones[0])
	}
	zoneA, _, _ := pixelSurface([3]float64{0, 1, 0}, zero, [3]float64{1, 0, 0})
	if zoneA != grisZones[2] {
		t.Errorf("zone V du masque A = %v, attendu %v", zoneA, grisZones[2])
	}
	creux, _, _ := pixelSurface(zero, zero, [3]float64{0, 0, 0})
	if creux >= base {
		t.Errorf("l'occlusion doit assombrir : %v >= %v", creux, base)
	}
	use, rug, met := pixelSurface(zero, zero, [3]float64{1, 1, 0})
	_, rugPeint, metPeint := pixelSurface(zero, zero, [3]float64{1, 0, 0})
	if use <= base || rug >= rugPeint || met <= metPeint {
		t.Errorf("l'usure eclaircit, lisse et metallise : %v %v %v", use, rug, met)
	}
}

func TestCuitSurface(t *testing.T) {
	base, matiere := cuitSurface(uni(2, 2, 0, 0, 0), nil, uni(8, 4, 255, 0, 0))
	if base.Rect.Dx() != 8 || base.Rect.Dy() != 4 || matiere.Rect != base.Rect {
		t.Fatalf("taille = %v / %v, attendu celle de l'ASG", base.Rect, matiere.Rect)
	}
	if got, want := base.Pix[0], octet(grisZones[0]); got != want {
		t.Errorf("gris = %d, attendu %d", got, want)
	}
	vide, _ := cuitSurface(nil, nil, nil)
	if vide.Rect.Dx() != coteSurfaceVide || vide.Pix[0] != octet(grisZones[0]) {
		t.Errorf("sans image : %v, gris %d", vide.Rect, vide.Pix[0])
	}
}

func TestNormaleGLTF(t *testing.T) {
	// Le vert de la normale du jeu est retourne pour glTF ; le rouge reste.
	n := normaleGLTF(uni(1, 1, 128, 255, 0).Image)
	if n.Pix[0] != 128 || n.Pix[1] != 0 {
		t.Errorf("normale = %v, attendu R 128, V retourne 0", n.Pix[:4])
	}
}
