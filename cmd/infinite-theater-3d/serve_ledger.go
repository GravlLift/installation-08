// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_ledger.go — THE EVENT LEDGER: every event of a match, in order, as data.
//
// GET /api/matches/{id}/ledger?fromMs=&toMs= answers the match's events between two instants of
// the replay document's clock ("doc ms": frame x frameIntervalMs, the web's `frameToMs`), each
// with its kind, frame, instant, actor, target, weapon and the facts the document gives. It is a
// READ of what the server already serves: the replay document as `/replay` serves it (stored
// document plus the request-time enrichments, so weapon keys resolve the same way) and the kills
// deaths and medals of `/context` (`highlight_events`). Nothing is decoded again.
//
// Every event carries an `id` built from where it lives in the document (`shot/12` is
// `doc.shots[12]`). The render coverage of an export (web `export/renderCoverage.ts`) joins the
// renderer's own draw records to these ids, so an event the render does not draw is named.
//
// THE KILL CLOCK. Context kills, deaths and medals are dated on the match clock (`event_time_ms`, origin the match's
// T0); the document's frame 0 sits `originMs` after the film's zero, on the clock the context
// rebuilds as `event_time_ms + t0_ms`. So a kill's doc ms is `event_time_ms + t0_ms - originMs`
// (`replay.ReplayDocument.OriginMs`, and the web's `matchClock`), and its frame is that instant
// on the frame grid, rounded (`deaths3d.buildDeaths3d` places a kill at the same frame).

import (
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/JGtm/halo-infinite-film-decoder/replay"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// ledgerFallbackFPS is the web's FALLBACK_FPS: the frame rate of a document without frameIntervalMs.
const ledgerFallbackFPS = 60

// ledgerDeathBefore and ledgerDeathAfterMs bound how far a death or kill event may sit from the
// end of the life it closes: the feed trails the end of life by 0.7 to 4.3 frames on 9220185c,
// and the web's own join (`deaths3d.DEATH_LAG_SECONDS`) allows one second.
const (
	ledgerDeathBefore  = 3
	ledgerDeathAfterMs = 1000
)

// ledgerMedalAttachMs is the web's MEDAL_ATTACH_MS: a medal belongs to its actor's kill within it.
const ledgerMedalAttachMs = 500

// ledgerKindRank orders the events of one frame: cause before effect (a throw before its
// grenade, a detonation before the death it causes, a death before its kill line and the score).
var ledgerKindRank = map[string]int{
	"throwStart": 0, "melee": 1, "shot": 2, "grenade": 3, "projectile": 4, "damage": 5,
	"detonation": 6, "death": 7, "kill": 8, "medal": 9, "score": 10, "weaponChange": 11, "pickup": 12,
}

// ledgerPlayer names who did or took an event.
type ledgerPlayer struct {
	Gamertag string  `json:"gamertag,omitempty"`
	XUID     string  `json:"xuid,omitempty"`
	Team     *int    `json:"team,omitempty"`
	Slot     *uint32 `json:"slot,omitempty"`
}

// ledgerEvent is one event of the match.
type ledgerEvent struct {
	ID     string         `json:"id"`
	Kind   string         `json:"kind"`
	Frame  int            `json:"frame"`
	Ms     int64          `json:"ms"`
	Actor  *ledgerPlayer  `json:"actor,omitempty"`
	Target *ledgerPlayer  `json:"target,omitempty"`
	Weapon string         `json:"weapon,omitempty"`
	Facts  map[string]any `json:"facts,omitempty"`
}

// ledgerClock says how the instants were placed.
type ledgerClock struct {
	FrameIntervalMs int `json:"frameIntervalMs"`
	// OriginMs is the document's frame 0 on the film clock; T0Ms the match's T0 on it (context
	// header `t0_ms`); ContextToDocMs = T0Ms - OriginMs, added to a context `event_time_ms`.
	OriginMs       *int64 `json:"originMs,omitempty"`
	T0Ms           int64  `json:"t0Ms"`
	ContextToDocMs *int64 `json:"contextToDocMs,omitempty"`
}

// ledgerResponse is the route's answer.
type ledgerResponse struct {
	MatchID string        `json:"matchId"`
	FromMs  *int64        `json:"fromMs,omitempty"`
	ToMs    *int64        `json:"toMs,omitempty"`
	Clock   ledgerClock   `json:"clock"`
	Events  []ledgerEvent `json:"events"`
	// Counts is the number of events of each kind in the window.
	Counts map[string]int `json:"counts"`
	// Notes names what the ledger could not place (never a silent gap).
	Notes []string `json:"notes,omitempty"`
}

// handleLedger answers GET /api/matches/{id}/ledger.
func (h serverHandlers) handleLedger(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !store.MatchIDValid(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid match id"})
		return
	}
	from, to, err := ledgerWindow(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	raw, err := h.root.LoadReplay(id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "match_not_found", "id": id})
			return
		}
		slog.Error("load replay for ledger", "err", err, "id", id)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	doc, err := decodeReplayDocument(replayWithEnrichments(r.Context(), h.root, id, h.labelCat, raw))
	if err != nil {
		slog.Error("decode replay for ledger", "err", err, "id", id)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	ctxRes, err := buildContext(h.root, id, "")
	if err != nil {
		slog.Error("build context for ledger", "err", err, "id", id)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "context unavailable"})
		return
	}
	events, _ := ctxRes["highlight_events"].([]contextJSON)
	var t0 int64
	if header, ok := ctxRes["header"].(contextJSON); ok {
		t0 = int64Of(header["t0_ms"])
	}
	out := buildLedger(doc, events, t0)
	out.MatchID = id
	out.window(from, to)
	writeJSON(w, http.StatusOK, out)
}

// ledgerWindow reads the optional fromMs and toMs (doc ms, inclusive).
func ledgerWindow(r *http.Request) (*int64, *int64, error) {
	read := func(name string) (*int64, error) {
		v := strings.TrimSpace(r.URL.Query().Get(name))
		if v == "" {
			return nil, nil
		}
		f, err := strconv.ParseFloat(v, 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return nil, fmt.Errorf("invalid %s", name)
		}
		n := int64(math.Round(f))
		return &n, nil
	}
	from, err := read("fromMs")
	if err != nil {
		return nil, nil, err
	}
	to, err := read("toMs")
	if err != nil {
		return nil, nil, err
	}
	if from != nil && to != nil && *to < *from {
		return nil, nil, errors.New("toMs before fromMs")
	}
	return from, to, nil
}

// window keeps the events between from and to (doc ms, inclusive) and counts them by kind.
func (l *ledgerResponse) window(from, to *int64) {
	l.FromMs, l.ToMs = from, to
	kept := l.Events[:0]
	for _, e := range l.Events {
		if (from == nil || e.Ms >= *from) && (to == nil || e.Ms <= *to) {
			kept = append(kept, e)
		}
	}
	l.Events = kept
	l.Counts = map[string]int{}
	for _, e := range l.Events {
		l.Counts[e.Kind]++
	}
}

// int64Of reads a JSON-ish number (int, int64, float64) as int64; anything else is 0.
func int64Of(v any) int64 {
	switch n := v.(type) {
	case int:
		return int64(n)
	case int64:
		return n
	case float64:
		return int64(n)
	}
	return 0
}

// ledgerBuilder holds the document's lookups while the events are read.
type ledgerBuilder struct {
	doc      *replay.ReplayDocument
	interval int
	bySlot   map[uint32]*replay.Track
	names    map[string]string
	events   []ledgerEvent
	notes    []string
}

// buildLedger reads every event of the document and of the context's highlight events, in
// order. `t0` is the context header's `t0_ms` (0 when it has none).
func buildLedger(doc *replay.ReplayDocument, highlights []contextJSON, t0 int64) ledgerResponse {
	b := &ledgerBuilder{doc: doc, interval: doc.FrameIntervalMS, bySlot: map[uint32]*replay.Track{}, names: map[string]string{}}
	for i := range doc.Tracks {
		b.bySlot[doc.Tracks[i].Slot] = &doc.Tracks[i]
	}
	for _, p := range doc.Roster {
		if p.Name != "" {
			b.names[p.XUID] = p.Name
		}
	}
	clock := ledgerClock{FrameIntervalMs: doc.FrameIntervalMS, OriginMs: doc.OriginMs, T0Ms: t0}
	var kills, deaths, medals []ledgerContextEvent
	if doc.OriginMs != nil {
		offset := t0 - *doc.OriginMs
		clock.ContextToDocMs = &offset
		kills, deaths, medals = b.contextEvents(highlights, offset)
	} else if len(highlights) > 0 {
		b.notes = append(b.notes, "kills, deaths and medals not placed: the document has no originMs, so the context clock cannot be put on its frames")
	}
	b.shots()
	b.damages()
	b.actions()
	b.grenadesAndProjectiles()
	b.weaponChanges()
	b.pickups()
	b.deaths(kills, deaths)
	b.kills(kills)
	b.medals(medals, kills)
	b.scores()
	sort.SliceStable(b.events, func(i, j int) bool {
		p, q := b.events[i], b.events[j]
		if p.Frame != q.Frame {
			return p.Frame < q.Frame
		}
		if ledgerKindRank[p.Kind] != ledgerKindRank[q.Kind] {
			return ledgerKindRank[p.Kind] < ledgerKindRank[q.Kind]
		}
		return p.Ms < q.Ms
	})
	return ledgerResponse{MatchID: doc.MatchID, Clock: clock, Events: b.events, Counts: map[string]int{}, Notes: b.notes}
}

// frameMs is the web's `frameToMs`: a frame's instant on the document clock.
func (b *ledgerBuilder) frameMs(frame int) int64 {
	if b.interval > 0 {
		return int64(frame) * int64(b.interval)
	}
	return int64(math.Round(float64(frame) * 1000 / ledgerFallbackFPS))
}

// msFrame is the frame of a document instant, rounded (the web's `Math.round(msToFrames(ms))`).
func (b *ledgerBuilder) msFrame(ms int64) int {
	if b.interval > 0 {
		return int(math.Round(float64(ms) / float64(b.interval)))
	}
	return int(math.Round(float64(ms) * ledgerFallbackFPS / 1000))
}

// player names the biped of a slot: its life's xuid and team, the roster's name.
func (b *ledgerBuilder) player(slot uint32) *ledgerPlayer {
	s := slot
	p := &ledgerPlayer{Slot: &s}
	if t := b.bySlot[slot]; t != nil {
		team := t.Team
		p.Team = &team
		p.XUID = t.XUID
		p.Gamertag = b.names[t.XUID]
		if p.Gamertag == "" && t.Bot != "" {
			p.Gamertag = t.Bot
		}
	}
	return p
}

// add appends an event at a frame of the grid.
func (b *ledgerBuilder) add(id, kind string, frame int, actor, target *ledgerPlayer, weapon string, facts map[string]any) {
	b.events = append(b.events, ledgerEvent{ID: id, Kind: kind, Frame: frame, Ms: b.frameMs(frame), Actor: actor, Target: target, Weapon: weapon, Facts: facts})
}

// label is the document's weapon label of an identifier: as written (`0x...` keys), or an 8-digit
// family written bare (`1a22fee6`, the weapon changes and pickups).
func (b *ledgerBuilder) label(w string) (replay.WeaponLabel, bool) {
	if w == "" {
		return replay.WeaponLabel{}, false
	}
	if l, ok := b.doc.WeaponLabels[w]; ok {
		return l, true
	}
	l, ok := b.doc.WeaponLabels["0x"+strings.ToUpper(strings.TrimPrefix(strings.ToLower(w), "0x"))]
	return l, ok
}

// weaponKey is a weapon identifier's title key (`hinf_br75`), "" when the label is unknown.
func (b *ledgerBuilder) weaponKey(w string) string {
	l, _ := b.label(w)
	return l.Key
}

func (b *ledgerBuilder) shots() {
	for i, s := range b.doc.Shots {
		facts := map[string]any{"x": s.X, "y": s.Y, "heading": s.H, "pitch": s.P}
		if s.Weapon != "" {
			facts["w"] = s.Weapon
		}
		if s.O != 0 {
			facts["offsetMs"] = s.O
		}
		if s.Vehicle != nil {
			facts["vehicle"] = *s.Vehicle
		}
		b.add(fmt.Sprintf("shot/%d", i), "shot", s.T, b.player(s.Slot), nil, b.weaponKey(s.Weapon), facts)
	}
}

func (b *ledgerBuilder) damages() {
	for i, d := range b.doc.Damages {
		var actor *ledgerPlayer
		facts := map[string]any{}
		if d.By != nil {
			actor = b.player(*d.By)
			if *d.By == d.Slot {
				facts["self"] = true
			}
		}
		if d.Src != nil {
			facts["src"] = *d.Src
		}
		b.add(fmt.Sprintf("damage/%d", i), "damage", d.T, actor, b.player(d.Slot), "", facts)
	}
}

func (b *ledgerBuilder) actions() {
	for i, a := range b.doc.Actions {
		if a.Kind != "melee" && a.Kind != "throwStart" {
			continue
		}
		b.add(fmt.Sprintf("action/%d", i), a.Kind, a.T, b.player(a.Slot), nil, "", map[string]any{"eventMs": a.Ms})
	}
}

// grenadeName is the grenade type's English label (`grenadeLabels`, by rank), "" when unknown.
func (b *ledgerBuilder) grenadeName(rank int) string {
	if rank < 0 || rank >= len(b.doc.GrenadeLabels) {
		return ""
	}
	return b.doc.GrenadeLabels[rank].Text["en"]
}

// grenadesAndProjectiles reads the throws, the flights and their detonations. A throw with a
// flight detonates at its projectile's `detoT`; a point-blank stick (`s` = biped, no flight)
// at its own `deto`; a shot projectile detonates only when its weapon declares `impact`
// (`shotImpactFx.ts` draws the same set).
func (b *ledgerBuilder) grenadesAndProjectiles() {
	grenadeOf := map[int]int{}
	for i, g := range b.doc.Grenades {
		facts := map[string]any{"rank": g.Rank, "surface": g.Src, "x": g.X, "y": g.Y}
		if name := b.grenadeName(g.Rank); name != "" {
			facts["type"] = name
		}
		switch {
		case g.Proj != nil:
			facts["flight"] = fmt.Sprintf("projectile/%d", *g.Proj)
			grenadeOf[*g.Proj] = i
		case g.Deto != nil:
			facts["pointBlank"] = true
			facts["detonation"] = g.Deto.T
			b.add(fmt.Sprintf("detonation/grenade/%d", i), "detonation", g.Deto.T, b.player(g.Slot), nil, "",
				map[string]any{"of": fmt.Sprintf("grenade/%d", i), "rank": g.Rank, "type": b.grenadeName(g.Rank), "x": g.Deto.X, "y": g.Deto.Y, "z": g.Deto.Z, "read": true})
		}
		b.add(fmt.Sprintf("grenade/%d", i), "grenade", g.T, b.player(g.Slot), nil, "", facts)
	}
	for i, p := range b.doc.Projectiles {
		var actor *ledgerPlayer
		weapon := ""
		facts := map[string]any{"detonation": p.DetoT, "read": p.DetoLue}
		if len(p.P) > 0 {
			facts["end"] = p.T0 + int(p.P[len(p.P)-1][0])
		}
		if p.Attach != nil {
			facts["attach"] = map[string]any{"from": p.Attach.FromFrame, "parentSlot": p.Attach.ParentSlot, "node": p.Attach.Node}
		}
		detonates := false
		if gi, ok := grenadeOf[i]; ok {
			g := b.doc.Grenades[gi]
			actor = b.player(g.Slot)
			facts["grenade"] = fmt.Sprintf("grenade/%d", gi)
			detonates = true
		} else if p.Shot != nil && *p.Shot >= 0 && *p.Shot < len(b.doc.Shots) {
			s := b.doc.Shots[*p.Shot]
			actor = b.player(s.Slot)
			weapon = b.weaponKey(s.Weapon)
			facts["shot"] = fmt.Sprintf("shot/%d", *p.Shot)
			l, _ := b.label(s.Weapon)
			detonates = l.Impact
		}
		b.add(fmt.Sprintf("projectile/%d", i), "projectile", p.T0, actor, nil, weapon, facts)
		if detonates {
			b.add(fmt.Sprintf("detonation/projectile/%d", i), "detonation", p.DetoT, actor, nil, weapon,
				map[string]any{"of": fmt.Sprintf("projectile/%d", i), "x": p.DetoX, "y": p.DetoY, "read": p.DetoLue})
		}
	}
}

func (b *ledgerBuilder) weaponChanges() {
	for i, c := range b.doc.WeaponChanges {
		facts := map[string]any{"change": string(c.Kind), "w": c.W}
		if c.From != "" {
			facts["from"] = b.weaponKey(c.From)
		}
		if c.K != nil {
			facts["weaponSlot"] = *c.K
		}
		b.add(fmt.Sprintf("weaponChange/%d", i), "weaponChange", c.T, b.player(c.Slot), nil, b.weaponKey(c.W), facts)
	}
}

func (b *ledgerBuilder) pickups() {
	for i, p := range b.doc.Pickups {
		facts := map[string]any{"pickup": string(p.Kind), "w": p.W}
		if p.Family != "" {
			facts["family"] = p.Family
		}
		b.add(fmt.Sprintf("pickup/%d", i), "pickup", p.T, b.player(p.Slot), nil, b.weaponKey(p.W), facts)
	}
}

// ledgerContextEvent is a context kill or death placed on the document clock.
type ledgerContextEvent struct {
	ev    contextJSON
	ms    int64
	actor string
	// victim is the kill's victim; "" for a death (its actor is the one who died).
	victim string
	id     string
}

// contextEvents places the context's kills and deaths on the document clock and names each
// kill by its killer, victim and rank among that pair's kills (`kill/<killer>/<victim>/<n>`,
// stable whatever the window).
func (b *ledgerBuilder) contextEvents(highlights []contextJSON, offset int64) (kills, deaths, medals []ledgerContextEvent) {
	for _, e := range highlights {
		ms := int64Of(e["event_time_ms"]) + offset
		switch e["event_type"] {
		case "kill":
			kills = append(kills, ledgerContextEvent{ev: e, ms: ms, actor: textValue(e["actor_xuid"]), victim: textValue(e["victim_xuid"])})
		case "death":
			deaths = append(deaths, ledgerContextEvent{ev: e, ms: ms, actor: textValue(e["actor_xuid"])})
		case "medal":
			// The web's `collectMedalEvents` keeps a medal with an actor and a name only. Its id is
			// what both sides read as is: actor, context instant, English name.
			name := textValue(e["medal_name"])
			if actor := textValue(e["actor_xuid"]); actor != "" && name != "" {
				id := fmt.Sprintf("medal/%s/%d/%s", actor, int64Of(e["event_time_ms"]), name)
				medals = append(medals, ledgerContextEvent{ev: e, ms: ms, actor: actor, id: id})
			}
		}
	}
	sort.SliceStable(kills, func(i, j int) bool { return kills[i].ms < kills[j].ms })
	rank := map[string]int{}
	for i := range kills {
		pair := kills[i].actor + "/" + kills[i].victim
		kills[i].id = fmt.Sprintf("kill/%s/%d", pair, rank[pair])
		rank[pair]++
	}
	return kills, deaths, medals
}

// contextPlayer names a player of a context event from its own fields.
func contextPlayer(e contextJSON, prefix string) *ledgerPlayer {
	xuid := textValue(e[prefix+"_xuid"])
	if xuid == "" {
		return nil
	}
	p := &ledgerPlayer{XUID: xuid, Gamertag: textValue(e[prefix+"_gamertag"])}
	if v, ok := e[prefix+"_team_id"]; ok {
		team := int(int64Of(v))
		p.Team = &team
	}
	return p
}

func (b *ledgerBuilder) kills(kills []ledgerContextEvent) {
	for _, k := range kills {
		facts := map[string]any{}
		for _, field := range []string{"headshot", "weapon_label", "assist_state", "assist_gamertag", "killer_damage_pct", "assist_damage_pct"} {
			if v, ok := k.ev[field]; ok {
				facts[field] = v
			}
		}
		facts["contextMs"] = int64Of(k.ev["event_time_ms"])
		e := ledgerEvent{ID: k.id, Kind: "kill", Frame: b.msFrame(k.ms), Ms: k.ms, Actor: contextPlayer(k.ev, "actor"), Target: contextPlayer(k.ev, "victim"), Weapon: textValue(k.ev["weapon_key"]), Facts: facts}
		b.events = append(b.events, e)
	}
}

// medals reads the medals, each attached to its actor's nearest kill within ledgerMedalAttachMs
// (the web's `alignFeedByOrigin` rule), or to none.
func (b *ledgerBuilder) medals(medals, kills []ledgerContextEvent) {
	for _, m := range medals {
		facts := map[string]any{"contextMs": int64Of(m.ev["event_time_ms"])}
		for _, field := range []string{"medal_name", "medal_label", "medal_description", "medal_image_url", "medal_name_id"} {
			if v, ok := m.ev[field]; ok {
				facts[strings.TrimPrefix(field, "medal_")] = v
			}
		}
		var kill *ledgerContextEvent
		for i := range kills {
			k := &kills[i]
			dt := k.ms - m.ms
			if dt < 0 {
				dt = -dt
			}
			if k.actor == m.actor && dt <= ledgerMedalAttachMs && (kill == nil || dt < abs64(kill.ms-m.ms)) {
				kill = k
			}
		}
		if kill != nil {
			facts["kill"] = kill.id
		}
		b.events = append(b.events, ledgerEvent{ID: m.id, Kind: "medal", Frame: b.msFrame(m.ms), Ms: m.ms, Actor: contextPlayer(m.ev, "actor"), Facts: facts})
	}
}

func abs64(n int64) int64 {
	if n < 0 {
		return -n
	}
	return n
}

// deaths reads each life's end that is a death: a kill names its player as victim, or a context
// death event names him, within [end - ledgerDeathBefore frames, end + ledgerDeathAfterMs]; a life
// with no such event but a later life of the same player is a death too (cause unread). A life
// that ends with neither is the end of the film for that player, not a death.
func (b *ledgerBuilder) deaths(kills, deaths []ledgerContextEvent) {
	later := map[string]int{}
	for _, t := range b.doc.Tracks {
		start := t.StartFrame
		if start == 0 && len(t.Points) > 0 {
			start = t.Points[0].T
		}
		if t.XUID != "" && start > later[t.XUID] {
			later[t.XUID] = start
		}
	}
	for i := range b.doc.Tracks {
		t := &b.doc.Tracks[i]
		end := t.EndFrame
		if end == 0 && len(t.Points) > 0 {
			end = t.Points[len(t.Points)-1].T
		}
		lo, hi := b.frameMs(end-ledgerDeathBefore), b.frameMs(end)+ledgerDeathAfterMs
		near := func(list []ledgerContextEvent, who func(ledgerContextEvent) string) *ledgerContextEvent {
			for j := range list {
				if t.XUID != "" && who(list[j]) == t.XUID && list[j].ms >= lo && list[j].ms <= hi {
					return &list[j]
				}
			}
			return nil
		}
		facts := map[string]any{}
		weapon := ""
		if k := near(kills, func(e ledgerContextEvent) string { return e.victim }); k != nil {
			facts["cause"] = "killed"
			facts["kill"] = k.id
			if killer := contextPlayer(k.ev, "actor"); killer != nil {
				facts["killer"] = killer
			}
			weapon = textValue(k.ev["weapon_key"])
		} else if d := near(deaths, func(e ledgerContextEvent) string { return e.actor }); d != nil {
			facts["cause"] = "died"
		} else if t.XUID != "" && later[t.XUID] > end {
			facts["cause"] = "unread"
		} else {
			continue
		}
		facts["lifeStart"] = t.StartFrame
		b.add(fmt.Sprintf("death/%d", t.Slot), "death", end, b.player(t.Slot), nil, weapon, facts)
	}
}

// scores reads each team's score ticks (`scoreTimeline`), with the score of every team after it.
func (b *ledgerBuilder) scores() {
	st := b.doc.ScoreTimeline
	if st == nil {
		return
	}
	type tick struct {
		team, round, t, v int
	}
	var ticks []tick
	for _, team := range st.Teams {
		if team.TeamID == nil {
			continue
		}
		if len(team.Rounds) > 0 {
			for _, r := range team.Rounds {
				for _, p := range r.Points {
					ticks = append(ticks, tick{*team.TeamID, r.Round, p.T, p.V})
				}
			}
			continue
		}
		for _, p := range team.Total {
			ticks = append(ticks, tick{*team.TeamID, -1, p.T, p.V})
		}
	}
	sort.SliceStable(ticks, func(i, j int) bool {
		if ticks[i].t != ticks[j].t {
			return ticks[i].t < ticks[j].t
		}
		return ticks[i].team < ticks[j].team
	})
	now := map[int]int{}
	for _, team := range st.Teams {
		if team.TeamID != nil {
			now[*team.TeamID] = 0
		}
	}
	for _, k := range ticks {
		now[k.team] = k.v
		after := map[string]int{}
		for team, v := range now {
			after[strconv.Itoa(team)] = v
		}
		team := k.team
		facts := map[string]any{"team": team, "value": k.v, "after": after}
		if k.round >= 0 {
			facts["round"] = k.round
		}
		if st.TargetScore != nil {
			facts["target"] = *st.TargetScore
		}
		b.events = append(b.events, ledgerEvent{ID: fmt.Sprintf("score/%d/%d", team, k.v), Kind: "score", Frame: k.t, Ms: b.frameMs(k.t), Actor: &ledgerPlayer{Team: &team}, Facts: facts})
	}
}
