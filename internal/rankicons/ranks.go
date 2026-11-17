// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package rankicons builds and names the CSR tier badges.
//
// The badges live in the game install as one bitm atlas: 31 images at 100x100, in tier
// order, six per tier (Bronze through Diamond) plus the single Onyx badge. Measured on
// the install, not assumed: the per-image mean color groups exactly that way (five hue
// groups of six, one distinct badge), the only 31-uniform-size atlas in the deploy root.
//
// The file names are the ones the match context already emits, verbatim:
// `120px-HINF-CSR_{Tier}{SubTier}.png`, Onyx without a sub-tier.

package rankicons

import (
	"context"
	"fmt"
	"image"
	"image/png"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"

	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"
)

// RankAtlasTag is the bitm tag of the rank badge atlas in the install.
const RankAtlasTag = 0xda876ac9

const (
	filePrefix = "120px-HINF-CSR_"
	fileSuffix = ".png"
)

// tierOrder is the atlas order: the tier names as the CSR data spells them.
var tierOrder = []string{"Bronze", "Silver", "Gold", "Platinum", "Diamond", "Onyx"}

// IconName is the badge file name for a tier and sub-tier, the name the context emits.
// A zero sub-tier has no badge of its own: Onyx is the only badge it maps to.
func IconName(tier string, sub int) string {
	id := tier + strconv.Itoa(sub)
	if tier == "Onyx" || sub <= 0 {
		id = "Onyx"
	}
	return filePrefix + id + fileSuffix
}

// Names is the full set of badge file names, in atlas order (31: six per tier, Onyx last).
func Names() []string {
	out := make([]string, 0, len(tierOrder)*6)
	for _, tier := range tierOrder {
		if tier == "Onyx" {
			out = append(out, IconName("Onyx", 0))
			continue
		}
		for sub := 1; sub <= 6; sub++ {
			out = append(out, IconName(tier, sub))
		}
	}
	return out
}

// FileValid says whether name is one of the badge file names (the route's allowlist).
func FileValid(name string) bool {
	for _, n := range Names() {
		if n == name {
			return true
		}
	}
	return false
}

// OutDir is the badge set's folder below the data directory.
func OutDir(dataDir string) string {
	return filepath.Join(dataDir, "assets", "ranks", "halo_infinite")
}

// SetReady says whether the badge set is built: every badge file is on disk.
func SetReady(dataDir string) bool {
	for _, name := range Names() {
		if _, err := os.Stat(filepath.Join(OutDir(dataDir), name)); err != nil {
			return false
		}
	}
	return true
}

// Build decodes the badge atlas of the install at gameRoot (empty auto-detects it the
// way the other builds always do) and writes the badge PNGs into OutDir(dataDir). It
// returns the number of files written and their total byte count.
func Build(ctx context.Context, gameRoot, dataDir string) (int, int, error) {
	out := OutDir(dataDir)
	if err := os.MkdirAll(out, 0o750); err != nil {
		return 0, 0, fmt.Errorf("create output folder: %w", err)
	}
	slog.InfoContext(ctx, "rank badge build", "archives", gameRoot, "out", out)
	names := Names()
	total := 0
	for i, name := range names {
		img, err := weaponicons.AtlasImage(gameRoot, RankAtlasTag, i)
		if err != nil {
			return 0, 0, fmt.Errorf("decode %s: %w", name, err)
		}
		if err := writePNG(filepath.Join(out, name), img); err != nil {
			return 0, 0, fmt.Errorf("write %s: %w", name, err)
		}
		if fi, err := os.Stat(filepath.Join(out, name)); err == nil {
			total += int(fi.Size())
		}
	}
	slog.InfoContext(ctx, "rank badge set built", "files", len(names), "bytes", total, "out", out)
	return len(names), total, nil
}

// writePNG writes img as a best-compressed PNG.
func writePNG(path string, img image.Image) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	enc := png.Encoder{CompressionLevel: png.BestCompression}
	return enc.Encode(f, img)
}
