package build

// resolve.go — the inputs that a standalone decode resolves before any film byte is read:
// the map entry of the catalog, the match id, and the projections of the match stats onto
// the decoder option types.

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/JGtm/halo-infinite-film-decoder/decfilm"
	"github.com/JGtm/halo-infinite-film-decoder/replay"
	"github.com/JGtm/halo-infinite-film-decoder/types"

	"github.com/llampwall/infinite-theater-3d/internal/refdata"
)

// resolveMapEntry looks the map up in the catalog. It is fatal by the decoder's own rule:
// without the bounds and the axis widths of the map the decoder emits raw quanta, and
// BuildFromFilm refuses to produce a document rather than wrong coordinates.
func resolveMapEntry(in Input) (decfilm.MapQuantEntry, error) {
	if in.MapName == "" {
		return decfilm.MapQuantEntry{}, fmt.Errorf("map name is required: pass the display name of the map (e.g. %q), not the film's asset id", "Live Fire")
	}
	catalog, err := catalogOf(in)
	if err != nil {
		return decfilm.MapQuantEntry{}, err
	}
	entry, err := catalog.Lookup(in.MapName)
	if err != nil {
		return decfilm.MapQuantEntry{}, fmt.Errorf("map %q: %w", in.MapName, err)
	}
	return entry, nil
}

// catalogOf loads the map catalog: an explicit path wins, the embedded reference catalog
// is the default (the standalone ships it, the user owns no reference files).
func catalogOf(in Input) (*decfilm.MapQuantCatalog, error) {
	if in.CatalogPath == "" {
		return refdata.MapQuantBounds()
	}
	return decfilm.LoadMapQuantCatalog(in.CatalogPath)
}

// resolveMatchID names the match of the document. An explicit MatchID wins; otherwise the
// manifest file name (the cache convention <short8>.json) or the chunks folder name is
// expanded to the <short8> form with zero groups, which the viewer treats as a local id.
func resolveMatchID(in Input) string {
	if in.MatchID != "" {
		return in.MatchID
	}
	for _, p := range []string{in.ManifestPath, in.ChunkDir} {
		if p == "" {
			continue
		}
		base := strings.TrimSuffix(filepath.Base(p), filepath.Ext(filepath.Base(p)))
		if isShort8(base) {
			return base + "-0000-0000-0000-000000000000"
		}
	}
	return ""
}

// isShort8 says whether s is the short form of a match id: eight hex characters.
func isShort8(s string) bool {
	if len(s) != 8 {
		return false
	}
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9':
		case r >= 'a' && r <= 'f':
		case r >= 'A' && r <= 'F':
		default:
			return false
		}
	}
	return true
}

// linesOfStats projects the match stats onto the three decoder option types that consume
// them: the pairing lines, the team table and the roster of xuids.
func linesOfStats(s Stats) ([]types.PlayerLine, map[string]int, []uint64) {
	lines := make([]types.PlayerLine, 0, len(s.Players))
	teams := make(map[string]int, len(s.Players))
	for _, p := range s.Players {
		if p.XUID == "" {
			continue
		}
		lines = append(lines, types.PlayerLine{
			XUID: p.XUID, Kills: p.Kills, Deaths: p.Deaths, Assists: p.Assists,
		})
		teams[p.XUID] = p.TeamID
	}
	return lines, teams, replay.RosterXUIDsOf(xuidStrings(s))
}

// xuidStrings is the roster form of the scoreboard xuids (decimals and bot ids).
func xuidStrings(s Stats) []string {
	out := make([]string, 0, len(s.Players))
	for _, p := range s.Players {
		if p.XUID != "" {
			out = append(out, p.XUID)
		}
	}
	return out
}

// participantsOf projects the scoreboard rows onto the identity-registry participants
// (the board names what the film does not table).
func participantsOf(s Stats) []replay.Participant {
	out := make([]replay.Participant, 0, len(s.Players))
	for _, p := range s.Players {
		if p.XUID == "" {
			continue
		}
		out = append(out, replay.Participant{ID: p.XUID})
	}
	return out
}

// scoreInput assembles the score-curve entry. Without match lines the entry is nil: the
// document then publishes no score layer at all (the decoder's rule for "nothing was
// provided"), not a curve of empty pairs.
func scoreInput(recs []types.StatRecord, lines []types.PlayerLine, teams map[string]int, s Stats) *replay.ScoreInput {
	if len(recs) == 0 || len(lines) == 0 {
		return nil
	}
	return &replay.ScoreInput{
		Records:    recs,
		Lines:      lines,
		TeamByXUID: teams,
		TeamScores: s.TeamScores,
	}
}

// deathInstants translates the death feed into the form the per-round identity bridge expects.
func deathInstants(deaths []types.Death) []types.DeathInstant {
	out := make([]types.DeathInstant, 0, len(deaths))
	for _, d := range deaths {
		out = append(out, types.DeathInstant{
			XUID:   formatXUID(d.XUID),
			TimeMS: int(d.TimeMS),
		})
	}
	return out
}

// jsonUnmarshal is a named seam so the stats reader and a test can share one decode rule.
func jsonUnmarshal(raw []byte, v any) error {
	return json.Unmarshal(raw, v)
}
