// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package build

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// TestDecodeRealFilm — the end-to-end decode of a real film, run only when IT3D_FILM_DIR
// names a folder of film chunks (the acceptance film on this machine). It builds the
// document through the same public entry as the CLI and checks the shape the viewer reads:
// the frame grid, the tracks, and the private additions present and non-empty (full-rate
// samples on a track, stances, drawn-weapon changes, damages, gestures, ammo reads, shots).
//
// The map quantization catalog (the map bounds, a game-derived reference) is taken from
// IT3D_CATALOG_PATH when set, otherwise the test is skipped: the catalog is not part of
// the film and is never committed here.
func TestDecodeRealFilm(t *testing.T) {
	dir := os.Getenv("IT3D_FILM_DIR")
	if dir == "" {
		t.Skip("IT3D_FILM_DIR not set: no film to decode")
	}
	catalogPath := os.Getenv("IT3D_CATALOG_PATH")
	if catalogPath == "" {
		t.Skip("IT3D_CATALOG_PATH not set: the map quantization catalog is required and not part of the film")
	}
	mapName := os.Getenv("IT3D_MAP_NAME")
	if mapName == "" {
		mapName = "Live Fire"
	}
	matchID := filepath.Base(dir)
	in := Input{
		ChunkDir:    dir,
		CatalogPath: catalogPath,
		MapName:     mapName,
		MatchID:     matchID,
		TitleSlug:   "halo_infinite",
	}
	if manifest := filepath.Join(filepath.Dir(dir), filepath.Base(dir)+".json"); fileExists(manifest) {
		in.ManifestPath = manifest
	}
	doc, report, err := Build(context.Background(), in)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if report.MatchID != matchID {
		t.Fatalf("report.MatchID = %q, want %q", report.MatchID, matchID)
	}
	if doc.FrameIntervalMS != 33 {
		t.Errorf("frame interval = %d, want the decoder default 33", doc.FrameIntervalMS)
	}
	if doc.FrameCount == 0 || doc.DurationMS == 0 {
		t.Errorf("empty film: frameCount=%d durationMs=%d", doc.FrameCount, doc.DurationMS)
	}
	if len(doc.Tracks) == 0 {
		t.Fatal("no tracks in the document")
	}
	// The private additions the port must carry, present and non-empty (document-level).
	if len(doc.Stances) == 0 {
		t.Errorf("stances empty: %s", reportSummary(report))
	}
	if len(doc.DrawnWeapons) == 0 {
		t.Errorf("drawn-weapon changes empty: %s", reportSummary(report))
	}
	if len(doc.Damages) == 0 {
		t.Errorf("damages empty: %s", reportSummary(report))
	}
	if len(doc.Actions) == 0 {
		t.Errorf("gestures empty: %s", reportSummary(report))
	}
	if len(doc.AmmoReads) == 0 {
		t.Errorf("ammo reads empty: %s", reportSummary(report))
	}
	if len(doc.Shots) == 0 {
		t.Errorf("shots empty: %s", reportSummary(report))
	}
	// At least one track carries the full-rate samples (the same life at the film's rate).
	fullRate := 0
	for _, tr := range doc.Tracks {
		if tr.FullRate != nil {
			fullRate++
		}
	}
	if fullRate == 0 {
		t.Errorf("no track carries full-rate samples: %s", reportSummary(report))
	}
	t.Logf("document: %s fullRateTracks=%d schema=%d", reportSummary(report), fullRate, doc.SchemaVersion)
}

// reportSummary renders the build report on one line for a failure message.
func reportSummary(r Report) string {
	return fmt.Sprintf("tracks=%d frames=%d kills=%d shots=%d", r.Tracks, r.FrameCount, r.Kills, r.Shots)
}

func fileExists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}
