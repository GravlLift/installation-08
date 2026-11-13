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

// runBuildMesh builds one native map's world mesh from the local game installation and writes
// it to a GLB file.
func runBuildMesh(args []string) error {
	fs := flag.NewFlagSet("build-mesh", flag.ContinueOnError)
	mapKey := fs.String("map", "", "installed map module key (e.g. sgh_blueprint)")
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
	summary, err := meshbuild.BuildMap(ctx, *mapKey, *gameRoot, *out, func(step mapmesh.Step) {
		slog.InfoContext(ctx, "build step", "map", *mapKey, "step", step)
	})
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
