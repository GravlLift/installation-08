// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// import.go — the `import` subcommand: copy a film (chunks, optional manifest and stats)
// into the local store, build its replay document (internal/build), and write
// replay.json.gz and match.json. Importing the same match again replaces it.

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
	"github.com/JGtm/halo-infinite-film-decoder/replay"

	"github.com/llampwall/infinite-theater-3d/internal/build"
	"github.com/llampwall/infinite-theater-3d/internal/meshbuild"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// importFlags is the parsed form of the `import` arguments.
type importFlags struct {
	chunks   string
	manifest string
	mvar     string
	stats    string
	match    string
	mapName  string
	catalog  string
	dataDir  string
	rebuild  bool
}

// parseImportFlags turns `import` arguments into importFlags. The chunks folder and the
// map name are required; the manifest, stats, match id and catalog are optional.
func parseImportFlags(args []string) (importFlags, error) {
	fs := flag.NewFlagSet("import", flag.ContinueOnError)
	var f importFlags
	fs.StringVar(&f.chunks, "chunks", "", "folder holding chunk_00.bin, chunk_01.bin, ... (required)")
	fs.StringVar(&f.manifest, "manifest", "", "film manifest; copied into the store (optional)")
	fs.StringVar(&f.mvar, "mvar", "", "map variant; copied into the store (optional)")
	fs.StringVar(&f.stats, "stats", "", "match stats JSON; copied into the store (optional)")
	fs.StringVar(&f.match, "match", "", "match id for the store and the document; derived when absent")
	fs.StringVar(&f.mapName, "map", "", "display name of the map (catalog key, e.g. \"Live Fire\"); absent, it is resolved from the film's map asset id (chunk_00) through the embedded identity table")
	fs.StringVar(&f.catalog, "catalog", "", "map quantization catalog JSON; the embedded catalog is the default")
	fs.StringVar(&f.dataDir, "data", "", dataDirHelp)
	err := fs.Parse(args)
	if err != nil {
		return f, err
	}
	if f.chunks == "" {
		return f, fmt.Errorf("--chunks is required")
	}
	return f, nil
}

// runImport copies the film into the store, builds the document, and writes the match
// summary. The match id is resolved the same way a decode resolves it (the --match flag,
// then the manifest or chunks folder name).
func runImport(args []string) error {
	f, err := parseImportFlags(args)
	if err != nil {
		return err
	}
	dataDir, err := dataDirFor(f.dataDir)
	if err != nil {
		return err
	}
	root, err := store.New(dataDir)
	if err != nil {
		return err
	}
	matchID := resolveImportMatchID(f)
	if !store.MatchIDValid(matchID) {
		return fmt.Errorf("match id %q is not valid (hex and dashes only); pass --match with a clean id", matchID)
	}
	if err := copyFilmToStore(root, matchID, f); err != nil {
		return err
	}
	return buildStored(root, matchID, f)
}

func buildStored(root *store.Root, matchID string, f importFlags) error {
	chunkDir, _ := root.MatchChunksDir(matchID)
	_, zone, err := matchObjectiveCatalog(root, matchID)
	if err != nil {
		slog.Warn("derive build objectives", "id", matchID, "err", err)
	}
	doc, report, err := build.Build(context.Background(), build.Input{
		ChunkDir:     chunkDir,
		Zone:         zone,
		ManifestPath: optionalPath(root.MatchManifestPath(matchID)),
		StatsPath:    optionalPath(root.MatchStatsPath(matchID)),
		CatalogPath:  f.catalog,
		MatchID:      matchID,
		MapName:      f.mapName,
		MatchMap:     storedMapLink(root, matchID),
		ForgeMap:     storedForgeMap(root, matchID),
	})
	if err != nil {
		return fmt.Errorf("build %s: %w", matchID, err)
	}
	gz, err := writeGzip(doc)
	if err != nil {
		return fmt.Errorf("gzip %s: %w", matchID, err)
	}
	replayPath, _ := root.MatchReplayPath(matchID)
	if err := root.WriteFile(replayPath, gz); err != nil {
		return fmt.Errorf("write replay %s: %w", matchID, err)
	}
	details, err := json.Marshal(report.KillDetails)
	if err != nil {
		return fmt.Errorf("encode kill details %s: %w", matchID, err)
	}
	if err := root.WriteFile(variantPath(root, matchID, "kill-details.json"), details); err != nil {
		return fmt.Errorf("write kill details %s: %w", matchID, err)
	}
	events, err := json.Marshal(report.Events)
	if err != nil {
		return fmt.Errorf("encode events %s: %w", matchID, err)
	}
	if err := root.WriteFile(variantPath(root, matchID, "events.json"), events); err != nil {
		return fmt.Errorf("write events %s: %w", matchID, err)
	}
	if f.rebuild {
		fmt.Printf("rebuilt %s\n", matchID)
		return nil
	}
	if err := root.SaveMatchMeta(matchID, store.Match{
		MatchID:    matchID,
		MapName:    report.MapName,
		MapAssetID: report.MapAssetID,
		MapModule:  report.MapModule,
		Build:      report.Build,
		DurationMS: report.DurationMS,
		Players:    rosterOf(doc, optionalPath(root.MatchStatsPath(matchID))),
		ImportedAt: time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		return fmt.Errorf("write match summary %s: %w", matchID, err)
	}
	fmt.Printf("imported %s (map %s, build %s)\n", matchID, report.MapName, report.Build)
	return nil
}

// rosterOf projects the document's roster onto the match summary's players: the film's
// own table (name, xuid, team, bot flag), with the stats' names preferred where a stats
// file was given (the operator's data wins over the film's death feed). A roster the
// document does not carry yields an empty player list, not an error.
func rosterOf(doc replay.ReplayDocument, statsPath string) []store.Player {
	var stats struct {
		Players []struct {
			Name   string `json:"name"`
			XUID   string `json:"xuid"`
			TeamID int    `json:"teamId"`
		} `json:"players"`
	}
	if statsPath != "" {
		if raw, err := os.ReadFile(statsPath); err == nil {
			_ = json.Unmarshal(raw, &stats)
		}
	}
	byXUID := make(map[string]string, len(stats.Players))
	teamByXUID := make(map[string]int, len(stats.Players))
	for _, p := range stats.Players {
		if p.XUID != "" {
			byXUID[p.XUID] = p.Name
			teamByXUID[p.XUID] = p.TeamID
		}
	}
	out := make([]store.Player, 0, len(doc.Roster))
	for _, e := range doc.Roster {
		name := e.Name
		if n, ok := byXUID[e.XUID]; ok && n != "" {
			name = n
		}
		pl := store.Player{Name: name, IsBot: e.Bot}
		if e.XUID != "" {
			pl.XUID = e.XUID
		}
		if e.Team != nil {
			pl.TeamID = *e.Team
		} else if t, ok := teamByXUID[e.XUID]; ok && e.XUID != "" {
			// The film did not name this player's team (27de812c: Mikeyy AB): Halo's own match
			// stats do. Without this the player defaulted to team 0 and a 4v4 listed as 5v3.
			pl.TeamID = t
		}
		out = append(out, pl)
	}
	return out
}

// storedMapLink reads the map the match's stored map-mode pair names (MapLink: asset id and
// public name; the name may be a plain string or a {"value": ...} object, as the service
// writes either). A match without that file yields an empty link: the build then resolves
// the map from the identity table alone.
func storedMapLink(root *store.Root, matchID string) build.MapLink {
	link := object(contextReadJSON(variantPath(root, matchID, "map-mode-pair.json"))["MapLink"])
	name := textValue(link["PublicName"])
	if name == "" {
		name = textValue(object(link["PublicName"])["value"])
	}
	return build.MapLink{AssetID: textValue(link["AssetId"]), Name: name}
}

// storedForgeMap reads the Forge canvas the match's stored map variant is built on and the map's
// public name recorded at fetch (build.Stats.MapName); nil without a variant, or when its
// level_id names no Forge canvas (a native map). The decode only consults it for a map the
// identity table and the bounds catalog cannot resolve (build.Input.ForgeMap).
func storedForgeMap(root *store.Root, matchID string) *build.ForgeMap {
	statsPath, err := root.MatchStatsPath(matchID)
	if err != nil {
		return nil
	}
	blob, err := os.ReadFile(filepath.Join(filepath.Dir(statsPath), "map.mvar")) //nolint:gosec // store path
	if err != nil {
		return nil
	}
	v, err := mapvar.Parse(blob)
	if err != nil {
		return nil
	}
	canvas, ok := meshbuild.CanvasOfLevelID(v.LevelID)
	if !ok {
		return nil
	}
	var stats build.Stats
	if raw, err := os.ReadFile(statsPath); err == nil { //nolint:gosec // store path
		_ = json.Unmarshal(raw, &stats)
	}
	return &build.ForgeMap{Canvas: canvas, Name: stats.MapName}
}

// optionalPath returns a store path, or the empty string when it cannot be computed (the
// id was already validated, so this only happens on a bug; an empty path means "absent").
func optionalPath(p string, err error) string {
	if err != nil {
		return ""
	}
	return p
}

// resolveImportMatchID names the imported match: the --match flag wins, otherwise the
// manifest file name (the cache convention <short8>.json) or the chunks folder name,
// expanded to the <short8>-0000-... form (the same rule a decode applies).
func resolveImportMatchID(f importFlags) string {
	if f.match != "" {
		return f.match
	}
	for _, p := range []string{f.manifest, f.chunks} {
		if p == "" {
			continue
		}
		base := filepath.Base(p)
		base = base[:len(base)-len(filepath.Ext(base))]
		if build.IsShort8(base) {
			return base + "-0000-0000-0000-000000000000"
		}
	}
	return ""
}

// copyFilmToStore copies the chunks folder and the optional manifest/stats into the
// store, atomically.
func copyFilmToStore(root *store.Root, matchID string, f importFlags) error {
	chunks, err := root.MatchChunksDir(matchID)
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(f.chunks)
	if err != nil {
		return fmt.Errorf("read chunks %s: %w", f.chunks, err)
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		src := filepath.Join(f.chunks, e.Name())
		dst := filepath.Join(chunks, e.Name())
		if err := root.WriteCopy(dst, src); err != nil {
			return fmt.Errorf("copy chunk %s: %w", e.Name(), err)
		}
	}
	if f.manifest != "" {
		dst, _ := root.MatchManifestPath(matchID)
		if err := root.WriteCopy(dst, f.manifest); err != nil {
			return fmt.Errorf("copy manifest: %w", err)
		}
	}
	if f.mvar != "" {
		if err := root.WriteCopy(variantPath(root, matchID, "map.mvar"), f.mvar); err != nil {
			return fmt.Errorf("copy map variant: %w", err)
		}
	}
	if f.stats != "" {
		dst, _ := root.MatchStatsPath(matchID)
		if err := root.WriteCopy(dst, f.stats); err != nil {
			return fmt.Errorf("copy stats: %w", err)
		}
	}
	return nil
}

// writeGzip compresses the document as JSON into a gzip byte slice (the caller writes it
// to the store atomically).
func writeGzip(doc any) ([]byte, error) {
	raw, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write(append(raw, '\n')); err != nil {
		return nil, err
	}
	if err := gz.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
