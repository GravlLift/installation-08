// Package himap — animations_pistes.go : la lecture des flux d'une animation (codecs 1, 3 et 11)
// et de son deplacement de racine ; la grammaire est en tete d'animations_codec.go.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import "fmt"

// poseStatique lit la pose statique (codec 1 a l'emplacement 0, ou codec 11 a l'emplacement 17).
func (g *GrapheAnimation) poseStatique(c *ClipAnimation, sec [sectionsParMembre][]byte, rangs [tableauxDrapeaux][]int) error {
	for _, s := range []int{sectionStatique, sectionStatiquePartage} {
		f, err := litFlux(sec[s])
		if err != nil {
			return fmt.Errorf("static pose: %w", err)
		}
		switch f.codec {
		case CodecAucun:
			continue
		case CodecStatiqueBrut:
			err = c.statiqueBrute(f, rangs)
		case CodecStatiquePartage:
			err = g.statiquePartagee(c, f, rangs)
		default:
			err = CodecNonDecodeError{Codec: f.codec}
		}
		if err != nil {
			return fmt.Errorf("static pose: %w", err)
		}
	}
	return nil
}

// statiqueBrute lit un flux de codec 1 : une image par piste.
func (c *ClipAnimation) statiqueBrute(f fluxLu, rangs [tableauxDrapeaux][]int) error {
	if err := f.verifieComptes(rangs); err != nil {
		return err
	}
	if err := f.borne(fluxEntete, f.nRot*octetsRotation); err != nil {
		return err
	}
	if err := f.borne(f.debutTrans, f.nTrans*octetsTranslation); err != nil {
		return err
	}
	if err := f.borne(f.debutEch, f.nEch*octetsEchelle); err != nil {
		return err
	}
	for i, os := range rangs[0] {
		c.Os[os].Rotations = [][4]float64{quatI16(f.octets, fluxEntete+i*octetsRotation)}
	}
	for i, os := range rangs[1] {
		c.Os[os].Translations = [][3]float64{vec3F32(f.octets, f.debutTrans+i*octetsTranslation)}
	}
	for i, os := range rangs[2] {
		c.Os[os].Echelles = []float64{f32(f.octets, f.debutEch+i*octetsEchelle)}
	}
	return nil
}

// statiquePartagee lit un flux de codec 11 : un index par piste dans les tables du graphe.
func (g *GrapheAnimation) statiquePartagee(c *ClipAnimation, f fluxLu, rangs [tableauxDrapeaux][]int) error {
	if err := f.verifieComptes(rangs); err != nil {
		return err
	}
	if err := f.borne(fluxEntete, f.nRot*octetsIndexPartage); err != nil {
		return err
	}
	if err := f.borne(f.debutTrans, f.nTrans*octetsIndexPartage); err != nil {
		return err
	}
	for i, os := range rangs[0] {
		k := int(u16(f.octets, fluxEntete+i*octetsIndexPartage))
		if k >= len(g.rotationsPartagees) {
			return fmt.Errorf("%w: shared rotation %d of %d", ErrAnimationIllisible, k, len(g.rotationsPartagees))
		}
		c.Os[os].Rotations = [][4]float64{g.rotationsPartagees[k]}
	}
	for i, os := range rangs[1] {
		k := int(u16(f.octets, f.debutTrans+i*octetsIndexPartage))
		if k >= len(g.translationsPartagees) {
			return fmt.Errorf("%w: shared translation %d of %d", ErrAnimationIllisible, k, len(g.translationsPartagees))
		}
		c.Os[os].Translations = [][3]float64{g.translationsPartagees[k]}
	}
	if err := f.borne(f.debutEch, f.nEch*octetsIndexPartage); err != nil {
		return err
	}
	for i, os := range rangs[2] {
		k := int(u16(f.octets, f.debutEch+i*octetsIndexPartage))
		if k >= len(g.echellesPartagees) {
			return fmt.Errorf("%w: shared scale %d of %d", ErrAnimationIllisible, k, len(g.echellesPartagees))
		}
		c.Os[os].Echelles = []float64{g.echellesPartagees[k]}
	}
	return nil
}

// pistesAnimees lit le flux anime (codec 3, ou codec 10 : animations_courbes.go) ; un flux vide
// laisse une pose fixe.
func (c *ClipAnimation) pistesAnimees(b []byte, rangs [tableauxDrapeaux][]int) error {
	if len(b) > 0 && int(b[0]) == CodecCourbeRevisee {
		c.Codec = CodecCourbeRevisee
		if err := c.litPistesCourbes(b, rangs); err != nil {
			return fmt.Errorf("animated tracks: %w", err)
		}
		return nil
	}
	f, err := litFlux(b)
	if err != nil {
		return fmt.Errorf("animated tracks: %w", err)
	}
	c.Codec = f.codec
	switch f.codec {
	case CodecAucun:
		return nil
	case CodecQuantifie:
	default:
		return CodecNonDecodeError{Codec: f.codec}
	}
	if err := f.verifieComptes(rangs); err != nil {
		return err
	}
	if err := f.verifiePas(c.Images); err != nil {
		return err
	}
	c.litPistesQuantifiees(f, rangs)
	return nil
}

// verifiePas : chaque piste porte une valeur par image, et toutes tiennent dans le flux.
func (f fluxLu) verifiePas(images int) error {
	if f.nRot > 0 && f.pasRot != images*octetsRotation || f.nTrans > 0 && f.pasTrans != images*octetsTranslation ||
		f.nEch > 0 && f.pasEch != images*octetsEchelle {
		return fmt.Errorf("%w: stride %d/%d/%d for %d frames", ErrAnimationIllisible, f.pasRot, f.pasTrans, f.pasEch, images)
	}
	if err := f.borne(fluxEntete, f.nRot*f.pasRot); err != nil {
		return err
	}
	if err := f.borne(f.debutTrans, f.nTrans*f.pasTrans); err != nil {
		return err
	}
	return f.borne(f.debutEch, f.nEch*f.pasEch)
}

// litPistesQuantifiees lit les pistes d'un flux de codec 3 dont les pas et les bornes sont verifies.
func (c *ClipAnimation) litPistesQuantifiees(f fluxLu, rangs [tableauxDrapeaux][]int) {
	for i, os := range rangs[0] {
		p := make([][4]float64, c.Images)
		for k := range p {
			p[k] = quatI16(f.octets, fluxEntete+i*f.pasRot+k*octetsRotation)
		}
		c.Os[os].Rotations = p
	}
	for i, os := range rangs[1] {
		p := make([][3]float64, c.Images)
		for k := range p {
			p[k] = vec3F32(f.octets, f.debutTrans+i*f.pasTrans+k*octetsTranslation)
		}
		c.Os[os].Translations = p
	}
	for i, os := range rangs[2] {
		p := make([]float64, c.Images)
		for k := range p {
			p[k] = f32(f.octets, f.debutEch+i*f.pasEch+k*octetsEchelle)
		}
		c.Os[os].Echelles = p
	}
}

// composanteRotationNulle : une composante de rotation angle-axe, lue seulement nulle.
const composanteRotationNulle = -1

// composantesDeplacement : les flottants par image de chaque sorte de mouvement, et leur place
// dans (dx, dy, dz, dlacet). L'angle-axe porte dx, dy, dz puis un vecteur de rotation (axe x
// angle) : il ne se lit que nul, sa convention n'etant pas mesurable sans rotation a comparer.
var composantesDeplacement = map[Mouvement][]int{
	MouvementDxDy:        {0, 1},
	MouvementDxDyLacet:   {0, 1, 3},
	MouvementDxDyDzLac:   {0, 1, 2, 3},
	MouvementDxDyDzAngle: {0, 1, 2, composanteRotationNulle, composanteRotationNulle, composanteRotationNulle},
}

// litDeplacement lit le deplacement de racine, une entree par image ; une rotation angle-axe non
// nulle rend MouvementNonLuError.
func (c *ClipAnimation) litDeplacement(b []byte) error {
	comp, ok := composantesDeplacement[c.Animation.Mouvement]
	if !ok {
		if c.Animation.Mouvement != MouvementAucun {
			return MouvementNonLuError{Mouvement: c.Animation.Mouvement}
		}
		return nil
	}
	if len(b) != c.Images*len(comp)*4 {
		return fmt.Errorf("%w: offset of %d bytes for %d frames of %d components", ErrAnimationIllisible, len(b), c.Images, len(comp))
	}
	c.Deplacement = make([][4]float64, c.Images)
	for k := range c.Deplacement {
		for j, dst := range comp {
			v := f32(b, (k*len(comp)+j)*4)
			if dst == composanteRotationNulle {
				if v != 0 {
					c.Deplacement = nil
					return MouvementNonLuError{Mouvement: c.Animation.Mouvement}
				}
				continue
			}
			c.Deplacement[k][dst] = v
		}
	}
	return nil
}
