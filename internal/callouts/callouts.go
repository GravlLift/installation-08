// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package callouts serves a map's named areas ("callouts"): the place names the game's HUD
// shows under the motion tracker ("Overhang" on Recharge), each with the volume it covers.
//
// Nothing here is committed game data: every set is read at runtime from the installed game
// and cached in the data directory, like the other runtime builds.
//
//   - A native map's areas are the named locations of its level tag (`levl`), read by
//     himap.ReadModuleCallouts: a ground polygon in world meters and a vertical slice.
//   - A Forge map's areas are the named-location objects of its map variant (`.mvar`), read by
//     mapvar.ZonesNommeesForge.
//
// Both name an area by a location string id; its text comes from the game's localized
// location strings (himap.LexiqueLieux, the `uslg` lists of globals-rtx-new.module). An area
// whose id has no English text is dropped: the HUD shows only names the game itself has.
package callouts

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sync"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
	"github.com/JGtm/halo-infinite-map-images/himap"
)

// Version is the cached set's shape version; a cached file of another version is rebuilt.
const Version = 1

// Sources of a set.
const (
	SourceLevel = "level" // a native map's level tag
	SourceForge = "forge" // a Forge map's variant
)

// ErrNoModule is a native map whose module is not in the installed game.
var ErrNoModule = errors.New("callouts: map module not installed")

// Zone is one named area: its name and the prism it covers, in game world meters (the frame
// of the replay tracks).
type Zone struct {
	EN string `json:"en"`
	FR string `json:"fr,omitempty"`
	// Polygon is the ground outline, [x, y] per vertex.
	Polygon [][2]float64 `json:"polygon"`
	ZBottom float64      `json:"zBottom"`
	ZTop    float64      `json:"zTop"`
}

// Set is a map's named areas, in the order the game lists them.
type Set struct {
	Version int    `json:"version"`
	Source  string `json:"source"`
	Zones   []Zone `json:"zones"`
}

// Lexicon maps a location string id to its text by language code (himap.CodeLangueEN, ...).
type Lexicon map[uint32]map[string]string

// FromLevel converts the named locations of a level tag. A location without a polygon or
// without English text is left out.
func FromLevel(cs []himap.Callout, lex Lexicon) []Zone {
	out := make([]Zone, 0, len(cs))
	for _, c := range cs {
		if z, ok := zoneOf(c.StringID, c.Polygon, c.ZBottom(), c.ZTop(), lex); ok {
			out = append(out, z)
		}
	}
	return out
}

// FromForge converts the named-location objects of a Forge map variant, with the same rules.
func FromForge(zs []mapvar.ZoneNommee, lex Lexicon) []Zone {
	out := make([]Zone, 0, len(zs))
	for _, c := range zs {
		if z, ok := zoneOf(c.StringID, c.Contour, c.ZBas, c.ZHaut, lex); ok {
			out = append(out, z)
		}
	}
	return out
}

func zoneOf(id uint32, poly [][2]float64, bottom, top float64, lex Lexicon) (Zone, bool) {
	names := lex[id]
	en := names[himap.CodeLangueEN]
	if en == "" || len(poly) < 3 || !(top > bottom) {
		return Zone{}, false
	}
	z := Zone{EN: en, FR: names[himap.CodeLangueFR], ZBottom: cm(bottom), ZTop: cm(top), Polygon: make([][2]float64, len(poly))}
	for i, p := range poly {
		z.Polygon[i] = [2]float64{cm(p[0]), cm(p[1])}
	}
	return z, true
}

// cm rounds to the centimeter: finer than any HUD decision, and it keeps the answer small.
func cm(v float64) float64 { return math.Round(v*100) / 100 }

// LevelModule is the installed module that holds a native map's level tag.
func LevelModule(gameRoot, module string) string {
	return filepath.Join(gameRoot, "pc", "levels", "multi", module, module+"-rtx-new.module")
}

// Cache reads sets on demand and keeps them: in memory for the process, and native maps also
// on disk under Dir (a Forge set is rebuilt from its variant, which is cheap once the lexicon
// is loaded). It is safe for concurrent use; the reads it makes are serialized.
type Cache struct {
	// Dir is the disk cache folder; empty keeps the cache in memory only.
	Dir string
	// GameRoot resolves the game's deploy folder, called once, when a set must be read.
	GameRoot func() (string, error)
	// Persist says whether a read native set is written to Dir.
	Persist bool

	mu   sync.Mutex
	game string
	lex  Lexicon
	sets map[string]Set
}

// Native returns a native map's set; `module` must already be a valid module key.
func (c *Cache) Native(module string) (Set, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	key := "level:" + module
	if s, ok := c.sets[key]; ok {
		return s, nil
	}
	if s, ok := c.readDisk(module); ok {
		c.keep(key, s)
		return s, nil
	}
	if err := c.loadGame(); err != nil {
		return Set{}, err
	}
	path := LevelModule(c.game, module)
	if _, err := os.Stat(path); err != nil {
		return Set{}, ErrNoModule
	}
	cs, err := himap.ReadModuleCallouts(path)
	if err != nil {
		return Set{}, err
	}
	s := Set{Version: Version, Source: SourceLevel, Zones: FromLevel(cs, c.lex)}
	c.keep(key, s)
	if c.Persist && c.Dir != "" {
		if err := writeAtomic(filepath.Join(c.Dir, module+".json"), s); err != nil {
			return Set{}, err
		}
	}
	return s, nil
}

// Forge returns the set of a Forge map from its raw variant, kept in memory under `key`.
func (c *Cache) Forge(key string, rawMvar []byte) (Set, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	key = "forge:" + key
	if s, ok := c.sets[key]; ok {
		return s, nil
	}
	v, err := mapvar.Parse(rawMvar)
	if err != nil {
		return Set{}, fmt.Errorf("callouts: map variant: %w", err)
	}
	zs := mapvar.ZonesNommeesForge(v.Objects)
	s := Set{Version: Version, Source: SourceForge, Zones: []Zone{}}
	if len(zs) > 0 {
		if err := c.loadGame(); err != nil {
			return Set{}, err
		}
		s.Zones = FromForge(zs, c.lex)
	}
	c.keep(key, s)
	return s, nil
}

func (c *Cache) keep(key string, s Set) {
	if c.sets == nil {
		c.sets = map[string]Set{}
	}
	c.sets[key] = s
}

// loadGame resolves the game and reads the location lexicon, once.
func (c *Cache) loadGame() error {
	if c.lex != nil {
		return nil
	}
	if c.GameRoot == nil {
		return errors.New("callouts: no game root")
	}
	root, err := c.GameRoot()
	if err != nil {
		return err
	}
	lex, err := himap.LexiqueLieux(root)
	if err != nil {
		return fmt.Errorf("callouts: location names: %w", err)
	}
	c.game, c.lex = root, Lexicon(lex)
	return nil
}

func (c *Cache) readDisk(module string) (Set, bool) {
	if c.Dir == "" {
		return Set{}, false
	}
	raw, err := os.ReadFile(filepath.Join(c.Dir, module+".json"))
	if err != nil {
		return Set{}, false
	}
	var s Set
	if json.Unmarshal(raw, &s) != nil || s.Version != Version || s.Source != SourceLevel || s.Zones == nil {
		return Set{}, false
	}
	return s, true
}

func writeAtomic(path string, s Set) error {
	raw, err := json.Marshal(s)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
