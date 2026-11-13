package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// Player is one player of the match summary, from the document's roster (the film's own
// player table): a name, the team the film writes for the player, and the bot flag. The
// xuid is omitted when the film did not name the player (a bot without a declaration).
type Player struct {
	Name   string `json:"name"`
	XUID   string `json:"xuid,omitempty"`
	TeamID int    `json:"teamId"`
	IsBot  bool   `json:"isBot"`
}

// Match is the small match.json summary the store lists: enough for a viewer to pick a
// match (id, map, build, duration, roster, import time) without reading the document.
type Match struct {
	MatchID    string   `json:"matchId"`
	MapName    string   `json:"mapName"`
	MapAssetID string   `json:"mapAssetId,omitempty"`
	MapModule  string   `json:"mapModule"`
	Build      string   `json:"build"`
	DurationMS int      `json:"durationMs"`
	Players    []Player `json:"players"`
	ImportedAt string   `json:"importedAt"`
}

// SaveMatchMeta writes match.json for id (atomically).
func (r *Root) SaveMatchMeta(id string, m Match) error {
	path, err := r.MatchMetaPath(id)
	if err != nil {
		return err
	}
	raw, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return r.WriteFile(path, append(raw, '\n'))
}

// ListMatches reads every match.json under matches/ and returns them, newest import first.
// A folder without a readable match.json is skipped (a match is only listed once its
// summary is written, which is the last thing an import does).
func (r *Root) ListMatches() ([]Match, error) {
	entries, err := os.ReadDir(r.MatchesDir())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("list matches: %w", err)
	}
	out := make([]Match, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(r.MatchesDir(), e.Name(), "match.json"))
		if err != nil {
			continue // no summary yet: not a listed match
		}
		var m Match
		if err := json.Unmarshal(raw, &m); err != nil {
			continue // unreadable summary: skip, do not fail the listing
		}
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool {
		ti, e1 := time.Parse(time.RFC3339, out[i].ImportedAt)
		tj, e2 := time.Parse(time.RFC3339, out[j].ImportedAt)
		if e1 != nil || e2 != nil {
			return out[i].ImportedAt > out[j].ImportedAt // unparseable: string order
		}
		if !ti.Equal(tj) {
			return ti.After(tj)
		}
		return out[i].MatchID > out[j].MatchID // stable tie-break
	})
	return out, nil
}

// LoadReplay reads the match's built document bytes (replay.json.gz).
func (r *Root) LoadReplay(id string) ([]byte, error) {
	path, err := r.MatchReplayPath(id)
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("%w: %s", ErrNotFound, id)
		}
		return nil, err
	}
	return raw, nil
}

// MatchMeta reads the match's match.json.
func (r *Root) MatchMeta(id string) (Match, error) {
	var m Match
	path, err := r.MatchMetaPath(id)
	if err != nil {
		return m, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return m, fmt.Errorf("%w: %s", ErrNotFound, id)
		}
		return m, err
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return m, fmt.Errorf("match %s: unreadable summary: %w", id, err)
	}
	return m, nil
}
