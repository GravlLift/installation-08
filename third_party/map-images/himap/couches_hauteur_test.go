package himap

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"github.com/JGtm/halo-infinite-files-reader/mapvar"
	"image"
	"image/color"
	"image/png"
	"math"
	"testing"
)

func TestNomsHauteur(t *testing.T) {
	for i, n := range nomsHauteur {
		for _, item := range []struct {
			nom string
			h   uint32
		}{
			{"heightscale", n.echelle}, {"heightblendrange", n.plage}, {"heightaccumulation", n.accumulation},
		} {
			if item.h == 0 {
				continue
			}
			nom := [...]string{"layer1_", "layer2_", "layer3_", "layer4_"}[i] + item.nom
			if got := uint32(mapvar.LabelHash(nom)); got != item.h {
				t.Errorf("%s: %08x != %08x", nom, got, item.h)
			}
		}
	}
}

func TestLectureHauteurEtMatiere(t *testing.T) {
	c := make([]byte, 1024)
	pose := func(o int, v float32) { binary.LittleEndian.PutUint32(c[o:], math.Float32bits(v)) }
	pose(108, 1)
	pose(112, 1)
	pose(268, 0)
	pose(288, 0.9)
	pose(292, 1)
	pose(296, 1)
	pose(460, 0.03333)
	pose(464, 0.15)
	pose(472, 0)
	p := ParametresShader{nomsCouches[0].couleur: 116, 0xff6c550e: 176, nomsCouches[1].controle: 336, nomsCouches[1].opacite: 296, nomsHauteur[0].echelle: 108, nomsHauteur[0].accumulation: 112, nomsHauteur[1].echelle: 268, nomsHauteur[1].plage: 288, nomsHauteur[1].accumulation: 292, nomsMatiere[1][0]: 460, nomsMatiere[1][1]: 464, nomsMatiere[1][2]: 472}
	got := couchesDeNiveau(p, postprocessLu{constantes: c, textures: map[int]uint32{116: 1, 176: 2, 336: 3}})
	if got == nil || len(got.Couches) != 2 {
		t.Fatalf("couches %+v", got)
	}
	a, b := got.Couches[0], got.Couches[1]
	if a.Controle != 2 || a.Hauteur == nil || a.Hauteur.Echelle != 1 || b.Hauteur == nil || b.Hauteur.Plage != float32(0.9) || b.Hauteur.Accumulation != 1 || b.Matiere == nil || b.Matiere.Noir != float32(0.15) {
		t.Fatalf("lecture %+v %+v", a, b)
	}
	doc := &gltfDoc{}
	bin := &tamponGLB{}
	img := image.NewNRGBA(image.Rect(0, 0, 1, 1))
	copy(img.Pix, []byte{10, 20, 30, 40})
	g := &gltfMaterial{Extras: map[string]any{}}
	err := (&couchesGLB{}).applique(doc, bin, g, got, map[uint32]Texture{1: {Image: img}, 2: {Image: img}, 3: {Image: img}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(g.Extras)
	if !bytes.Contains(raw, []byte(`"hauteur":[0,0.9,1]`)) || !bytes.Contains(raw, []byte(`"matiere":[0.03333,0.15,0]`)) {
		t.Fatalf("export %s", raw)
	}
}

func TestNomsMatiere(t *testing.T) {
	noms := []string{"roughness_white", "roughness_black", "metallic"}
	for i := 1; i < len(nomsMatiere); i++ {
		for j, h := range nomsMatiere[i] {
			nom := [...]string{"layer1_", "layer2_", "layer3_", "layer4_"}[i] + noms[j]
			if got := uint32(mapvar.LabelHash(nom)); got != h {
				t.Errorf("%s : %08x != %08x", nom, got, h)
			}
		}
	}
}

func TestImagesHauteurConserventCanaux(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 1, 1))
	copy(src.Pix, []byte{170, 82, 99, 242})
	doc := &gltfDoc{}
	bin := &tamponGLB{}
	cg := &couchesGLB{images: map[cleImage]int{}}
	for _, cas := range []struct {
		role roleImage
		want color.NRGBA
	}{
		{imageMacroHauteur, color.NRGBA{82, 99, 242, 170}},
		{imageControleHauteur, color.NRGBA{242, 82, 170, 99}},
	} {
		index, err := cg.texture(doc, bin, cleImage{1, cas.role}, map[uint32]Texture{1: {Image: src}})
		if err != nil {
			t.Fatal(err)
		}
		v := doc.BufferViews[doc.Images[doc.Textures[index].Source].BufferView]
		im, err := png.Decode(bytes.NewReader(bytes.Join(bin.blocs, nil)[v.ByteOffset : v.ByteOffset+v.ByteLength]))
		if err != nil {
			t.Fatal(err)
		}
		got := color.NRGBAModel.Convert(im.At(0, 0)).(color.NRGBA)
		if got != cas.want {
			t.Errorf("role %v : %v != %v", cas.role, got, cas.want)
		}
	}
}
