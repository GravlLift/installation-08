package main

// decode.go — the `decode` subcommand: a folder of theater film chunks in, the replay
// document JSON out, in process, with no LevelUp application code (internal/build).

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/llampwall/infinite-theater-3d/internal/build"
)

// decodeFlags is the parsed form of the `decode` arguments.
type decodeFlags struct {
	chunks   string
	manifest string
	stats    string
	mapName  string
	catalog  string
	match    string
	title    string
	gzip     bool
	out      string
}

// parseDecodeFlags turns `decode` arguments into decodeFlags. The map name and the
// catalog are required (the document cannot be built without the map bounds); the
// manifest and the match stats are optional by design (their absence degrades the
// document, never the build).
func parseDecodeFlags(args []string) (decodeFlags, error) {
	fs := flag.NewFlagSet("decode", flag.ContinueOnError)
	var f decodeFlags
	fs.StringVar(&f.chunks, "chunks", "", "folder holding chunk_00.bin, chunk_01.bin, ...")
	fs.StringVar(&f.manifest, "manifest", "", "film manifest (chunk index, types, start_ms); optional")
	fs.StringVar(&f.stats, "stats", "", "match stats JSON (gameVariantName, players, teamScores); optional")
	fs.StringVar(&f.mapName, "map", "", "display name of the map (catalog key, e.g. \"Live Fire\"); absent, it is resolved from the film's map asset id (chunk_00) through the embedded identity table")
	fs.StringVar(&f.catalog, "catalog", "", "map quantization catalog JSON; the embedded catalog is the default")
	fs.StringVar(&f.match, "match", "", "match id for the document; derived from the manifest or chunks folder name when absent")
	fs.StringVar(&f.title, "title", "", "title slug for the document")
	fs.BoolVar(&f.gzip, "gzip", false, "write the output as gzip-compressed JSON")
	fs.StringVar(&f.out, "out", "", "output document path (required)")
	err := fs.Parse(args)
	if err != nil {
		return f, err
	}
	if f.chunks == "" || f.out == "" {
		return f, fmt.Errorf("--chunks and --out are required")
	}
	return f, nil
}

// runDecode decodes the film and writes the document as JSON to f.out (gzip when asked),
// then prints the build report on stderr.
func runDecode(args []string) error {
	f, err := parseDecodeFlags(args)
	if err != nil {
		return err
	}
	doc, report, err := build.Build(context.Background(), build.Input{
		ChunkDir:     f.chunks,
		ManifestPath: f.manifest,
		StatsPath:    f.stats,
		CatalogPath:  f.catalog,
		MatchID:      f.match,
		TitleSlug:    f.title,
		MapName:      f.mapName,
	})
	if err != nil {
		return err
	}
	if err := writeDocument(f.out, f.gzip, doc); err != nil {
		return fmt.Errorf("write document %s: %w", f.out, err)
	}
	summary, err := json.Marshal(report)
	if err != nil {
		return fmt.Errorf("report: %w", err)
	}
	fmt.Fprintln(os.Stderr, string(summary))
	return nil
}

// writeDocument writes the document as pretty JSON, gzip-compressed when asked.
func writeDocument(path string, gzipOut bool, doc any) error {
	raw, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	var w io.Writer = file
	var closer io.Closer
	if gzipOut {
		gz := gzip.NewWriter(file)
		w = gz
		closer = gz
	}
	defer func() {
		if closer != nil {
			closer.Close()
		}
	}()
	if _, err := w.Write(append(raw, '\n')); err != nil {
		return err
	}
	return nil
}
