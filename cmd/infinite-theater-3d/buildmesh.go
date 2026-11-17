// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

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
	"github.com/llampwall/infinite-theater-3d/internal/texcompress"
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
	quality := fs.String("texture-quality", "standard", "texture quality to read at: standard (default, today's output) or high (bigger textures)")
	textures := fs.String("textures", string(texcompress.DefaultFormat), "image format of the GLB's textures: ktx2 (default, GPU-compressed Basis Universal, KHR_texture_basisu) or png (the PNG and JPEG images of earlier builds)")
	out := fs.String("out", "", "GLB file to write")
	if err := fs.Parse(args); err != nil {
		return err
	}
	q, ok := meshjobs.ParseQuality(*quality)
	if !ok {
		return fmt.Errorf("build-mesh: unknown --texture-quality %q (standard or high)", *quality)
	}
	tf, ok := texcompress.ParseFormat(*textures)
	if !ok {
		return fmt.Errorf("build-mesh: unknown --textures %q (ktx2 or png)", *textures)
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
		opts := meshbuild.ForgeMapOptions{Key: *mapKey, Names: names, Mvar: *mvar, GameRoot: *gameRoot, Quality: q, Textures: tf}
		summary, err = meshbuild.BuildForgeMap(ctx, opts, *out, announce)
	} else {
		summary, err = meshbuild.BuildMap(ctx, *mapKey, q, tf, *gameRoot, *out, announce)
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
