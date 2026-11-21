// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// serve_recode.go — auto re-decode of stored matches whose replay document is behind the
// current decoder. When a match is opened and its stored replay.json.gz records a schema
// version older than replay.SchemaVersion, the server re-decodes the film from the stored
// chunks as a job on the mesh build runner (the viewer sees it in the Optimizing assets
// banner), and the open waits on that job with its progress (the map build's own behavior:
// the old document is not served while the new one is still missing). A match whose chunks
// are missing or fail to decode keeps its old document (a warning is logged); the document
// is written to a temp file and renamed, so it is never left half-written.

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/JGtm/halo-infinite-film-decoder/replay"
	"github.com/llampwall/infinite-theater-3d/internal/build"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// recodePrefix names a match's document re-decode job key: recode:<id>.
const recodePrefix = "recode:"

// recodeJobKey is a match's re-decode job key.
func recodeJobKey(id string) string { return recodePrefix + id }

// recodeJobID inverts recodeJobKey: the match id, and whether key names a re-code job.
func recodeJobID(key string) (string, bool) {
	id, ok := strings.CutPrefix(key, recodePrefix)
	return id, ok && store.MatchIDValid(id)
}

// recodeReady says whether the match's stored document is current: replay.json.gz is on
// disk and records the decoder's current schema version. A document whose schemaVersion
// the decoder no longer emits is not ready, so the build flow re-decodes it (the same
// mechanism that rebuilds a map GLB in an older build format, jobModuleOutdated).
func recodeReady(root *store.Root, id string) bool {
	sv, ok := storedReplaySchemaVersion(root, id)
	return ok && sv >= replay.SchemaVersion
}

// storedReplaySchemaVersion reads the schemaVersion field of the stored replay document.
// It reads only as much of the document as it needs: the gzip bytes are decompressed into
// a buffer (a document is a few MB at most), and the buffer is scanned for the key; the
// value is the first JSON number that follows it (schemaVersion is a small integer, so a
// number read right after the key is always its value, and the scan never touches the
// document's hundreds of thousands of track points). ok false when the document is absent,
// unreadable, or carries no schemaVersion (nothing to compare: the match is served as-is).
func storedReplaySchemaVersion(root *store.Root, id string) (int, bool) {
	path, err := root.MatchReplayPath(id)
	if err != nil {
		return 0, false
	}
	raw, err := os.ReadFile(path) //nolint:gosec // store path
	if err != nil {
		return 0, false
	}
	doc, err := gunzipBytes(raw)
	if err != nil {
		// A document that is not gzip is not one this build wrote; it is served as-is.
		return 0, false
	}
	key := `,"schemaVersion":`
	i := bytes.Index(doc, []byte(key))
	if i < 0 {
		// The key can also be the object's first field.
		i = bytes.Index(doc, []byte(`"schemaVersion":`))
		if i < 0 {
			return 0, false
		}
	}
	rest := doc[i+len(key):]
	j := 0
	for j < len(rest) && (rest[j] < '0' || rest[j] > '9') && rest[j] != '-' {
		j++
	}
	n := j
	for n < len(rest) && rest[n] >= '0' && rest[n] <= '9' {
		n++
	}
	if n == j {
		return 0, false
	}
	sv, err := strconv.Atoi(string(rest[j:n]))
	if err != nil {
		return 0, false
	}
	return sv, true
}

// recodeAttempted records the matches this process already tried to re-code, so a film
// that cannot be decoded is tried once, not on every request (the refreshLegacyKillDetails
// pattern). The value is the failure reason; a re-code that succeeded is not recorded
// (the document is now current and the ready check answers before the map is consulted).
var recodeAttempted sync.Map

// buildMatchRecode is the runner's build for a recode:<id> job: it re-decodes the match's
// film from its stored chunks (the build.Build pipeline, in process; the job's context is
// the runner's, so the decode's memory guard and its context are the job's own, not the
// server's), reports its progress through the runner's context reporter (the viewer's
// Optimizing assets banner reads it via GET /api/builds), and writes the new document and
// its sidecars. A failure (missing film, an unreadable chunk, a decoder error) leaves the
// stored document in place: the write is a temp file and a rename (store.WriteFile), and
// it happens only after the build succeeded.
func buildMatchRecode(ctx context.Context, root *store.Root, id string) (meshjobs.BuildResult, error) {
	reporter := meshjobs.ProgressFromContext(ctx)
	rep := func(frac float64, stage string) {
		if reporter != nil {
			reporter.Report(frac, stage)
		}
	}
	meta, err := root.MatchMeta(id)
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	chunks, err := root.MatchChunksDir(id)
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	if _, err := os.Stat(chunks); err != nil {
		return meshjobs.BuildResult{}, err
	}
	rep(0.05, "decoding")
	_, zone, err := matchObjectiveCatalog(root, id)
	if err != nil {
		slog.Warn("derive build objectives", "id", id, "err", err)
	}
	doc, report, err := build.Build(ctx, build.Input{
		ChunkDir:     chunks,
		Zone:         zone,
		ManifestPath: optionalPath(root.MatchManifestPath(id)),
		StatsPath:    optionalPath(root.MatchStatsPath(id)),
		MatchID:      id,
		MapName:      meta.MapName,
		MatchMap:     storedMapLink(root, id),
		ForgeMap:     storedForgeMap(root, id),
	})
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	rep(0.9, "writing")
	if err := writeRecodeDocument(root, id, doc, report); err != nil {
		return meshjobs.BuildResult{}, err
	}
	rep(1.0, "done")
	// Confirm the document landed at the current schema before the job reports success: a
	// build that wrote an older one (a regression in the decoder) is not ready.
	sv, ok := storedReplaySchemaVersion(root, id)
	if !ok || sv < replay.SchemaVersion {
		return meshjobs.BuildResult{}, os.ErrNotExist
	}
	return meshjobs.BuildResult{Bytes: int64(storedReplayBytes(root, id))}, nil
}

// refreshMatchSummaryAfterRecode re-derives the match summary's players from the new
// document, preserving the stored summary's other fields. It re-uses the import's own
// projection (rosterOf, which applies the stored stats' names where they exist), so a
// re-code never names a player differently than an import of the same match would.
func refreshMatchSummaryAfterRecode(root *store.Root, id string, meta store.Match) error {
	raw, err := root.LoadReplay(id)
	if err != nil {
		return err
	}
	doc, err := gunzipBytes(raw)
	if err != nil {
		return err
	}
	var document replay.ReplayDocument
	if err := json.Unmarshal(doc, &document); err != nil {
		return err
	}
	players := rosterOf(document, optionalPath(root.MatchStatsPath(id)))
	return root.SaveMatchMeta(id, store.Match{
		MatchID:    meta.MatchID,
		MapName:    meta.MapName,
		MapAssetID: meta.MapAssetID,
		MapModule:  meta.MapModule,
		Build:      meta.Build,
		DurationMS: meta.DurationMS,
		Players:    players,
		ImportedAt: meta.ImportedAt,
	})
}

// storedReplayBytes is the size of the stored document in bytes (0 when it is gone).
func storedReplayBytes(root *store.Root, id string) int {
	path, err := root.MatchReplayPath(id)
	if err != nil {
		return 0
	}
	if st, err := os.Stat(path); err == nil {
		return int(st.Size())
	}
	return 0
}

// recodeMatch enqueues the match's re-decode as a build-runner job (it goes ahead of the
// background builds: the viewer is waiting on it) and returns the job's key. ok false
// (nothing enqueued) when the match cannot be re-coded at all: no build runner, or the
// stored film is gone (the document, if any, is served as-is and a warning is logged).
func (h serverHandlers) recodeMatch(id string) (string, bool) {
	if h.jobs == nil {
		return "", false
	}
	chunks, err := h.root.MatchChunksDir(id)
	if err != nil {
		return "", false
	}
	if _, err := os.Stat(chunks); err != nil {
		slog.Warn("match re-code skipped, film chunks missing", "match_id", id, "err", err)
		return "", false
	}
	key := recodeJobKey(id)
	h.jobs.EnqueueFirst(key)
	return key, true
}

// recodeFailedInProcess says whether this process already failed a re-code of the match:
// the caller then serves the stored document (with its own schema version) instead of
// waiting on a job that would only fail again.
func recodeFailedInProcess(id string) bool {
	_, ok := recodeAttempted.Load(id)
	return ok
}

// noteRecodeFailed records that this process failed a re-code of the match (once per
// process, with the reason the log carries).
func noteRecodeFailed(id string, err error) {
	recodeAttempted.Store(id, err.Error())
}

// runRecodeAll is the `recode-all` subcommand: it re-decodes every stored match whose
// document is behind the decoder, in order, and prints one line per match (the same
// wording as `rebuild`). A match whose chunks are missing or fail to decode keeps its
// document; its line names the reason.
func runRecodeAll(args []string) error {
	fs := flag.NewFlagSet("recode-all", flag.ContinueOnError)
	data := fs.String("data", "", dataDirHelp)
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("unexpected arguments: %v", fs.Args())
	}
	dir, err := dataDirFor(*data)
	if err != nil {
		return err
	}
	root, err := store.New(dir)
	if err != nil {
		return err
	}
	ms, err := root.ListMatches()
	if err != nil {
		return err
	}
	for _, meta := range ms {
		id := meta.MatchID
		// Only matches with a stored document behind the decoder are re-coded; a current
		// document is left exactly as it is.
		if sv, ok := storedReplaySchemaVersion(root, id); ok && sv >= replay.SchemaVersion {
			continue
		}
		chunks, err := root.MatchChunksDir(id)
		if err != nil || fileGone(chunks) {
			fmtRecodeLine(id, "skipped (film chunks missing)")
			continue
		}
		zone, err := objectiveZoneForRecode(root, id)
		if err != nil {
			slog.Warn("derive build objectives", "id", id, "err", err)
		}
		doc, report, err := build.Build(context.Background(), build.Input{
			ChunkDir:     chunks,
			Zone:         zone,
			ManifestPath: optionalPath(root.MatchManifestPath(id)),
			StatsPath:    optionalPath(root.MatchStatsPath(id)),
			MatchID:      id,
			MapName:      meta.MapName,
			MatchMap:     storedMapLink(root, id),
			ForgeMap:     storedForgeMap(root, id),
		})
		if err != nil {
			fmtRecodeLine(id, "failed: "+err.Error())
			continue
		}
		if err := writeRecodeDocument(root, id, doc, report); err != nil {
			fmtRecodeLine(id, "failed: "+err.Error())
			continue
		}
		fmtRecodeLine(id, "re-coded (map "+report.MapName+", schema "+fmt.Sprintf("%d", doc.SchemaVersion)+")")
	}
	return nil
}

// fmtRecodeLine prints one match's re-code line (stdout, one per match).
func fmtRecodeLine(id, what string) { fmt.Println(id + ": " + what) }

// fileGone says whether path (a folder) is absent (the error a stat reports for it).
func fileGone(path string) bool { _, err := os.Stat(path); return os.IsNotExist(err) }

// objectiveZoneForRecode is the zone input a re-code derives for a stored match (the same
// derivation an import uses, matchObjectiveCatalog, without its error surfacing to the
// caller's own report).
func objectiveZoneForRecode(root *store.Root, id string) (replay.ZoneInput, error) {
	_, zone, err := matchObjectiveCatalog(root, id)
	return zone, err
}

// writeRecodeDocument writes the new document and its sidecars (kill-details.json,
// events.json) exactly as buildStored does (temp file + rename, via the store), and
// refreshes the match summary's players the way a re-code should (the roster may have
// changed under the new decoder).
func writeRecodeDocument(root *store.Root, id string, doc replay.ReplayDocument, report build.Report) error {
	gz, err := writeGzip(doc)
	if err != nil {
		return err
	}
	replayPath, _ := root.MatchReplayPath(id)
	if err := root.WriteFile(replayPath, gz); err != nil {
		return err
	}
	details, err := json.Marshal(report.KillDetails)
	if err != nil {
		return err
	}
	if err := root.WriteFile(variantPath(root, id, "kill-details.json"), details); err != nil {
		return err
	}
	events, err := json.Marshal(report.Events)
	if err != nil {
		return err
	}
	if err := root.WriteFile(variantPath(root, id, "events.json"), events); err != nil {
		return err
	}
	meta, err := root.MatchMeta(id)
	if err == nil {
		if err := refreshMatchSummaryAfterRecode(root, id, meta); err != nil {
			slog.Warn("match summary refresh after re-code failed", "match_id", id, "err", err)
		}
	}
	return nil
}
