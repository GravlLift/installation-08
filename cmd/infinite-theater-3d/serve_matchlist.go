package main

// serve_matchlist.go — the list-side half of the match context: the fields a match-select
// row needs (mode, playlist, outcome, score, start time, map image), derived from the same
// stored data the context route reads, without re-reading the film and without failing the
// list when a match's context data is missing.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode"

	"github.com/llampwall/infinite-theater-3d/internal/build"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// listSummary is one row of GET /api/matches: the stored summary plus the list fields.
// Fields that do not apply are omitted (no context data, no known account, no stored map
// image), never sent as null.
type listSummary struct {
	store.Match
	ModeName     string  `json:"modeName,omitempty"`
	ModeCategory string  `json:"modeCategory,omitempty"`
	PlaylistName string  `json:"playlistName,omitempty"`
	IsRanked     bool    `json:"isRanked,omitempty"`
	StartTime    string  `json:"startTime,omitempty"`
	MapImageUrl  string  `json:"mapImageUrl,omitempty"`
	TeamScores   *[2]int `json:"teamScores,omitempty"`
	Outcome      string  `json:"outcome,omitempty"`
	ScoreMine    *int    `json:"scoreMine,omitempty"`
	ScoreTheirs  *int    `json:"scoreTheirs,omitempty"`
}

// matchlistEntry is one match's derived list fields plus the score and outcome the context
// route's own code produced for the signed-in account (when that player is in the match).
type matchlistEntry struct {
	ModeName        string
	ModeCategory    string
	PlaylistName    string
	IsRanked        bool
	StartTime       string
	MapImageUrl     string
	TeamScores      [2]int
	GameVariant     string
	RoundsAvailable bool
	Players         []build.StatsPlayer
	AccountInMatch  bool
	accountName     string
	payload         map[string]any // the raw API payload, kept for per-account re-runs
	accountXUID     string         // the xuid the name resolved to in this match
	AccountRow      contextJSON    // the score and outcome row for that xuid
}

// matchlistCache is the per-match list enrichment, keyed by match id and re-derived only
// when the newest modtime of the match's stored context files changed. One entry per match
// (not per match x account) keeps the map bounded: the per-player values are re-applied
// in place when the signed-in account changes.
type matchlistCache struct {
	mu    sync.Mutex
	files map[string]int64 // newest modtime of the files the entry reads
	data  map[string]matchlistEntry
}

func newMatchlistCache() *matchlistCache {
	return &matchlistCache{files: map[string]int64{}, data: map[string]matchlistEntry{}}
}

// matchlistEnriched answers the match list with the stored summaries plus the list fields.
// A match whose context data is absent or unreadable keeps today's fields and omits the
// new ones; it never fails the list. accountName is the signed-in account ("" when none
// is known): when that player is in a match, the row carries that player's outcome and
// score.
func matchlistEnriched(root *store.Root, ms []store.Match, accountName string, cache *matchlistCache) []listSummary {
	out := make([]listSummary, 0, len(ms))
	for _, m := range ms {
		s := listSummary{Match: m}
		if m.MatchID != "" {
			if e := cache.entry(root, m.MatchID, accountName); e != nil {
				s.ModeName, s.ModeCategory = e.ModeName, e.ModeCategory
				s.PlaylistName, s.IsRanked = e.PlaylistName, e.IsRanked
				s.StartTime, s.MapImageUrl = e.StartTime, e.MapImageUrl
				s.TeamScores = &e.TeamScores
				if e.AccountInMatch {
					row := e.AccountRow
					s.Outcome = textValue(row["outcome"])
					if mine, ok := contextNumber(row["score_mine"]); ok {
						v := int(mine)
						s.ScoreMine = &v
					}
					if theirs, ok := contextNumber(row["score_theirs"]); ok {
						v := int(theirs)
						s.ScoreTheirs = &v
					}
				}
			}
		}
		out = append(out, s)
	}
	return out
}

// entry returns the derived fields for id (nil when the match has no context data),
// re-deriving the entry when the stored files changed and re-applying the per-player
// values when the signed-in account changed.
func (c *matchlistCache) entry(root *store.Root, id, accountName string) *matchlistEntry {
	// Newest modtime is the invalidation key: a re-import that rewrites the files in
	// place is picked up on the next call (Windows timestamps are second-resolution, and
	// the cache re-derives on any change, so a stale second is a re-derivation, never a
	// wrong answer).
	dir := matchlistDir(root, id)
	newest := matchlistNewestModtime(dir)
	c.mu.Lock()
	e, ok := c.data[id]
	stale := !ok || newest == 0 || newest != c.files[id]
	if !stale && e.accountName != accountName {
		matchlistAccountOutcomes(&e, accountName)
		c.data[id] = e
	}
	c.mu.Unlock()
	if stale {
		d := matchlistDerive(root, id, dir, accountName)
		if d == nil {
			return nil // no context data: the row keeps only its stored fields
		}
		c.mu.Lock()
		c.files[id] = newest
		c.data[id] = *d
		c.mu.Unlock()
		e = *d
	}
	return &e
}

// matchlistDir is the stored context data of one match (the match folder, the same folder
// the context route reads its variant files from).
func matchlistDir(root *store.Root, id string) string {
	meta, err := root.MatchMetaPath(id)
	if err != nil {
		return ""
	}
	return filepath.Dir(meta)
}

// matchlistNewestModtime is the newest modtime of the files in dir (0 when the folder is
// absent): the invalidation key of the cache.
func matchlistNewestModtime(dir string) int64 {
	if dir == "" {
		return 0
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	newest := int64(0)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if m := info.ModTime().UnixNano(); m > newest {
			newest = m
		}
	}
	return newest
}

// matchlistDerive reads the match's stored context files and derives the list fields with
// the context route's own code (matchFacts, contextHeader, contextCachedFieldsFor and the
// per-player score and outcome). A match without stats-full.json (the full API payload
// the context header reads from) has no list fields at all and returns nil.
func matchlistDerive(root *store.Root, id, dir, accountName string) *matchlistEntry {
	if dir == "" {
		return nil
	}
	raw, err := os.ReadFile(filepath.Join(dir, "stats-full.json"))
	if err != nil {
		return nil // no full payload: no context data to list
	}
	var payload map[string]any
	if json.Unmarshal(raw, &payload) != nil {
		return nil
	}
	facts, _, _, _, err := matchFacts(raw)
	if err != nil {
		return nil
	}
	meta, err := root.MatchMeta(id)
	if err != nil {
		meta = store.Match{MatchID: id}
	}
	if facts.GameVariantName == "" {
		var stats build.Stats
		if sraw, err := os.ReadFile(filepath.Join(dir, "stats.json")); err == nil {
			_ = json.Unmarshal(sraw, &stats)
		}
		facts.GameVariantName = stats.GameVariantName
		if facts.TeamScores == nil {
			facts.TeamScores = stats.TeamScores
		}
	}
	var e matchlistEntry
	e.Players = facts.Players
	e.GameVariant = facts.GameVariantName
	e.TeamScores, e.RoundsAvailable = matchlistReading(
		facts.GameVariantName, facts.TeamScores, facts.TeamRoundsWon)
	header := contextHeader(meta, facts, payload, "")
	e.ModeName, e.ModeCategory = textValue(header["mode_ui"]), textValue(header["mode_category"])
	if name := textValue(object(object(payload["MatchInfo"])["Playlist"])["PublicName"]); name != "" {
		e.PlaylistName = contextPlaylistLabel(name)
	}
	e.IsRanked, _ = header["is_ranked"].(bool)
	e.StartTime = textValue(header["start_time"])
	cached := contextCachedFieldsFor(root, id, textValue(header["map_id"]))
	if cached.Mode != "" {
		e.ModeName, e.ModeCategory = cached.Mode, cached.Category
	}
	if cached.PlaylistLabel != "" {
		e.PlaylistName = cached.PlaylistLabel
	}
	e.MapImageUrl = cached.MapImageURL
	e.payload = payload
	matchlistAccountOutcomes(&e, accountName)
	return &e
}

// matchlistReading is the per-team reading of the header's score source: the fresh rounds
// for a rounds-deciding variant (both teams read), else the final team score. ok is false
// when neither reading is available (the score is then not claimed at all).
func matchlistReading(variant string, teamScores *[2]int, roundsWon *[2][3]int) ([2]int, bool) {
	if contextRoundsDecide(variant) && roundsWon != nil {
		r := *roundsWon
		if r[0] != [3]int{} && r[1] != [3]int{} {
			return [2]int{r[0][0], r[1][0]}, true
		}
	}
	if teamScores != nil {
		return *teamScores, true
	}
	return [2]int{}, false
}

// matchlistAccountOutcomes runs the context route's own score and outcome code for the one
// account the list may name ("" when none is signed in) and stores the player's values on
// the entry: e.accountXUID, e.AccountInMatch and e.AccountRow. The account is matched to
// the roster by name, case and spacing insensitive (the same match the web does): the
// stored summary may predate a sign-in, and the name is what the credentials carry. The
// score is fed to contextScore as the entry's per-team reading (fresh rounds for a
// rounds-deciding variant, else final points), so the row shows what the header's score
// source gives it, from that player's point of view; the outcome is read from the stored
// raw payload, narrowed to the xuid the name resolved to.
func matchlistAccountOutcomes(e *matchlistEntry, accountName string) {
	e.AccountInMatch = false
	e.AccountRow = contextJSON{}
	e.accountName = accountName
	e.accountXUID = ""
	if accountName == "" {
		return
	}
	xuid := matchlistAccountXUID(e.Players, accountName)
	if xuid == "" {
		return
	}
	e.AccountInMatch = true
	e.accountXUID = xuid
	stats := build.Stats{Players: e.Players}
	pair := e.TeamScores
	stats.TeamScores = &pair
	if e.RoundsAvailable {
		rounds := [2][3]int{{e.TeamScores[0], 0, 0}, {e.TeamScores[1], 0, 0}}
		stats.TeamRoundsWon = &rounds
		stats.GameVariantName = e.GameVariant
	}
	row := contextJSON{}
	contextScore(row, stats, e.payload, xuid)
	contextOutcome(row, e.payload, xuid)
	e.AccountRow = row
}

// matchlistAccountXUID resolves the signed-in account's xuid in a match: the roster player
// whose stored name matches the gamertag, case and spacing insensitive (the same match the
// web does). "" when the account is not in the match or has no xuid there.
func matchlistAccountXUID(players []build.StatsPlayer, accountName string) string {
	wanted := matchlistFoldName(accountName)
	for _, p := range players {
		if matchlistFoldName(p.Name) == wanted {
			return p.XUID
		}
	}
	return ""
}

// matchlistFoldName is the roster match key: case-folded with whitespace removed, so a
// stored name and the credential's gamertag match despite display differences.
func matchlistFoldName(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		if !unicode.IsSpace(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}
