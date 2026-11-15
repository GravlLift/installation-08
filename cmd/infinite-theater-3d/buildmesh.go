package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"

	"github.com/llampwall/infinite-theater-3d/internal/mapmesh"
	"github.com/llampwall/infinite-theater-3d/internal/meshbuild"
)

// runBuildMesh builds one map's world mesh from the local game installation and writes it to a
// GLB file: a native map by its installed module key, or a map built in Forge from its own map
// variant file (--mvar), on the canvas the variant names.
func runBuildMesh(args []string) error {
	fs := flag.NewFlagSet("build-mesh", flag.ContinueOnError)
	mapKey := fs.String("map", "", "installed map module key (e.g. sgh_blueprint); with --mvar, the Forge map's key (its asset id)")
	mvar := fs.String("mvar", "", "a Forge map's variant file (.mvar): build its canvas around its objectives")
	name := fs.String("name", "", "with --mvar, the map's displayed name, published in the GLB")
	gameRoot := fs.String("game", "", "game deploy root; empty auto-detects it (LEVELUP_HALO_DEPLOY, Steam, Xbox)")
	out := fs.String("out", "", "GLB file to write")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *mapKey == "" || *out == "" {
		return fmt.Errorf("build-mesh: --map and --out are required")
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	ctx := context.Background()
	announce := func(step mapmesh.Step) {
		slog.InfoContext(ctx, "build step", "map", *mapKey, "step", step)
	}
	var summary mapmesh.Summary
	var err error
	if *mvar != "" {
		var names []string
		if *name != "" {
			names = []string{*name}
		}
		opts := meshbuild.ForgeMapOptions{Key: *mapKey, Names: names, Mvar: *mvar, GameRoot: *gameRoot}
		summary, err = meshbuild.BuildForgeMap(ctx, opts, *out, announce)
	} else {
		summary, err = meshbuild.BuildMap(ctx, *mapKey, *gameRoot, *out, announce)
	}
	if err != nil {
		if nb, ok := meshbuild.AsNotBuildable(err); ok {
			return fmt.Errorf("build-mesh: %s not buildable here: %s", *mapKey, nb.Reason)
		}
		return fmt.Errorf("build-mesh: %w", err)
	}
	fmt.Printf("wrote %s: %d bytes, %d triangles (%d scenery), sun=%v probes=%v lights=%d\n",
		*out, summary.Bytes, summary.Triangles, summary.SceneryTris, summary.Sun, summary.Probes, summary.Lights)
	return nil
}
