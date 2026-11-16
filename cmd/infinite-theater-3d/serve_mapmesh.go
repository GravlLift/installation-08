package main

// serve_mapmesh.go — which world mesh a stored match draws, and the build of a mesh key.
//
// A native map's mesh is keyed by its installed module (maps\<module>.glb), shared by every match
// on it. A map built in Forge records its canvas as its module (the key of the module-keyed
// builds), but its world mesh is the canvas framed around that map, built from the match's own
// map variant (meshbuild.BuildForgeMap): it is keyed by the map's asset id instead.

import (
	"context"

	"github.com/llampwall/infinite-theater-3d/internal/mapmesh"
	"github.com/llampwall/infinite-theater-3d/internal/meshbuild"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// meshKeyOf is the key of a stored match's world mesh: its map asset id on a Forge canvas, its map
// module otherwise ("" when the match has no module).
func meshKeyOf(meta store.Match) string {
	if meshbuild.IsForgeCanvas(meta.MapModule) && store.ModuleKeyValid(meta.MapAssetID) {
		return meta.MapAssetID
	}
	return meta.MapModule
}

// forgeMeshMatch returns a stored match whose world mesh is the Forge map `key` and whose map
// variant is in the store; false when no stored match is one.
func forgeMeshMatch(root *store.Root, key string) (store.Match, bool) {
	ms, err := root.ListMatches()
	if err != nil {
		return store.Match{}, false
	}
	for _, m := range ms {
		if m.MapAssetID == key && meshKeyOf(m) == key && hasMatchMvar(root, m.MatchID) {
			return m, true
		}
	}
	return store.Match{}, false
}

// buildMapMesh builds the world mesh of `key` of texture quality `quality` into `out`: a Forge
// map from a stored match's map variant, a native map from its installed module.
func buildMapMesh(ctx context.Context, root *store.Root, key, game, out string, quality meshjobs.Quality) (meshjobs.BuildResult, error) {
	var summary mapmesh.Summary
	var err error
	if m, ok := forgeMeshMatch(root, key); ok {
		opts := meshbuild.ForgeMapOptions{Key: key, Names: []string{m.MapName}, Mvar: variantPath(root, m.MatchID, "map.mvar"), GameRoot: game, Quality: quality}
		summary, err = meshbuild.BuildForgeMap(ctx, opts, out, nil)
	} else {
		summary, err = meshbuild.BuildMap(ctx, key, quality, "", game, out, nil)
	}
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	return meshjobs.BuildResult{Bytes: summary.Bytes, Triangles: summary.Triangles}, nil
}
