// Package himap : masque de nuages declare par l'etat du monde.
package himap

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"math"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
)

// Ciel porte le masque monocanal des nuages, s'il existe.
type Ciel struct {
	Masque          *image.Gray
	IntensiteSoleil *float64
}

// LitCiel lit le bloc Panning Cloud Settings du dwsg nomme par le scenario.
func LitCiel(src SourcesLumiere, racine, module string) (*Ciel, error) {
	if src.EtatDuMonde == 0 {
		return nil, nil
	}
	m, err := himodule.Open(src.ModuleEtat)
	if err != nil {
		return nil, err
	}
	defer m.Close()
	f, ok := entreeParID(m, GroupeEtatDuMonde, src.EtatDuMonde)
	if !ok {
		return nil, fmt.Errorf("dwsg %#x absent", src.EtatDuMonde)
	}
	ti, err := tagDeEntree(m, f)
	if err != nil {
		return nil, err
	}
	id, err := masqueCiel(ti)
	if err != nil {
		return nil, err
	}
	ciel := &Ciel{}
	if soleil, err := litSoleilDwsg(ti.tag); err == nil && soleil.Drapeaux&(SoleilRemplacePrincipal|SoleilIntensite) == SoleilRemplacePrincipal|SoleilIntensite && !math.IsNaN(soleil.Intensite) && !math.IsInf(soleil.Intensite, 0) && soleil.Intensite >= 0 {
		ciel.IntensiteSoleil = &soleil.Intensite
	}
	if id == 0 {
		return ciel, nil
	}
	chemins, err := GeometrySearchPath(racine, module)
	if err != nil {
		return ciel, err
	}
	idx, err := NewModuleIndex(chemins...)
	if err != nil {
		return ciel, err
	}
	defer idx.Close()
	tex, err := LitBitmap(idx, id, 512)
	if err != nil {
		return ciel, err
	}
	img := image.NewGray(tex.Image.Bounds())
	for y := img.Rect.Min.Y; y < img.Rect.Max.Y; y++ {
		for x := img.Rect.Min.X; x < img.Rect.Max.X; x++ {
			img.SetGray(x, y, color.Gray{Y: tex.Image.NRGBAAt(x, y).R})
		}
	}
	ciel.Masque = img
	return ciel, nil
}

// masqueCiel lit la premiere texture du bloc de nuages panoramiques.
func masqueCiel(ti tagInfo) (uint32, error) {
	const champ = 0x177c
	const taille = 0x40
	root, err := ti.rootBlockIndex()
	if err != nil {
		return 0, err
	}
	abs, n := ti.blockAbs(root)
	if champ+compteTagBlock+4 > n || abs+n > len(ti.tag) {
		return 0, fmt.Errorf("dwsg racine tronquee")
	}
	count := u32(ti.tag, abs+champ+compteTagBlock)
	if count == 0 {
		return 0, nil
	}
	b := ti.subBlockTarget(root, champ)
	if b < 0 {
		return 0, fmt.Errorf("bloc nuages absent")
	}
	off, size := ti.blockAbs(b)
	if size != count*taille || off < 0 || off+size > len(ti.tag) {
		return 0, fmt.Errorf("bloc nuages tronque")
	}
	return idReference(ti.tag, off+0x24), nil
}

// EcritGLBCiel ajoute le ciel aux extras de scene sans dupliquer le soleil.
func EcritGLBCiel(w io.Writer, m *MaillageMonde, generateur string, extras map[string]any, ciel *Ciel) error {
	doc, bin, err := documentGLB(m, generateur, extras)
	if err != nil {
		return err
	}
	if ciel != nil {
		v := map[string]any{}
		if ciel.IntensiteSoleil != nil && (m.Soleil == nil || !m.Soleil.AvecIntensite) {
			v["sunIntensity"] = *ciel.IntensiteSoleil
		}
		if ciel.Masque != nil {
			var b bytes.Buffer
			if err := png.Encode(&b, ciel.Masque); err != nil {
				return err
			}
			v["cloudTexture"] = ajouteImage(doc, bin, b.Bytes(), mimePNG)
		}
		if doc.Scenes[0].Extras == nil {
			doc.Scenes[0].Extras = map[string]any{}
		}
		doc.Scenes[0].Extras["ciel"] = v
	}
	roots := make([]int, len(doc.Nodes))
	for i := range roots {
		roots[i] = i
	}
	return termineGLB(w, doc, bin, roots)
}
