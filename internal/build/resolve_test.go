package build

import (
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/decfilm"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// TestResolveMatchID — the match id resolution order: an explicit id wins, then the
// manifest file name, then the chunks folder name; only the short8 form is expanded.
func TestResolveMatchID(t *testing.T) {
	const short8 = "7d798138-0000-0000-0000-000000000000"
	cases := []struct {
		name string
		in   Input
		want string
	}{
		{"explicit wins", Input{MatchID: "abc", ManifestPath: "/m/7d798138.json", ChunkDir: "/c/7d798138"}, "abc"},
		{"manifest short8", Input{ManifestPath: "/m/7d798138.json", ChunkDir: "/c/other"}, short8},
		{"chunks short8", Input{ChunkDir: "/c/7d798138"}, short8},
		{"non-hex name stays empty", Input{ManifestPath: "/m/abcdefz1.json", ChunkDir: "/c/whatever"}, ""},
		{"no source at all", Input{}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveMatchID(tc.in); got != tc.want {
				t.Fatalf("resolveMatchID = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestMapNameOfAsset — the film's map asset id is named by the identity table first; an id
// the table does not hold is named by the match's own map link when the link names that same
// id (compared as a GUID, case-insensitively), and is an error otherwise.
func TestMapNameOfAsset(t *testing.T) {
	const liveFire = "309253f8-7a75-48ff-83e1-e7fb3db2ac47" // in the identity table
	const unknown = "a54808fb-9bf5-432a-a3c3-f76cbea944c1"  // a playlist copy the table lacks
	cases := []struct {
		name    string
		asset   string
		link    MapLink
		want    string
		wantErr bool
	}{
		{"table wins over the link", liveFire, MapLink{AssetID: liveFire, Name: "Other"}, "Live Fire - Ranked", false},
		{"link names the unknown id", unknown, MapLink{AssetID: unknown, Name: "Fortress - Ranked"}, "Fortress - Ranked", false},
		{"link id compared as a GUID", unknown, MapLink{AssetID: " A54808FB-9BF5-432A-A3C3-F76CBEA944C1 ", Name: "Fortress - Ranked"}, "Fortress - Ranked", false},
		{"link names another id", unknown, MapLink{AssetID: liveFire, Name: "Live Fire - Ranked"}, "", true},
		{"link without a name", unknown, MapLink{AssetID: unknown}, "", true},
		{"no link", unknown, MapLink{}, "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := mapNameOfAsset(tc.asset, tc.link)
			if (err != nil) != tc.wantErr || got != tc.want {
				t.Fatalf("mapNameOfAsset = %q, %v; want %q, error %v", got, err, tc.want, tc.wantErr)
			}
		})
	}
}

// TestMatchMapNameFindsBounds — a playlist copy named by the match metadata resolves to the
// bounds of its map: the catalog lookup normalizes the "- Ranked" suffix away.
func TestMatchMapNameFindsBounds(t *testing.T) {
	entry, err := resolveMapEntry(Input{MapName: "Fortress - Ranked"})
	if err != nil {
		t.Fatalf("resolveMapEntry(Fortress - Ranked): %v", err)
	}
	if entry.Module == "" {
		t.Fatal("Fortress bounds entry carries no module")
	}
}

// TestIsShort8 —the short8 predicate: eight hex characters, both cases, nothing else.
func TestIsShort8(t *testing.T) {
	yes := []string{"7d798138", "ABCDEF01"}
	no := []string{"7d79813", "7d7981381", "7d7981z8", "7d7981-8", "7d 98138"}
	for _, s := range yes {
		if !IsShort8(s) {
			t.Errorf("IsShort8(%q) = false, want true", s)
		}
	}
	for _, s := range no {
		if IsShort8(s) {
			t.Errorf("IsShort8(%q) = true, want false", s)
		}
	}
}

// TestLinesOfStats — the scoreboard projection: lines, the team table and the roster share
// one source; a row with an empty xuid is dropped everywhere.
func TestLinesOfStats(t *testing.T) {
	s := Stats{Players: []StatsPlayer{
		{XUID: "1", TeamID: 0, Kills: 5, Deaths: 2, Assists: 3},
		{XUID: "", TeamID: 1, Kills: 9, Deaths: 9, Assists: 9},
		{XUID: "2", TeamID: 1, Kills: 1, Deaths: 4, Assists: 0},
	}}
	lines, teams, roster := linesOfStats(s)
	if len(lines) != 2 || len(teams) != 2 || len(roster) != 2 {
		t.Fatalf("expected 2 of each, got %d lines, %d teams, %d roster", len(lines), len(teams), len(roster))
	}
	if teams["1"] != 0 || teams["2"] != 1 {
		t.Fatalf("teams = %v, want 1->0 and 2->1", teams)
	}
	if lines[0].XUID != "1" || lines[0].Kills != 5 || lines[0].Deaths != 2 || lines[0].Assists != 3 {
		t.Fatalf("line[0] = %+v", lines[0])
	}
	if lines[1].XUID != "2" || lines[1].Deaths != 4 {
		t.Fatalf("line[1] = %+v", lines[1])
	}
}

// TestParticipantsOf — the identity participants are exactly the non-empty scoreboard xuids.
func TestParticipantsOf(t *testing.T) {
	if got := participantsOf(Stats{}); len(got) != 0 {
		t.Fatalf("empty stats -> %d participants, want 0", len(got))
	}
	s := Stats{Players: []StatsPlayer{{XUID: "7"}}}
	if got := participantsOf(s); len(got) != 1 || got[0].ID != "7" {
		t.Fatalf("participants = %+v, want one row with id 7", got)
	}
}

// TestScoreInput — the score entry is nil without records or without lines (the document
// publishes no score layer, not an empty curve).
func TestScoreInput(t *testing.T) {
	if scoreInput(nil, nil, nil, Stats{}, 0) != nil {
		t.Fatal("no records, no lines: expected nil score input")
	}
	if scoreInput(nil, []types.PlayerLine{{XUID: "1"}}, nil, Stats{}, 0) != nil {
		t.Fatal("no records: expected nil score input")
	}
}

// TestScoreInputCarriesTargetAndHillGate — the variant's victory score reaches the decoder
// (the viewer bars' denominator; it used to be resolved and then dropped), and only a hill
// mode asks for the hold series.
func TestScoreInputCarriesTargetAndHillGate(t *testing.T) {
	recs := []types.StatRecord{{}}
	lines := []types.PlayerLine{{XUID: "1"}}
	cases := []struct {
		variant string
		target  int
		hill    bool
	}{
		{"Ranked:King of the Hill", 4, true},
		{"KOTH:Arena", 3, true},
		{"Ranked:Strongholds", 250, false},
		{"Ranked:Slayer", 50, false},
	}
	for _, c := range cases {
		in := scoreInput(recs, lines, nil, Stats{GameVariantName: c.variant}, c.target)
		if in == nil || in.TargetScore != c.target || in.HillScoring != c.hill {
			t.Fatalf("%s: got %+v, want target %d hill %v", c.variant, in, c.target, c.hill)
		}
	}
}

// TestNeutralDeathsRefusedWithoutPublishability — the neutral-death layer is absent when the
// killsource pass is nil (no decode): the death feed lines keep their generic marker.
func TestNeutralDeathsRefusedWithoutPublishability(t *testing.T) {
	if got := neutralDeaths(t.Context(), "m", nil); got != nil {
		t.Fatalf("nil killsource: expected nil neutral deaths, got %v", got)
	}
}

// TestKillRefsNilPass — no killsource decode: zero kill entries, not a panic.
func TestKillRefsNilPass(t *testing.T) {
	kills, matchKills, causes := killRefs(nil, nil)
	if kills.Read {
		t.Fatal("nil pass: KillsInput.Read must be false")
	}
	if matchKills.Read || causes != nil {
		t.Fatalf("nil pass: expected zero match kills and no causes, got %v %v", matchKills, causes)
	}
}

// TestCategoryOf — the damage modifiers render under their engine names; None and an
// out-of-range value render empty (a stable identifier, never a number).
func TestCategoryOf(t *testing.T) {
	cases := map[decfilm.Category]string{
		decfilm.CategoryNone:            "",
		decfilm.CategoryHeadshot:        "Headshot",
		decfilm.CategorySilentMelee:     "SilentMelee",
		decfilm.CategoryCollisionDamage: "CollisionDamage",
	}
	for c, want := range cases {
		if got := categoryOf(c); got != want {
			t.Errorf("categoryOf(%v) = %q, want %q", c, got, want)
		}
	}
	if got := categoryOf(decfilm.Category(99)); got != "" {
		t.Errorf("categoryOf(out of range) = %q, want empty", got)
	}
}

// TestProfileOf — the scan profile is nil without a killsource pass (the decoder keeps its
// default profile invariant), the pass's own calibration otherwise.
func TestProfileOf(t *testing.T) {
	if profileOf(nil) != nil {
		t.Fatal("nil pass: expected nil profile")
	}
	var res decfilm.Result
	if p := profileOf(&res); p == nil {
		t.Fatal("expected the pass's calibration profile, got nil")
	}
}

// TestFormatXUID — the film xuid renders in the decimal form the pairing accepts.
func TestFormatXUID(t *testing.T) {
	if got := formatXUID(42); got != "42" {
		t.Fatalf("formatXUID(42) = %q, want \"42\"", got)
	}
	if got := formatXUID(0); got != "0" {
		t.Fatalf("formatXUID(0) = %q, want \"0\"", got)
	}
}

// TestDeathInstants — the death feed translates to the bridge's instant form (decimal xuid,
// milliseconds), keeping the feed order.
func TestDeathInstants(t *testing.T) {
	deaths := []types.Death{{XUID: 0x1, TimeMS: 1500}, {XUID: 0x2, TimeMS: 2000}}
	got := deathInstants(deaths)
	if len(got) != 2 || got[0].XUID != "1" || got[0].TimeMS != 1500 || got[1].XUID != "2" {
		t.Fatalf("deathInstants = %+v", got)
	}
}
