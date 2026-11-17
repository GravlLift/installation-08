// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package build

// resolve.go — the inputs that a standalone decode resolves before any film byte is read:
// the map entry of the catalog, the match id, and the projections of the match stats onto
// the decoder option types.

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/JGtm/halo-infinite-film-decoder/decfilm"
	"github.com/JGtm/halo-infinite-film-decoder/filmcache"
	"github.com/JGtm/halo-infinite-film-decoder/replay"
	"github.com/JGtm/halo-infinite-film-decoder/types"

	"github.com/llampwall/infinite-theater-3d/internal/refdata"
)

// resolveMapEntry names the map and looks it up in the catalog. It is fatal by the
// decoder's own rule: without the bounds and the axis widths of the map the decoder emits
// raw quanta, and BuildFromFilm refuses to produce a document rather than wrong
// coordinates.
//
// The name is a user override when given; otherwise it is resolved from the film alone:
// chunk_00 carries a map asset id, and the identity table (internal/refdata) says what that
// map is. The bounds themselves are never in the film.
func resolveMapEntry(in Input) (decfilm.MapQuantEntry, error) {
	name := in.MapName
	if name == "" {
		resolved, err := mapNameFromFilm(in)
		if err != nil {
			return decfilm.MapQuantEntry{}, err
		}
		name = resolved
	}
	catalog, err := catalogOf(in)
	if err != nil {
		return decfilm.MapQuantEntry{}, err
	}
	entry, err := catalog.Lookup(name)
	if err != nil {
		return decfilm.MapQuantEntry{}, fmt.Errorf("map %q: %w", name, err)
	}
	return entry, nil
}

// mapNameFromFilm resolves the map's display name from the film's own identity: chunk_00's
// map asset id looked up in the identity table. A film without a readable chunk_00, or an
// asset id the table does not hold, is a clear error that says to pass --map.
func mapNameFromFilm(in Input) (string, error) {
	chunk0, err := readChunk0(in.ChunkDir, in.ManifestPath)
	if err != nil {
		return "", fmt.Errorf("cannot resolve the map from the film (pass --map with the display name): %w", err)
	}
	info, err := decfilm.ReadMatchInfo(chunk0)
	if err != nil {
		return "", fmt.Errorf("cannot resolve the map from the film (pass --map with the display name): %w", err)
	}
	if info.CarteAssetID == nil {
		return "", fmt.Errorf("the film carries no map asset id: pass --map with the display name of the map")
	}
	name, err := mapNameOfAsset(guidString(*info.CarteAssetID), in.MatchMap)
	if err != nil {
		return "", fmt.Errorf("cannot resolve the map from the film (pass --map with the display name): %w", err)
	}
	return name, nil
}

// MapLink is the map the match's own metadata names: the map asset id and its public display
// name, as the service's map-mode pair (MapLink) publishes them for the match.
type MapLink struct {
	AssetID string
	Name    string
}

// mapNameOfAsset names the film's map asset id: the identity table first, then the match's
// own map link when it names that same asset id. The table cannot list every published asset
// (each playlist republishes a map under a new asset id, e.g. its "- Ranked" copy), while the
// match metadata always names the map it was played on; the bounds catalog lookup that
// follows normalizes the name, so a playlist copy finds the bounds of its map. An id neither
// source names is an error.
func mapNameOfAsset(assetID string, link MapLink) (string, error) {
	ident, err := refdata.LookupMapIdentity(assetID)
	if err == nil {
		return ident.Name, nil
	}
	if link.AssetID == "" {
		return "", err
	}
	if !strings.EqualFold(strings.TrimSpace(link.AssetID), assetID) {
		return "", fmt.Errorf("%w (the match metadata names map asset %s, not the film's)", err, link.AssetID)
	}
	if link.Name == "" {
		return "", fmt.Errorf("%w (the match metadata gives no name for it)", err)
	}
	return link.Name, nil
}

// readChunk0 loads chunk_00 from the chunks folder (with the manifest index when it is
// readable), the same way the build loads the whole film: one load, the first chunk.
func readChunk0(chunkDir, manifestPath string) ([]byte, error) {
	var meta []decfilm.ChunkMeta
	if manifestPath != "" {
		if raw, err := os.ReadFile(manifestPath); err == nil {
			if chunks, err := filmcache.ParseManifest(raw); err == nil {
				meta = filmcache.NewSource(chunks, chunkDir).Meta()
			}
		}
	}
	film, err := decfilm.LoadDir(chunkDir, meta)
	if err != nil {
		return nil, fmt.Errorf("film chunks unreadable: %w", err)
	}
	if len(film.Meta()) == 0 || film.Meta()[0].Index != 0 {
		return nil, fmt.Errorf("chunk_00.bin is missing")
	}
	return film.Chunk(0), nil
}

// guidString renders a GUID in the canonical lowercase form (the first three fields
// little-endian, as the film writes them).
func guidString(g [16]byte) string {
	return fmt.Sprintf("%08x-%04x-%04x-%x-%x",
		binary.LittleEndian.Uint32(g[:4]), binary.LittleEndian.Uint16(g[4:6]),
		binary.LittleEndian.Uint16(g[6:8]), g[8:10], g[10:])
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
		if IsShort8(base) {
			return base + "-0000-0000-0000-000000000000"
		}
	}
	return ""
}

// IsShort8 says whether s is the short form of a match id: eight hex characters.
func IsShort8(s string) bool {
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
//
// target is the variant's victory score (0 = unknown): the viewer's score bars use it as
// their denominator. On a hill mode (King of the Hill) the entry also asks for the hill hold
// series and its per-point threshold, which the viewer bars show as the current hill's
// progress; the threshold is measured in the film, at the match's own points.
func scoreInput(recs []types.StatRecord, lines []types.PlayerLine, teams map[string]int, s Stats, target int) *replay.ScoreInput {
	if len(recs) == 0 || len(lines) == 0 {
		return nil
	}
	return &replay.ScoreInput{
		Records:     recs,
		Lines:       lines,
		TeamByXUID:  teams,
		TeamScores:  s.TeamScores,
		TargetScore: target,
		HillScoring: hillScoring(s.GameVariantName),
	}
}

var variantNameWords = regexp.MustCompile(`[^a-z0-9]+`)

// hillScoring says whether the game variant scores by holding a hill ("Ranked:King of the
// Hill", "KOTH:Arena", ...), with the same words as the map's mode filters
// (internal/mapmesh/mode_filters.go). Strongholds is not one: it scores a point per second
// held, so it has no per-point hold bar.
func hillScoring(variant string) bool {
	name := " " + variantNameWords.ReplaceAllString(strings.ToLower(variant), " ") + " "
	return strings.Contains(name, " king of the hill ") || strings.Contains(name, " koth ")
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
