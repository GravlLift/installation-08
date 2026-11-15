package callouts

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
	"github.com/JGtm/halo-infinite-map-images/himap"
)

var testLex = Lexicon{
	0x11: {himap.CodeLangueEN: "Overhang", himap.CodeLangueFR: "Surplomb"},
	0x22: {himap.CodeLangueEN: "Pit"},
	0x33: {himap.CodeLangueFR: "Seulement FR"},
}

var square = [][2]float64{{0, 0}, {4.004, 0}, {4, 4}, {0, 4}}

// TestFromLevel keeps the named, shaped locations in tag order, rounds to the centimeter, takes
// the absolute vertical slice, and drops a location with no polygon or no English text.
func TestFromLevel(t *testing.T) {
	cs := []himap.Callout{
		{StringID: 0x11, Pos: [3]float64{0, 0, 5}, Bottom: 0.69, Top: 1.31, Polygon: square},
		{StringID: 0x22, Pos: [3]float64{0, 0, 1}, Bottom: 1, Top: 2},                  // no polygon
		{StringID: 0x33, Pos: [3]float64{0, 0, 1}, Bottom: 1, Top: 2, Polygon: square}, // no English
		{StringID: 0x44, Pos: [3]float64{0, 0, 1}, Bottom: 1, Top: 2, Polygon: square}, // unknown id
		{StringID: 0x22, Pos: [3]float64{1, 1, 0}, Bottom: 0, Top: 3, Polygon: square},
	}
	got := FromLevel(cs, testLex)
	if len(got) != 2 {
		t.Fatalf("got %d zones, want 2: %+v", len(got), got)
	}
	o := got[0]
	if o.EN != "Overhang" || o.FR != "Surplomb" || o.ZBottom != 4.31 || o.ZTop != 6.31 || o.Polygon[1] != [2]float64{4, 0} {
		t.Errorf("overhang %+v", o)
	}
	if got[1].EN != "Pit" || got[1].FR != "" || got[1].ZBottom != 0 || got[1].ZTop != 3 {
		t.Errorf("pit %+v", got[1])
	}
}

func TestFromForge(t *testing.T) {
	got := FromForge([]mapvar.ZoneNommee{
		{StringID: 0x22, Contour: square, ZBas: -1, ZHaut: 2},
		{StringID: 0x22, Contour: square, ZBas: 2, ZHaut: 2}, // flat
	}, testLex)
	if len(got) != 1 || got[0].EN != "Pit" || got[0].ZBottom != -1 {
		t.Fatalf("got %+v", got)
	}
}

// TestCacheDisk: a cached native set is served from disk without the game; a set of another
// version is not, and the game is then asked for.
func TestCacheDisk(t *testing.T) {
	dir := t.TempDir()
	noGame := errors.New("no game")
	write := func(s Set) {
		raw, _ := json.Marshal(s)
		if err := os.WriteFile(filepath.Join(dir, "sgh_blueprint.json"), raw, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(Set{Version: Version, Source: SourceLevel, Zones: []Zone{{EN: "Overhang", Polygon: square, ZTop: 1}}})
	c := &Cache{Dir: dir, GameRoot: func() (string, error) { return "", noGame }}
	s, err := c.Native("sgh_blueprint")
	if err != nil || len(s.Zones) != 1 || s.Zones[0].EN != "Overhang" {
		t.Fatalf("cached set %+v, %v", s, err)
	}
	write(Set{Version: Version + 1, Source: SourceLevel, Zones: []Zone{}})
	c = &Cache{Dir: dir, GameRoot: func() (string, error) { return "", noGame }}
	if _, err := c.Native("sgh_blueprint"); !errors.Is(err, noGame) {
		t.Fatalf("stale version served: %v", err)
	}
}

// TestCacheNoModule: a module the install does not hold is ErrNoModule.
func TestCacheNoModule(t *testing.T) {
	c := &Cache{GameRoot: func() (string, error) { return t.TempDir(), nil }, lex: Lexicon{}}
	if _, err := c.Native("absent"); !errors.Is(err, ErrNoModule) {
		t.Fatalf("got %v", err)
	}
}
