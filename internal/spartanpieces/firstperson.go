// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package spartanpieces

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// BuildFirstPersonArms writes LevelUp's first-person arm catalog and skinned pieces.
func BuildFirstPersonArms(ctx context.Context, arsenal *himap.Arsenal, dataDir, folder string, announce func(string)) (int64, error) {
	r, err := arsenal.OuvreBrasPremierePersonne()
	if err != nil {
		return 0, err
	}
	coatings, err := OpenCoatingWork(EkurDir(dataDir))
	if err != nil {
		return 0, err
	}
	// LOCAL-CHANGE (infinite-theater-3d): first-person arm pieces get KTX2-compressed textures.
	b := &library{ctx: ctx, folder: folder, generator: generatorLibrary, coatings: coatings,
		depot: &textureDepot{dir: folder, vues: map[string]bool{}},
		index: Index{Pieces: []PieceIndex{}, Failures: []FailureIndex{}}, ktx2: true}
	b.writePieces(r, announce)
	index := firstPersonArmIndex(r, b.index.Pieces, b.index.Failures)
	n, err := writeJSON(filepath.Join(folder, "bras.json"), index)
	if err != nil {
		return 0, fmt.Errorf("arm catalog: %w", err)
	}
	return b.bytes + b.depot.octets + n, nil
}

func firstPersonArmIndex(r *himap.Armurerie, pieces []PieceIndex, failures []FailureIndex) armIndex {
	defaults := make(map[string]string, len(r.Regions))
	for _, region := range r.Regions {
		defaults[Identifier(region.Name)] = "13d24f1f"
	}
	return armIndex{SchemaPieces, skeletonOf(r), pieces, defaults, failures}
}

type armIndex struct {
	Schema   int               `json:"schema"`
	Skeleton SkeletonIndex     `json:"skeleton"`
	Pieces   []PieceIndex      `json:"pieces"`
	Default  map[string]string `json:"default"`
	Failures []FailureIndex    `json:"failures"`
}
