package firstperson

// bras.go writes bras.json, the arm pieces catalog the view asks for at the library root
// (BrasPremierePersonne3d fetches <folder>/bras.json before the index). The full catalog
// (one skinned GLB per region and permutation of the Spartan's armor) is the pieces
// library, which the standalone does not build yet; this library is scoped to the weapon
// rigs, so the catalog is written empty and the view falls back to the arms baked in each
// rig (the Spartan's default armor) without failing the load.

import (
	"encoding/json"
	"path/filepath"
)

// BrasSkeleton is the arm bone names the pieces and the rigs share; the rigs of this
// library carry their own skeletons, so the catalog names none.
type BrasSkeleton struct {
	Bones []string `json:"bones"`
}

// BrasPiece is one arm piece of the catalog.
type BrasPiece struct {
	Key         string `json:"key"`
	Region      string `json:"region"`
	Permutation string `json:"permutation"`
	File        string `json:"file"`
	Triangles   int    `json:"triangles"`
	Bbox        Bbox   `json:"bbox"`
	Bytes       int64  `json:"bytes"`
}

// Bbox is the world-space bounding box of a piece.
type Bbox struct {
	Min []float64 `json:"min"`
	Max []float64 `json:"max"`
}

// BrasIndex is the bras.json the view reads: the schema marker, the shared skeleton, the
// pieces, the per-region default permutation, and the failures.
type BrasIndex struct {
	Schema   int               `json:"schema"`
	Skeleton BrasSkeleton      `json:"skeleton"`
	Pieces   []BrasPiece       `json:"pieces"`
	Default  map[string]string `json:"default"`
	Failures []any             `json:"failures"`
}

// WriteBras writes the empty bras.json of the library: no piece GLB is built by this
// library, so the view uses the arms baked in each rig.
func WriteBras(dir string) error {
	idx := BrasIndex{
		Schema:   SchemaFirstPerson,
		Skeleton: BrasSkeleton{Bones: []string{}},
		Pieces:   []BrasPiece{},
		Default:  map[string]string{},
		Failures: []any{},
	}
	raw, err := json.MarshalIndent(idx, "", "  ")
	if err != nil {
		return err
	}
	_, err = writeFile(filepath.Join(dir, FichierBras), func(w ioWriter) error {
		_, werr := w.Write(raw)
		return werr
	})
	return err
}
