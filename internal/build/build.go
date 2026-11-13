// Package build turns a folder of theater film chunks into the replay document the viewer
// reads, in process, with no LevelUp application code: the vendored decoder is the whole
// pipeline (film load, killsource, statborg second decode, document assembly).
package build

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"

	"github.com/JGtm/halo-infinite-film-decoder/decfilm"
	"github.com/JGtm/halo-infinite-film-decoder/filmcache"
	"github.com/JGtm/halo-infinite-film-decoder/memguard"
	"github.com/JGtm/halo-infinite-film-decoder/replay"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// Input describes what a standalone decode is given. ChunkDir, CatalogPath and MapName are
// required; every other field is optional, and an absent input degrades the document,
// never the build.
type Input struct {
	// ChunkDir is the folder holding chunk_00.bin, chunk_01.bin, ...
	ChunkDir string
	// ManifestPath is the film manifest (chunk index, types, start_ms). Absent: the film
	// still loads, but entity records and the bomb clock are not datable (no score curve).
	ManifestPath string
	// StatsPath is the optional match-stats JSON (see Stats). Absent: the document builds
	// from the film alone (see Report).
	StatsPath string
	// CatalogPath is the map quantization catalog (map bounds and axis widths). Required:
	// without it the decoder emits raw quanta and BuildFromFilm refuses to produce a
	// document rather than wrong coordinates.
	CatalogPath string
	// MatchID names the match in the document. Absent: derived from the manifest file
	// name (the cache convention <short8>.json) or the chunks folder name, expanded to
	// <short8>-0000-0000-0000-000000000000.
	MatchID string
	// TitleSlug names the title in the document. Empty = the viewer default.
	TitleSlug string
	// MapName is the display name of the map, looked up in the catalog. The name written
	// in the film (chunk_00 match info) is never a catalog key; the catalog keys are
	// display names (e.g. "Live Fire"). Required.
	MapName string
}

// Stats is the optional match facts the decoder needs from outside the film, mirroring the
// LevelUp type port.MatchFacts (the players and team scores are the fields the document
// consumes). Player names are NOT part of it: the film's death feed and its own player
// table name every player, so a name-less document is still named.
type Stats struct {
	// GameVariantName is the playlist variant as the API names it ("Oddball", "CTF", ...).
	// Drives the mode gates (skull, flag, bomb, VIP layers) and the objective family.
	GameVariantName string `json:"gameVariantName"`
	// Players are the scoreboard rows. The (kills, deaths, assists) triple is the pairing
	// key of the statborg entity slot to the player, so a row with empty counters pairs
	// nothing and degrades the score curve and the objective attribution.
	Players []struct {
		XUID    string `json:"xuid"`
		TeamID  int    `json:"teamId"`
		Kills   int    `json:"kills"`
		Deaths  int    `json:"deaths"`
		Assists int    `json:"assists"`
	} `json:"players"`
	// TeamScores are the final scores, team 0 then team 1. Absent: the score resolution
	// falls back to the per-team frag sums.
	TeamScores *[2]int `json:"teamScores"`
}

// Report states, field by field, what the document is missing or degraded because of an
// absent input. WithoutStats and WithoutManifest name the document fields concerned.
type Report struct {
	MatchID         string   `json:"matchId"`
	MapModule       string   `json:"mapModule,omitempty"`
	Build           string   `json:"build,omitempty"`
	Tracks          int      `json:"tracks"`
	FrameCount      int      `json:"frameCount"`
	FrameInterval   int      `json:"frameIntervalMs"`
	DurationMS      int      `json:"durationMs,omitempty"`
	Kills           int      `json:"kills,omitempty"`
	Shots           int      `json:"shots,omitempty"`
	WithoutManifest []string `json:"withoutManifest,omitempty"`
	WithoutStats    []string `json:"withoutStats,omitempty"`
}

// ErrUnreadable is a clear error (never a panic) for a chunk folder that cannot be loaded.
var ErrUnreadable = errors.New("film chunks unreadable")

// Build decodes the film of in.ChunkDir and assembles the replay document. The decode is
// guarded by the decoder's memory sentinel (memguard), armed at its default ceiling: an
// out-of-memory decode stops with its reason instead of taking the machine hostage.
func Build(ctx context.Context, in Input) (replay.ReplayDocument, Report, error) {
	entry, err := resolveMapEntry(in)
	if err != nil {
		return replay.ReplayDocument{}, Report{}, err
	}
	matchID := resolveMatchID(in)
	guard := memguard.Arm(ctx, "infinite-theater-3d decode", memguard.DefaultLimitGiB,
		func(peak uint64) {
			slog.ErrorContext(ctx, "memory limit exceeded, stopping decode", "peak_bytes", peak)
			os.Exit(2)
		}, memguard.WithArmMessage("infinite-theater-3d decode: memory ceiling armed for this decode"))
	defer guard.Disarm()

	film, hadManifest := loadFilm(ctx, in, matchID)
	if film == nil {
		return replay.ReplayDocument{}, Report{}, fmt.Errorf("%w: %s", ErrUnreadable, in.ChunkDir)
	}
	report := newReport(matchID, in, entry.Module, hadManifest)
	report.Build = buildOfChunk0(film.Chunk(0))
	deaths := scanDeaths(ctx, matchID, film)
	killsource := decodeKills(ctx, matchID, film, entry)
	doc, err := replay.BuildFromFilm(ctx, matchID, in.TitleSlug, film,
		buildOptions(ctx, matchID, film, deaths, killsource, in, entry))
	if err != nil {
		return replay.ReplayDocument{}, report, fmt.Errorf("decode %s: %w", matchID, err)
	}
	fillReport(&report, doc, killsource)
	return doc, report, nil
}

// loadFilm loads the chunks once, merging the manifest index when it is readable. It
// returns a nil film (never an error) when the folder is not readable: the error is
// wrapped and raised by the caller at the single place that owns the message.
func loadFilm(ctx context.Context, in Input, matchID string) (*decfilm.Film, bool) {
	src := openManifest(ctx, in, matchID)
	film, err := decfilm.LoadDir(in.ChunkDir, srcMeta(src))
	if err != nil {
		slog.WarnContext(ctx, "film chunks unreadable", "err", err, "match_id", matchID, "dir", in.ChunkDir)
		return nil, src != nil
	}
	if src == nil {
		// Without a manifest LoadDir synthesized numbers from the file names: usable, but
		// nothing in the film is datable (entity records, bomb clock).
		slog.InfoContext(ctx, "film without manifest: replay without score curve", "match_id", matchID)
		return film, false
	}
	return film, true
}

// openManifest reads the optional manifest. An unreadable file degrades to nil (logged),
// it never fails the build: a film absent from a partial cache is the nominal case.
func openManifest(ctx context.Context, in Input, matchID string) *filmcache.Source {
	if in.ManifestPath == "" {
		return nil
	}
	raw, err := os.ReadFile(in.ManifestPath)
	if err != nil {
		slog.WarnContext(ctx, "film manifest unreadable", "err", err, "match_id", matchID, "path", in.ManifestPath)
		return nil
	}
	chunks, err := filmcache.ParseManifest(raw)
	if err != nil {
		slog.WarnContext(ctx, "film manifest invalid", "err", err, "match_id", matchID, "path", in.ManifestPath)
		return nil
	}
	return filmcache.NewSource(chunks, in.ChunkDir)
}

func srcMeta(src *filmcache.Source) []decfilm.ChunkMeta {
	if src == nil {
		return nil
	}
	return src.Meta()
}

// buildOfChunk0 reads the build key of chunk_00 (the film's own identity, a section
// ReadMatchInfo does not return on its own). Empty when the film carries no identity.
func buildOfChunk0(chunk0 []byte) string {
	return replay.CleDeChunk0(chunk0).Build
}

// scanDeaths reads the death feed once; its error degrades the lives and the attachments,
// it never fails the build (a film without a readable highlight chunk still replays).
func scanDeaths(ctx context.Context, matchID string, film *decfilm.Film) []types.Death {
	deaths, err := decfilm.ScanDeaths(film)
	if err != nil {
		slog.WarnContext(ctx, "death feed unreadable: lives and attachments degrade", "err", err, "match_id", matchID)
	}
	return deaths
}

// decodeKills decodes the kill feed; its error degrades the kill layers, never the build.
func decodeKills(ctx context.Context, matchID string, film *decfilm.Film, entry decfilm.MapQuantEntry) *decfilm.Result {
	opts := decfilm.DefaultOptions()
	opts.Carte = &entry
	res, err := decfilm.Decode(ctx, matchID, film, &opts)
	if err != nil {
		slog.WarnContext(ctx, "kill feed not decoded: kill layers degrade", "err", err, "match_id", matchID)
		return nil
	}
	return res
}

func newReport(matchID string, in Input, module string, hadManifest bool) Report {
	r := Report{MatchID: matchID, MapModule: module}
	if in.ManifestPath == "" || !hadManifest {
		r.WithoutManifest = []string{
			"scoreTimeline (entity records are not datable without chunk start_ms)",
			"bombArmings (the armament ring is dated on the manifest clock)",
		}
	}
	if in.StatsPath == "" {
		r.WithoutStats = withoutStatsFields()
	}
	return r
}

// withoutStatsFields lists, in the order the document exposes them, the fields that are
// empty or degraded when no match stats are provided.
func withoutStatsFields() []string {
	return []string{
		"scoreTimeline players (no scoreboard rows to pair the statborg slots to)",
		"scoreTimeline teamScores (final scores absent; the curve pairs by frag sums instead)",
		"objectives attribution (the per-round identity bridge has no match lines)",
		"identity scoreboard resolution (participants absent from the identity registry)",
		"coverage.teams control (the film's teams are not checked against the scoreboard)",
		"zoneStates team ownership (ZoneInput.TeamByXUID empty)",
		"bombStats bomb_carriers_killed (no resolved killer/victim pairs)",
	}
}

func fillReport(r *Report, doc replay.ReplayDocument, killsource *decfilm.Result) {
	r.Tracks = len(doc.Tracks)
	r.FrameCount = doc.FrameCount
	r.FrameInterval = doc.FrameIntervalMS
	r.DurationMS = doc.DurationMS
	if killsource != nil {
		r.Kills = len(killsource.Kills)
	}
	r.Shots = len(doc.Shots)
}
