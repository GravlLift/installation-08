// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package backdrop builds the home screen's ring backdrop from the game install.
//
// The backdrop is a single cinematic image in the install: a bitm tag in the globals
// module showing the Zeta Halo ring against a nebula. It is extracted from the user's own
// install at runtime, exactly like the rank badges, and kept in the data folder. The image
// is never shipped or committed.

package backdrop

import (
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// RingTag is the bitm tag of the home screen's ring backdrop in the install.
const RingTag = 0x1f67dadb

// ringModuleRel is the path of the module that carries the tag, relative to the deploy root.
const ringModuleRel = "pc/globals/globals-rtx-new.module"

// fileName is the single backdrop file the build writes.
const fileName = "home.jpg"

// jpegQuality is the backdrop's encoding quality (a 1920x1080 scene stays well under a
// megabyte at this quality).
const jpegQuality = 90

// OutDir is the backdrop's folder below the data directory.
func OutDir(dataDir string) string {
	return filepath.Join(dataDir, "assets", "backdrop")
}

// FileName is the backdrop's file name.
const FileName = fileName

// SetReady says whether the backdrop is built: the file is on disk.
func SetReady(dataDir string) bool {
	_, err := os.Stat(filepath.Join(OutDir(dataDir), fileName))
	return err == nil
}

// Build decodes the ring backdrop bitm of the install at gameRoot (empty auto-detects it
// the way the other builds always do) and writes it as a JPEG into OutDir(dataDir). It
// writes atomically: a temp file in the same folder is renamed onto the file name, so a
// half-written backdrop is never served. It fails with a clear error when the tag is not
// in the install. It returns the number of files written (always one) and their byte count.
func Build(ctx context.Context, gameRoot, dataDir string) (int, int, error) {
	root, err := resolveRoot(gameRoot)
	if err != nil {
		return 0, 0, err
	}
	module := filepath.Join(root, ringModuleRel)
	idx, err := himap.NewModuleIndex(module)
	if err != nil {
		return 0, 0, fmt.Errorf("open globals module: %w", err)
	}
	defer func() { _ = idx.Close() }()
	tex, err := himap.LitBitmap(idx, RingTag, 1920)
	if err != nil {
		return 0, 0, fmt.Errorf("decode ring backdrop %08x: %w", RingTag, err)
	}
	out := OutDir(dataDir)
	if err := os.MkdirAll(out, 0o750); err != nil {
		return 0, 0, fmt.Errorf("create output folder: %w", err)
	}
	n, err := writeJPEGAtomic(filepath.Join(out, fileName), tex.Image)
	if err != nil {
		return 0, 0, fmt.Errorf("write %s: %w", fileName, err)
	}
	slog.InfoContext(ctx, "ring backdrop built", "bytes", n, "out", filepath.Join(out, fileName))
	return 1, n, nil
}

// resolveRoot returns the deploy root, auto-detecting it when gameRoot is empty.
func resolveRoot(gameRoot string) (string, error) {
	if gameRoot != "" {
		return gameRoot, nil
	}
	return himap.DeployRoot()
}

// writeJPEGAtomic encodes img as a quality-90 JPEG to a temp file in the same folder as
// dest and renames it onto dest, so a reader never sees a partial file. It returns the
// bytes written.
func writeJPEGAtomic(dest string, img image.Image) (int, error) {
	dir := filepath.Dir(dest)
	tmp, err := os.CreateTemp(dir, fileName+".tmp-*")
	if err != nil {
		return 0, err
	}
	tmpName := tmp.Name()
	// A no-op after a successful rename (the name no longer exists there).
	defer func() { _ = os.Remove(tmpName) }()
	if err := jpeg.Encode(tmp, img, &jpeg.Options{Quality: jpegQuality}); err != nil {
		_ = tmp.Close()
		return 0, err
	}
	if err := tmp.Close(); err != nil {
		return 0, err
	}
	if err := os.Rename(tmpName, dest); err != nil {
		return 0, err
	}
	fi, err := os.Stat(dest)
	if err != nil {
		return 0, err
	}
	return int(fi.Size()), nil
}
