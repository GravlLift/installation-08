package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"

	"github.com/llampwall/infinite-theater-3d/internal/mapmesh"
	"github.com/llampwall/infinite-theater-3d/internal/meshbuild"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
)

// runBuildVariant builds a map variant's object layer from a local `.mvar` file and the local
// game installation, and writes it to a GLB file.
func runBuildVariant(args []string) error {
	fs := flag.NewFlagSet("build-variant", flag.ContinueOnError)
	mapKey := fs.String("map", "", "variant's map key: an installed module's folder name, or a Forge map's map_id")
	mvar := fs.String("mvar", "", "path to the variant's .mvar file")
	gameRoot := fs.String("game", "", "game deploy root; empty auto-detects it (LEVELUP_HALO_DEPLOY, Steam, Xbox)")
	forgeMaterials := fs.String("forge-materials", "", "reference catalog of Forge material tints (JSON); empty uses the catalog embedded in this binary")
	forgeObjects := fs.String("forge-objects", "", "reference catalog of Forge object visibility (JSON); empty uses the catalog embedded in this binary")
	mode := fs.String("mode", "", "match's game variant name (for example Ranked:Slayer): the layer holds the objects that mode creates; empty holds none of the mode-only objects")
	quality := fs.String("texture-quality", "standard", "texture quality to read at: standard (default, today's output) or high (bigger textures)")
	out := fs.String("out", "", "GLB file to write")
	if err := fs.Parse(args); err != nil {
		return err
	}
	q, ok := meshjobs.ParseQuality(*quality)
	if !ok {
		return fmt.Errorf("build-variant: unknown --texture-quality %q (standard or high)", *quality)
	}
	if *mapKey == "" || *mvar == "" || *out == "" {
		return fmt.Errorf("build-variant: --map, --mvar and --out are required")
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	ctx := context.Background()
	opts := meshbuild.BuildVariantOptions{
		Map: *mapKey, Mvar: *mvar, GameRoot: *gameRoot,
		ForgeMaterials: *forgeMaterials, ForgeObjects: *forgeObjects, Mode: *mode, Quality: q,
	}
	summary, err := meshbuild.BuildVariant(ctx, opts, *out, func(step mapmesh.Step) {
		slog.InfoContext(ctx, "build step", "map", *mapKey, "step", step)
	})
	if err != nil {
		return fmt.Errorf("build-variant: %w", err)
	}
	fmt.Printf("wrote %s: %d bytes, %d triangles\n", *out, summary.Bytes, summary.Triangles)
	return nil
}
