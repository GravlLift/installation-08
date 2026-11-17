// Package himap — animations_pose.go : la pose d'un squelette a une image d'une animation decodee.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import "fmt"

// PoseLocale rend le squelette `repos` (le `mode`, meme rang d'os que le graphe) pose a l'image
// `image` : rotation, translation et echelle de chaque os prises dans sa piste (animee, ou
// statique), la pose de repos sinon. Le resultat se compose par NodeModelTransform.
func (c *ClipAnimation) PoseLocale(repos []Noeud, image int) ([]Noeud, error) {
	if len(repos) != len(c.Os) {
		return nil, fmt.Errorf("skeleton of %d nodes for %d tracks", len(repos), len(c.Os))
	}
	if image < 0 || image >= c.Images {
		return nil, fmt.Errorf("frame %d outside the %d of the animation", image, c.Images)
	}
	out := make([]Noeud, len(repos))
	copy(out, repos)
	for i, p := range c.Os {
		if r := p.Rotations; len(r) > 0 {
			out[i].Quat = r[min(image, len(r)-1)]
		}
		if t := p.Translations; len(t) > 0 {
			out[i].Pos = t[min(image, len(t)-1)]
		}
		if e := p.Echelles; len(e) > 0 {
			out[i].Scale = e[min(image, len(e)-1)]
		}
	}
	return out, nil
}

// MemeSquelette verifie que les os du graphe sont les noeuds du `mode`, rang par rang (meme nom,
// meme parent) : les pistes s'appliquent alors sans reciblage.
func (g *GrapheAnimation) MemeSquelette(noeuds []Noeud) error {
	if len(g.Os) != len(noeuds) {
		return fmt.Errorf("graph %08x: %d bones for %d model nodes", g.ID, len(g.Os), len(noeuds))
	}
	for i, o := range g.Os {
		if o.Nom != noeuds[i].Name || o.Parent != noeuds[i].Parent {
			return fmt.Errorf("graph %08x: bone %d (%s, parent %d) against node %s (parent %d)", g.ID, i,
				NomDuNoeud(o.Nom), o.Parent, NomDuNoeud(noeuds[i].Name), noeuds[i].Parent)
		}
	}
	return nil
}
