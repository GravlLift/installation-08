// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/replay"
)

func ledgerPtr[T any](v T) *T { return &v }

const (
	ledgerKamUz = "2535437204862672"
	ledgerBC0R  = "2535424106554688"
	ledgerShawn = "2535433453438424"
)

// ledgerGameWinner is a small document with the facts of 9220185c's game winner: KamUz starts a
// throw at 13184, BC0R melees at 13191, KamUz's plasma sticks point-blank at 13193 (detonation
// 13222), KamUz's life ends at 13195 and Cobra (team 1) reaches 49, the detonation ends BC0R's
// life at 13222 and Eagle (team 0) reaches 50.
func ledgerGameWinner() (*replay.ReplayDocument, []contextJSON, int64) {
	doc := &replay.ReplayDocument{
		MatchID:         "9220185c-ec61-415f-beff-9723534bac32",
		FrameIntervalMS: 33,
		OriginMs:        ledgerPtr[int64](3598),
		Tracks: []replay.Track{
			{Slot: 613, Team: 0, XUID: ledgerKamUz, StartFrame: 12909, EndFrame: 13195, Points: []replay.Point{{T: 12909}, {T: 13195}}},
			{Slot: 606, Team: 1, XUID: ledgerBC0R, StartFrame: 12195, EndFrame: 13222, Points: []replay.Point{{T: 12195}, {T: 13222}}},
			// Shawn: one life killed with no event the ledger can read, then a survivor to the film's end.
			{Slot: 590, Team: 1, XUID: ledgerShawn, StartFrame: 11000, EndFrame: 11500, Points: []replay.Point{{T: 11000}, {T: 11500}}},
			{Slot: 604, Team: 1, XUID: ledgerShawn, StartFrame: 11875, EndFrame: 13439, Points: []replay.Point{{T: 11875}, {T: 13439}}},
		},
		Roster: []replay.RosterEntry{{XUID: ledgerKamUz, Name: "KamUz 7w7"}, {XUID: ledgerBC0R, Name: "BC0R"}, {XUID: ledgerShawn, Name: "Shawn8"}},
		Shots:  []replay.Shot{{T: 13189, Slot: 606, X: 10.19, Y: 5.91, Weapon: "0x6ACDC44D42C9679F"}, {T: 13230, Slot: 604, Weapon: "0xAAAA0000BBBB0000"}},
		Damages: []replay.Damage{
			{T: 13193, Slot: 606, By: ledgerPtr[uint32](613), Src: ledgerPtr[uint32](1736266058)},
		},
		Actions: []replay.PlayerAction{
			{T: 13167, Ms: 434515, Slot: 606, Kind: "reload"},
			{T: 13184, Ms: 435082, Slot: 613, Kind: "throwStart"},
			{T: 13191, Ms: 435332, Slot: 606, Kind: "melee"},
		},
		Grenades: []replay.Grenade{
			{T: 13193, Slot: 613, Idx: 3, X: 10.15, Y: 5.3, Rank: 1, Src: "biped", Deto: &replay.GrenadeDetonation{T: 13222, X: 9.69, Y: 5.09, Z: 5.02}},
		},
		// A rocket from Shawn's shot 1 (its weapon declares `impact`) and a bullet that does not.
		Projectiles: []replay.Projectile{
			{T0: 13230, P: [][3]float32{{0, 1, 1}, {5, 2, 2}}, DetoT: 13235, DetoX: 2, DetoY: 2, DetoLue: true, Shot: ledgerPtr(1)},
			{T0: 13189, P: [][3]float32{{0, 1, 1}, {1, 2, 2}}, DetoT: 13190, Shot: ledgerPtr(0)},
		},
		WeaponLabels: map[string]replay.WeaponLabel{
			"0x6ACDC44D42C9679F": {Key: "hinf_br75"},
			"0xAAAA0000BBBB0000": {Key: "hinf_rocket_launcher", Impact: true},
			"0x1A22FEE6":         {Key: "hinf_shock_rifle"},
		},
		WeaponChanges: []replay.WeaponChange{{T: 13200, Slot: 604, Kind: replay.WeaponTaken, W: "1a22fee6"}},
		Pickups:       []replay.Pickup{{T: 13201, Slot: 604, XUID: ledgerShawn, W: "caaadcb0", Family: "grenade_plasma", Kind: "grenade"}},
		GrenadeLabels: []replay.Label{{Text: replay.Text{"en": "Frag"}}, {Text: replay.Text{"en": "Plasma"}}},
		ScoreTimeline: &replay.ScoreTimeline{
			Teams: []replay.TeamScore{
				{TeamID: ledgerPtr(1), Rounds: []replay.ScoreRound{{Round: 0, Points: []replay.ScoreTick{{T: 13000, V: 48}, {T: 13195, V: 49}}}}},
				{TeamID: ledgerPtr(0), Rounds: []replay.ScoreRound{{Round: 0, Points: []replay.ScoreTick{{T: 12998, V: 49}, {T: 13222, V: 50}}}}},
			},
			TargetScore: ledgerPtr(50),
		},
	}
	// The context's events, on the match clock: doc ms - (t0 - originMs) = doc ms - 22605.
	t0 := int64(26203)
	events := []contextJSON{
		{"event_type": "kill", "event_time_ms": int64(412869), "actor_xuid": ledgerBC0R, "actor_gamertag": "BC0R", "actor_team_id": 1, "victim_xuid": ledgerKamUz, "victim_gamertag": "KamUz 7w7", "victim_team_id": 0, "assist_state": "named", "assist_gamertag": "Shawn8"},
		{"event_type": "death", "event_time_ms": int64(412869), "actor_xuid": ledgerKamUz},
		{"event_type": "kill", "event_time_ms": int64(413751), "actor_xuid": ledgerKamUz, "actor_gamertag": "KamUz 7w7", "actor_team_id": 0, "victim_xuid": ledgerBC0R, "victim_gamertag": "BC0R", "victim_team_id": 1, "weapon_key": "hinf_plasma_grenade", "headshot": false},
		{"event_type": "death", "event_time_ms": int64(413751), "actor_xuid": ledgerBC0R},
		{"event_type": "medal", "event_time_ms": int64(413752), "actor_xuid": ledgerKamUz, "actor_gamertag": "KamUz 7w7", "actor_team_id": 0, "medal_name": "Stick", "medal_label": "Stick", "medal_image_url": "/static/medals/halo_infinite/3655682764.png", "medal_name_id": 3655682764},
		// A medal with no kill of its actor within 500 ms stands alone; one without a name is not a medal.
		{"event_type": "medal", "event_time_ms": int64(415000), "actor_xuid": ledgerKamUz, "medal_name": "Killjoy"},
		{"event_type": "medal", "event_time_ms": int64(413752), "actor_xuid": ledgerKamUz},
	}
	return doc, events, t0
}

// ledgerLine is an event as "<frame> <kind> <actor>".
func ledgerLine(e ledgerEvent) string {
	who := ""
	if e.Actor != nil {
		who = e.Actor.Gamertag
	}
	return strings.TrimSpace(fmt.Sprintf("%d %s %s", e.Frame, e.Kind, who))
}

func TestLedgerGameWinnerOrder(t *testing.T) {
	doc, events, t0 := ledgerGameWinner()
	out := buildLedger(doc, events, t0)
	from, to := int64(13184*33), int64(13223*33)
	out.window(&from, &to)
	var got []string
	for _, e := range out.Events {
		if e.Kind == "shot" || e.Kind == "damage" || e.Kind == "projectile" {
			continue
		}
		got = append(got, ledgerLine(e))
	}
	want := []string{
		"13184 throwStart KamUz 7w7",
		"13191 melee BC0R",
		"13193 grenade KamUz 7w7",
		"13195 death KamUz 7w7",
		"13195 score",
		"13196 kill BC0R",
		"13200 weaponChange Shawn8",
		"13201 pickup Shawn8",
		"13222 detonation KamUz 7w7",
		"13222 death BC0R",
		"13222 score",
		"13223 kill KamUz 7w7",
		"13223 medal KamUz 7w7",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("ledger order:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	if out.Clock.ContextToDocMs == nil || *out.Clock.ContextToDocMs != 22605 {
		t.Fatalf("context to doc offset = %v, want 22605", out.Clock.ContextToDocMs)
	}
}


func ledgerByID(t *testing.T, out ledgerResponse, id string) ledgerEvent {
	t.Helper()
	for _, e := range out.Events {
		if e.ID == id {
			return e
		}
	}
	t.Fatalf("no event %s", id)
	return ledgerEvent{}
}

func TestLedgerFacts(t *testing.T) {
	doc, events, t0 := ledgerGameWinner()
	out := buildLedger(doc, events, t0)
	out.window(nil, nil)

	// The kill is placed on the document clock and named by its pair's rank.
	k := ledgerByID(t, out, "kill/"+ledgerKamUz+"/"+ledgerBC0R+"/0")
	if k.Ms != 436356 || k.Frame != 13223 || k.Weapon != "hinf_plasma_grenade" || k.Target == nil || k.Target.Gamertag != "BC0R" || *k.Target.Team != 1 {
		t.Fatalf("kill = %+v target %+v", k, k.Target)
	}
	// The point-blank stick: a grenade with no flight, and its detonation from its own `deto`.
	g := ledgerByID(t, out, "grenade/0")
	if g.Facts["pointBlank"] != true || g.Facts["type"] != "Plasma" || g.Facts["detonation"] != 13222 || g.Actor.Gamertag != "KamUz 7w7" || *g.Actor.Team != 0 {
		t.Fatalf("grenade = %+v", g)
	}
	d := ledgerByID(t, out, "detonation/grenade/0")
	if d.Frame != 13222 || d.Facts["z"] != float32(5.02) {
		t.Fatalf("detonation = %+v", d)
	}
	// A shot projectile detonates only when its weapon declares impact.
	ledgerByID(t, out, "detonation/projectile/0")
	for _, e := range out.Events {
		if e.ID == "detonation/projectile/1" {
			t.Fatalf("a bullet has no detonation: %+v", e)
		}
	}
	if p := ledgerByID(t, out, "projectile/0"); p.Weapon != "hinf_rocket_launcher" || p.Facts["shot"] != "shot/1" || p.Actor.Gamertag != "Shawn8" {
		t.Fatalf("projectile = %+v", p)
	}
	// Deaths: by a kill (its killer named), by a later life (cause unread); a life that runs to
	// the film's end is not a death.
	bc := ledgerByID(t, out, "death/606")
	if bc.Facts["cause"] != "killed" || bc.Facts["kill"] != "kill/"+ledgerKamUz+"/"+ledgerBC0R+"/0" || bc.Facts["killer"].(*ledgerPlayer).Gamertag != "KamUz 7w7" {
		t.Fatalf("BC0R death = %+v", bc)
	}
	if s := ledgerByID(t, out, "death/590"); s.Facts["cause"] != "unread" {
		t.Fatalf("Shawn's first death = %+v", s)
	}
	for _, e := range out.Events {
		if e.ID == "death/604" {
			t.Fatalf("a survivor's life end is not a death: %+v", e)
		}
	}
	// Score: the value after the tick for every team.
	sc := ledgerByID(t, out, "score/0/50")
	if after := sc.Facts["after"].(map[string]int); after["0"] != 50 || after["1"] != 49 || sc.Facts["target"] != 50 {
		t.Fatalf("score = %+v", sc)
	}
	// Weapons resolve bare 8-digit families; melee and throwStart keep the action's own instant.
	if c := ledgerByID(t, out, "weaponChange/0"); c.Weapon != "hinf_shock_rifle" || c.Facts["change"] != "taken" {
		t.Fatalf("weapon change = %+v", c)
	}
	if m := ledgerByID(t, out, "action/2"); m.Kind != "melee" || m.Ms != 13191*33 || m.Facts["eventMs"] != int64(435332) {
		t.Fatalf("melee = %+v", m)
	}
	for _, e := range out.Events {
		if e.ID == "action/0" {
			t.Fatalf("a reload is not a ledger kind: %+v", e)
		}
	}
	if dm := ledgerByID(t, out, "damage/0"); dm.Actor.Gamertag != "KamUz 7w7" || dm.Target.Gamertag != "BC0R" {
		t.Fatalf("damage = %+v", dm)
	}
	// Medals: placed on the document clock, attached to the actor's kill within 500 ms.
	md := ledgerByID(t, out, "medal/"+ledgerKamUz+"/413752/Stick")
	if md.Ms != 436357 || md.Facts["kill"] != "kill/"+ledgerKamUz+"/"+ledgerBC0R+"/0" || md.Facts["image_url"] != "/static/medals/halo_infinite/3655682764.png" || md.Actor.Gamertag != "KamUz 7w7" {
		t.Fatalf("medal = %+v", md)
	}
	if alone := ledgerByID(t, out, "medal/"+ledgerKamUz+"/415000/Killjoy"); alone.Facts["kill"] != nil {
		t.Fatalf("orphan medal = %+v", alone)
	}
	if out.Counts["kill"] != 2 || out.Counts["death"] != 3 || out.Counts["medal"] != 2 {
		t.Fatalf("counts = %v", out.Counts)
	}
}

func TestLedgerWithoutOriginNamesTheGap(t *testing.T) {
	doc, events, t0 := ledgerGameWinner()
	doc.OriginMs = nil
	out := buildLedger(doc, events, t0)
	out.window(nil, nil)
	if out.Counts["kill"] != 0 || out.Counts["medal"] != 0 || len(out.Notes) != 1 || !strings.Contains(out.Notes[0], "originMs") {
		t.Fatalf("counts %v notes %v", out.Counts, out.Notes)
	}
}

func TestLedgerWindowQuery(t *testing.T) {
	for _, c := range []struct {
		q    string
		ok   bool
		from int64
	}{
		{"", true, -1}, {"?fromMs=434100&toMs=437775", true, 434100}, {"?fromMs=434100.4", true, 434100},
		{"?fromMs=abc", false, 0}, {"?fromMs=5&toMs=4", false, 0},
	} {
		from, _, err := ledgerWindow(httptest.NewRequest("GET", "/api/matches/x/ledger"+c.q, nil))
		if (err == nil) != c.ok {
			t.Fatalf("%q: err %v", c.q, err)
		}
		if c.ok && c.from >= 0 && (from == nil || *from != c.from) {
			t.Fatalf("%q: from %v", c.q, from)
		}
	}
}
