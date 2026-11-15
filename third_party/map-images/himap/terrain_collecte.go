package himap

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
)

// LOCAL-CHANGE (infinite-theater-3d): also returns the synthetic textures of the baked palette
// blend (terrain_melange_bake.go), and the decorators it scatters (decorateurs_pose.go).
func collecteTerrains(idx *ModuleIndex, opts OptionsCuisson) (GroupeMaillage, map[uint32]Materiau, map[uint32]Texture, []TapisDecorateur, error) {
	var out GroupeMaillage
	matieres := map[uint32]Materiau{}
	synthetiques := map[uint32]Texture{}
	var decorateurs []TapisDecorateur
	// LOCAL-CHANGE (infinite-theater-3d): the build's texture caps, shared with the bake.
	caps := textureCapsOf(opts.TextureCaps)
	refs, err := terrainsDuScenario(opts.moduleScenario())
	if err != nil {
		return out, nil, nil, nil, err
	}
	for _, ref := range refs {
		cadre, err := cadreTerrain(ref.Cadre, opts.CadreMaillage)
		if err != nil {
			return out, nil, nil, nil, err
		}
		if cadre[2] <= cadre[0] || cadre[3] <= cadre[1] {
			continue
		}
		s, err := ouvreTerrain(idx, ref.ID)
		if err != nil {
			return out, nil, nil, nil, err
		}
		plage, tuiles, noeuds, err := litTerrainAdapte(idx, s, cadre)
		if err != nil {
			slog.Warn("terrain ignore", "id", fmt.Sprintf("%08x", ref.ID), "erreur", err)
			continue
		}
		if len(tuiles) == 0 {
			continue
		}
		params := parametresTerrain{Resolution: s.resolution, Pas: plage.pas, Origine: [3]float64{plage.origine[0], plage.origine[1], s.position[2]}, Amplitude: s.taille[2]}
		var mat Materiau
		if cuit, ok := cuitMelangeTerrain(idx, s, plage, tuiles, noeuds, ref.ID, caps); ok {
			mat = cuit.materiau
			params.Atlas = cuit.atlas
			for id, t := range cuit.textures {
				synthetiques[id] = t
			}
		} else {
			mat, err = couleurTerrain(idx, s, noeuds)
			if err != nil {
				slog.Warn("terrain sans couleur lisible", "id", fmt.Sprintf("%08x", ref.ID), "erreur", err)
				continue
			}
		}
		params.Materiau = mat.ID
		g, err := assembleTerrain(tuiles, params)
		if err != nil {
			return out, nil, nil, nil, err
		}
		ajouteGroupeTerrain(&out, g)
		decorateurs = append(decorateurs, poseDecorateurs(idx, s, plage, tuiles, params, ref.ID, caps)...)
		out.Instances += len(tuiles)
		matieres[mat.ID] = mat
	}
	return out, matieres, synthetiques, decorateurs, nil
}

func ajouteGroupeTerrain(dst *GroupeMaillage, src GroupeMaillage) {
	base := uint32(len(dst.Sommets) / 3)
	dst.Sommets = append(dst.Sommets, src.Sommets...)
	dst.Normales = append(dst.Normales, src.Normales...)
	for i := range dst.UV {
		dst.UV[i] = append(dst.UV[i], src.UV[i]...)
	}
	if dst.Indices == nil {
		dst.Indices = map[uint32][]uint32{}
	}
	for id, indices := range src.Indices {
		for _, n := range indices {
			dst.Indices[id] = append(dst.Indices[id], base+n)
		}
	}
}

// litTerrainAdapte descend de niveau si une tuile du niveau choisi est absente.
func litTerrainAdapte(idx *ModuleIndex, s sourceTerrain, cadre [4]float64) (plageTerrain, []tuileTerrain, []int, error) {
	for s.niveaux > 0 {
		p, err := choisitPlageTerrain(s, cadre)
		if err != nil {
			return p, nil, nil, err
		}
		if p.x1 < p.x0 {
			return p, nil, nil, nil
		}
		t, n, err := litTuilesTerrain(idx, s, p)
		if !errors.Is(err, errTerrainNoeudAbsent) {
			return p, t, n, err
		}
		s.niveaux = p.niveau
	}
	return plageTerrain{}, nil, nil, errTerrainNoeudAbsent
}

// LOCAL-CHANGE (infinite-theater-3d): the terrain materials join after the other textures are
// read, so their synthetic textures (baked mask, white) are not looked up in the modules.
func (m *MaillageMonde) resoutTexturesTerrain(ctx context.Context, idx *ModuleIndex, matieres map[uint32]Materiau, synthetiques map[uint32]Texture) error {
	m.resoutTextures(ctx, idx)
	for id, t := range synthetiques {
		m.TexturesCouches[id] = t
	}
	for id, mat := range matieres {
		m.Materiaux[id] = mat
		for _, k := range mat.Couches.Couches {
			for _, b := range []uint32{k.Bitmap, k.Normale, k.Controle} {
				if _, ok := m.TexturesCouches[b]; ok || b == 0 {
					continue
				}
				t, err := LitBitmap(idx, b, m.capsFor().Couche) // LOCAL-CHANGE (infinite-theater-3d)
				if err != nil {
					slog.WarnContext(ctx, "texture de terrain illisible", "bitmap", fmt.Sprintf("%08x", b), "err", err)
					m.TexturesCouchesIllisibles++
					continue
				}
				m.TexturesCouches[b] = t
			}
		}
		if _, ok := m.TexturesCouches[mat.Couches.Couches[0].Bitmap]; !ok {
			return fmt.Errorf("terrain : texture %08x illisible", mat.Couches.Couches[0].Bitmap)
		}
	}
	return nil
}
