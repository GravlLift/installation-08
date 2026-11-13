package build

// options.go — assembling the replay.Options of a standalone decode, in the order
// LevelUp's replaybuild does it (statborg second decode, mode gates, per-round identity
// bridge, kill references), without any of the application glue: no DuckDB, no ports, no
// title registry, no job queue.

import (
	"context"
	"log/slog"
	"os"
	"strconv"

	"github.com/JGtm/halo-infinite-film-decoder/decfilm"
	"github.com/JGtm/halo-infinite-film-decoder/replay"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// buildOptions assembles the decoder options from what the film already says plus the
// optional match stats. Every layer that needs an absent input gets its zero entry, and
// the document publishes the silence (its coverage sections), it does not invent data.
func buildOptions(ctx context.Context, matchID string, film *decfilm.Film, deaths []types.Death,
	killsource *decfilm.Result, in Input, entry decfilm.MapQuantEntry,
) replay.Options {
	stats, _ := loadStats(ctx, in)
	lines, teams, roster := linesOfStats(stats)
	recs, bursts, horloge := statborg(ctx, matchID, film)
	gates := replay.GardesDeLaVariante(stats.GameVariantName)
	pont := replay.NouveauPontParManche(recs, deathInstants(deaths), lines, nil)
	kills, matchKills, causes := killRefs(killsource, deaths)
	return replay.Options{
		MapQuant:         &entry,
		Deaths:           deaths,
		RosterXUIDs:      roster,
		Participants:     participantsOf(stats),
		ScoreboardTeams:  teams,
		Score:            scoreInput(recs, lines, teams, stats),
		Flag:             replay.EntreeDuDrapeau(recs, bursts, pont),
		Vip:              replay.EntreeDeLaCouronne(recs, gates.VIP),
		Skull:            replay.EntreeDuCrane(recs, gates.Crane, pont),
		Bomb:             replay.EntreeDeLaBombe(horloge, gates.Bombe),
		StatborgIdentity: pont.Identite(),
		Objectives:       objectivesOf(ctx, matchID, recs, deaths, gates, pont),
		NeutralDeaths:    neutralDeaths(ctx, matchID, killsource),
		Kills:            kills,
		MatchKills:       matchKills,
		KillCauses:       causes,
		ProfilDeBalayage: profileOf(killsource),
	}
}

// loadStats reads the optional match stats. Any problem degrades to the zero Stats and is
// logged, never returned: a bad optional input must not fail a decode the film alone can
// carry.
func loadStats(ctx context.Context, in Input) (Stats, bool) {
	var s Stats
	if in.StatsPath == "" {
		return s, false
	}
	raw, err := os.ReadFile(in.StatsPath)
	if err != nil {
		slog.WarnContext(ctx, "match stats unreadable: building from the film alone", "err", err, "path", in.StatsPath)
		return s, false
	}
	if err := jsonUnmarshal(raw, &s); err != nil {
		slog.WarnContext(ctx, "match stats invalid: building from the film alone", "err", err, "path", in.StatsPath)
		return s, false
	}
	return s, true
}

// statborg reads the entity records of the film once, with their capture bursts and the
// chunk clock of the manifest (the bomb armament ring is dated on it). Empty when the film
// has no datable records: the score curve and the mode layers then publish their silence.
func statborg(ctx context.Context, matchID string, film *decfilm.Film) ([]types.StatRecord, []int, map[int]int) {
	meta := film.Meta()
	if !hasDatableChunk(meta) {
		// LevelUp reads this section through the manifest-dated chunks (objectives.
		// StatRecordsAvecReplis); a film without manifest metadata has nothing datable,
		// so the entity records are not read and the score curve stays absent.
		if len(meta) > 0 {
			slog.InfoContext(ctx, "no manifest-dated chunks: entity records not read", "match_id", matchID)
		}
		return nil, nil, nil
	}
	recs := decfilm.StatRecords(film)
	if len(recs) == 0 {
		slog.InfoContext(ctx, "no entity records in the film: score curve empty", "match_id", matchID)
	}
	return recs, decfilm.CaptureBurstTimes(film), chunkClock(meta)
}

// hasDatableChunk says whether the film carries at least one manifest-dated chunk
// (a chunk type other than zero, the synthesized form LoadDir gives a file not in the manifest).
func hasDatableChunk(meta []decfilm.ChunkMeta) bool {
	for _, m := range meta {
		if m.ChunkType != 0 {
			return true
		}
	}
	return false
}

// chunkClock renders the manifest clock (start_ms per chunk index) that the bomb armament
// ring is dated on.
func chunkClock(meta []decfilm.ChunkMeta) map[int]int {
	out := make(map[int]int, len(meta))
	for _, m := range meta {
		out[m.Index] = m.StartMS
	}
	return out
}

// objectivesOf names the objective actions of the film and attributes them per round.
// Without match lines the attribution is refused and logged, never invented: the layer
// stays publishable offline but empty.
func objectivesOf(ctx context.Context, matchID string, recs []types.StatRecord,
	deaths []types.Death, gates replay.GardesDesPorteurs, pont *replay.PontParManche,
) []decfilm.IdentifiedEvent {
	named := decfilm.NamedEventsFrom(recs, objectiveFamily(gates), nil)
	if len(named) == 0 {
		return nil
	}
	if deaths == nil {
		slog.WarnContext(ctx, "objective actions not identified: death feed unreadable", "match_id", matchID)
		return nil
	}
	out, _ := decfilm.IdentifyNamedEventsByRound(named, pont.Identite())
	slog.InfoContext(ctx, "objective actions identified per round",
		"match_id", matchID, "named", len(named), "identified", len(out))
	return out
}

// objectiveFamily is the objective family of the mode, from its variant name.
func objectiveFamily(gates replay.GardesDesPorteurs) string {
	switch {
	case gates.Drapeau:
		return decfilm.ObjectiveTypeFlag
	case gates.Crane:
		return decfilm.ObjectiveTypeSkull
	case gates.Bombe:
		return decfilm.ObjectiveTypeBomb
	default:
		return ""
	}
}

// neutralDeaths renders the deaths nobody claims, with their type resolved from the kill
// source decode. The pictogram of the title is LevelUp glue (an asset URL, not data); the
// stable kind identifier (the document's contract) needs no table. Without a killsource
// decode the layer is absent: the death feed lines keep their generic marker, which is
// the decoder's own rule for an unresolved nature.
func neutralDeaths(ctx context.Context, matchID string, res *decfilm.Result) []replay.NeutralDeath {
	if res == nil || len(res.UnclaimedDeaths) == 0 {
		return nil
	}
	if !res.LineByLinePublishable() {
		slog.InfoContext(ctx, "line-by-line attribution refused: neutral deaths without type", "match_id", matchID)
		return nil
	}
	var out []replay.NeutralDeath
	for _, d := range res.UnclaimedDeaths {
		if d.VictimXUID == 0 {
			continue
		}
		out = append(out, replay.NeutralDeath{
			XUID:   strconv.FormatUint(d.VictimXUID, 10),
			FeedMs: d.TimeMS,
			Kind:   string(d.Source.Class),
			Tinted: true,
		})
	}
	return out
}

// killRefs resolves, from the SAME killsource pass, the three kill entries the document
// consumes: the equipment-episode kills, the bomb-carrier pairs and the kill causes. The
// resolution is entirely film-native: the killer, assist and victim gamertags are resolved
// to xuids against the film's own death feed (each death record carries both the victim's
// xuid and gamertag), exactly as LevelUp does. Without a killsource decode, or with the
// line-by-line gate closed, the entries are zero: the document publishes the silence.
func killRefs(res *decfilm.Result, deaths []types.Death) (replay.KillsInput, replay.MatchKillsInput, []replay.KillCause) {
	if res == nil || !res.LineByLinePublishable() {
		return replay.KillsInput{}, replay.MatchKillsInput{}, nil
	}
	byGamertag, _ := gamertagXUIDIndex(deaths)
	refs := make([]replay.EquipmentKillRef, 0, len(res.Kills))
	pairs := make([]replay.KillRef, 0, len(res.Kills))
	causes := make([]replay.KillCause, 0, len(res.Kills))
	for _, k := range res.Kills {
		killer, ok := byGamertag[k.Feed.Killer]
		if !ok {
			continue // no resolved identity: the frag meets no slot, omitting is lossless
		}
		ref := replay.EquipmentKillRef{XUID: killer, TimeMS: k.TimeMS}
		if k.Assist.Known && k.Assist.Name != "" {
			if a, ok := byGamertag[k.Assist.Name]; ok {
				ref.AssistXUID, ref.AssistKnown = a, true
			}
		}
		refs = append(refs, ref)
		cause := replay.KillCause{
			FeedMs:   k.TimeMS,
			Killer:   formatXUID(killer),
			Class:    string(k.Source.Class),
			Category: categoryOf(k.Source.Category),
		}
		victim, vok := byGamertag[k.Victim]
		if vok {
			cause.Victim = formatXUID(victim)
			pairs = append(pairs, replay.KillRef{KillerXUID: killer, VictimXUID: victim, TimeMS: int64(k.TimeMS)})
		}
		causes = append(causes, cause)
	}
	return replay.KillsInput{Read: true, Kills: refs, Paths: deathsPaths(res)},
		replay.MatchKillsInput{Read: true, Kills: pairs, Dropped: len(res.Kills) - len(pairs)}, causes
}

// gamertagXUIDIndex builds the gamertag -> xuid table from the film's death feed. A gamertag
// seen under two xuids enters no table: neither is safer than the other, and its frags stay
// unresolved (the count of such gamertags is the ambiguity measure LevelUp logs).
func gamertagXUIDIndex(deaths []types.Death) (map[string]uint64, int) {
	out := make(map[string]uint64, len(deaths))
	ambiguous := map[string]bool{}
	for _, d := range deaths {
		if d.Gamertag == "" || ambiguous[d.Gamertag] {
			continue
		}
		if first, seen := out[d.Gamertag]; seen && first != d.XUID {
			ambiguous[d.Gamertag] = true
			delete(out, d.Gamertag)
			continue
		}
		out[d.Gamertag] = d.XUID
	}
	return out, len(ambiguous)
}

// deathsPaths renders the two death-reading paths' tallies into the artifact's coverage block
// (the health of the same decode that Read already qualifies). Nil when the pass is nil.
func deathsPaths(res *decfilm.Result) *replay.DeathsPathsCoverage {
	if res == nil {
		return nil
	}
	return &replay.DeathsPathsCoverage{
		Walk: pathTally(res.Stats.Walk),
		Scan: pathTally(res.Stats.Scan),
	}
}

func pathTally(s decfilm.PathStats) replay.DeathsPathTally {
	return replay.DeathsPathTally{Population: s.Population, Matched: s.Matched, Published: s.Published}
}

// categoryOf renders the damage modifier under its engine name (the stable identifiers of
// the document contract), empty when it is None.
func categoryOf(c decfilm.Category) string {
	names := []string{"None", "Headshot", "HeadshotMultiplier", "SilentMelee", "CollisionDamage", "AttachedDamage", "WeakSpot", "ChainedProjectile", "SweetHeat", "VehicleTransferDamage"}
	if c < 0 || int(c) >= len(names) {
		return ""
	}
	if c == decfilm.CategoryNone {
		return ""
	}
	return names[c]
}

// profileOf is the scan profile the killsource pass calibrated on THIS film; nil when the
// decode did not run, in which case the decoder keeps its default profile invariant.
func profileOf(res *decfilm.Result) *decfilm.ProfilDeBalayage {
	if res == nil {
		return nil
	}
	p := res.ProfilCalibre
	return &p
}
