// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_temps.go — a startup sweep of the temporary files a killed build leaves in the data
// folder. A build writes its GLB through intermediates (`.src`, `.tex`, the texture spill
// `*.ktx2.part`, and the `.tmp` of every atomic write) and removes them when it finishes; a
// build stopped mid-way (the app closed, a crash) leaves them behind for good. Breaker's high
// build left a 407 MB `.ktx2.part` on 2026-11-18.

import (
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// buildTempMinAge is how old a temporary file must be before the sweep removes it. Builds run
// in this process only after the sweep starts, but a second server on the same data folder (a
// development copy on another --addr) may be mid-build: a temp it still writes or reads is never
// hours old.
const buildTempMinAge = 6 * time.Hour

// buildTempDirs are the data folders builds write into (relative to the data folder).
var buildTempDirs = []string{"maps", "variant-cache", "matches", "weapons", "first-person", "spartan-pieces"}

// isBuildTemp reports whether a file name is one of the builds' intermediates.
func isBuildTemp(name string) bool {
	for _, suffix := range []string{".src", ".tex", ".tmp", ".ktx2.part"} {
		if strings.HasSuffix(name, suffix) {
			return true
		}
	}
	return false
}

// removeStaleBuildTemps deletes the build intermediates older than buildTempMinAge under the
// build folders of dataDir, and logs what it freed. Errors are logged, never returned.
func removeStaleBuildTemps(dataDir string, now time.Time) {
	var files int
	var bytes int64
	for _, dir := range buildTempDirs {
		_ = filepath.WalkDir(filepath.Join(dataDir, dir), func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || !d.Type().IsRegular() || !isBuildTemp(d.Name()) {
				return nil
			}
			info, err := d.Info()
			if err != nil || now.Sub(info.ModTime()) < buildTempMinAge {
				return nil
			}
			if err := os.Remove(path); err != nil {
				slog.Warn("stale build temp not removed", "file", path, "err", err)
				return nil
			}
			files++
			bytes += info.Size()
			return nil
		})
	}
	if files > 0 {
		slog.Info("stale build temps removed", "files", files, "bytes", bytes)
	}
}
