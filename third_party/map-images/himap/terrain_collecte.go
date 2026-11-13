package himap

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
)

func collecteTerrains(idx *ModuleIndex, opts OptionsCuisson) (GroupeMaillage, map[uint32]Materiau, error) {
	var out GroupeMaillage
	matieres := map[uint32]Materiau{}
	refs, err := terrainsDuScenario(opts.moduleScenario())
	if err != nil {
		return out, nil, err
	}
	for _, ref := range refs {
		cadre, err := cadreTerrain(ref.Cadre, opts.CadreMaillage)
		if err != nil {
			return out, nil, err
		}
		if cadre[2] <= cadre[0] || cadre[3] <= cadre[1] {
			continue
		}
		s, err := ouvreTerrain(idx, ref.ID)
		if err != nil {
			return out, nil, err
		}
		plage, tuiles, noeuds, err := litTerrainAdapte(idx, s, cadre)
		if err != nil {
			slog.Warn("terrain ignore", "id", fmt.Sprintf("%08x", ref.ID), "erreur", err)
			continue
		}
		if len(tuiles) == 0 {
			continue
		}
		mat, err := couleurTerrain(idx, s, noeuds)
		if err != nil {
			slog.Warn("terrain sans couleur lisible", "id", fmt.Sprintf("%08x", ref.ID), "erreur", err)
			continue
		}
		params := parametresTerrain{Resolution: s.resolution, Pas: plage.pas, Origine: [3]float64{plage.origine[0], plage.origine[1], s.position[2]}, Amplitude: s.taille[2], Materiau: mat.ID}
		g, err := assembleTerrain(tuiles, params)
		if err != nil {
			return out, nil, err
		}
		ajouteGroupeTerrain(&out, g)
		out.Instances += len(tuiles)
		matieres[mat.ID] = mat
	}
	return out, matieres, nil
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

func (m *MaillageMonde) resoutTexturesTerrain(ctx context.Context, idx *ModuleIndex, matieres map[uint32]Materiau) error {
	for id, mat := range matieres {
		m.Materiaux[id] = mat
	}
	m.resoutTextures(ctx, idx)
	for id := range matieres {
		if _, ok := m.TexturesCouches[id]; !ok {
			return fmt.Errorf("terrain : texture %08x illisible", id)
		}
	}
	return nil
}
