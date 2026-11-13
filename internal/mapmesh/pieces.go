package mapmesh

// pieces.go ports the single-piece build path of LevelUp's internal/mapmesh/pieces_armure.go
// (AGPL-3.0, JGtm): one Spartan armor piece (a region's permutation, himap.CleArmure), its full
// skeleton, resolved materials and textures, written as a self-contained skinned GLB
// (himap.EcritGLBPeau). Pieces share the Spartan's whole skeleton (himap.Arsenal.ModeleAPeau),
// so a viewer can pose every piece on the one body rig.
//
// Not ported: LevelUp builds every piece of a `mode` at once into a library folder (an index.json
// plus a shared texture depot, meant to be served incrementally to a web app) and separately
// annotates each painted material with a coating style read from the community Ekur reference
// (internal/mapmesh/revetements.go, internal/mapmesh/revetements_ekur.go). Neither fits this
// CLI's one-asset-per-GLB model yet: textures stay embedded in each piece's own GLB (as
// build-weapon already does), and painted materials come out in their default, unpainted color
// (LevelUp's own documented behavior when no Ekur reference is given).

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"path/filepath"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// PieceTarget is one Spartan armor piece to build.
type PieceTarget struct {
	// Module is the `.module` whose index covers the game's globals (the Spartan render_model
	// lives there, like the Spartan body and the first-person rig).
	Module string
	// Region and Permutation are the piece's key (himap.CleArmure): StringIDs of the armor
	// region (e.g. a helmet, a shoulder) and the permutation within it.
	Region, Permutation uint32
}

// BuildPiece writes one Spartan armor piece's GLB to `path`, built in-process from the local
// game installation. `announce` (nil accepted) receives each step at its start.
func BuildPiece(ctx context.Context, gameRoot string, t PieceTarget, path, generator string, announce func(Step)) (Summary, error) {
	if announce == nil {
		announce = func(Step) {}
	}
	announce(StepGeometry)
	a, err := himap.OuvreArsenal(gameRoot, t.Module)
	if err != nil {
		return Summary{}, err
	}
	defer func() {
		if cerr := a.Close(); cerr != nil {
			slog.WarnContext(ctx, "closing arsenal", "err", cerr)
		}
	}()
	r, err := a.OuvreArmurerie(himap.ModeSpartan)
	if err != nil {
		return Summary{}, err
	}
	key := himap.CleArmure{Region: t.Region, Permutation: t.Permutation}
	m, err := r.Piece(ctx, key)
	if err != nil {
		return Summary{}, err
	}
	announce(StepWriting)
	extras := map[string]any{"model": "spartan-piece", "region": fmt.Sprintf("%08x", t.Region), "permutation": fmt.Sprintf("%08x", t.Permutation), axesGLBKey: axesGLB}
	n, err := writeFile(path, func(w io.Writer) error { return himap.EcritGLBPeau(w, m, generator, extras) })
	if err != nil {
		return Summary{}, err
	}
	s := Summary{Triangles: m.Maillage.Structure.Triangles(), Bytes: n}
	slog.InfoContext(ctx, "armor piece written", "piece", key.String(), "triangles", s.Triangles, "bytes", n, "file", filepath.Base(path))
	return s, nil
}
