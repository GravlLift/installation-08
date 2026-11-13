package main

import (
	"math"
	"strconv"
	"strings"
	"unicode"
)

func contextSnake(s string) string {
	var b strings.Builder
	for i, r := range s {
		if unicode.IsUpper(r) && i > 0 {
			b.WriteByte('_')
		}
		b.WriteRune(unicode.ToLower(r))
	}
	return b.String()
}

func contextDuration(s string) (float64, bool) {
	m := isoDuration.FindStringSubmatch(s)
	if m == nil {
		return 0, false
	}
	h, _ := strconv.ParseFloat(m[1], 64)
	min, _ := strconv.ParseFloat(m[2], 64)
	sec, _ := strconv.ParseFloat(m[3], 64)
	return h*3600 + min*60 + sec, true
}

func fillContextObjective(row contextJSON, bundle map[string]any) {
	objective := contextJSON{}
	fields := map[string][]string{
		"CaptureTheFlagStats": {"FlagCaptures", "FlagCaptureAssists", "FlagGrabs", "FlagSecures", "FlagSteals", "FlagReturns", "FlagCarriersKilled", "FlagReturnersKilled", "KillsAsFlagCarrier", "KillsAsFlagReturner", "TimeAsFlagCarrier"},
		"OddballStats":        {"KillsAsSkullCarrier", "SkullCarriersKilled", "SkullGrabs", "SkullScoringTicks", "TimeAsSkullCarrier", "LongestTimeAsSkullCarrier"},
		"StockpileStats":      {"KillsAsPowerSeedCarrier", "PowerSeedCarriersKilled", "PowerSeedsDeposited", "PowerSeedsStolen", "TimeAsPowerSeedCarrier", "TimeAsPowerSeedDriver"},
		"ExtractionStats":     {"ExtractionConversionsCompleted", "ExtractionConversionsDenied", "ExtractionInitiationsCompleted", "ExtractionInitiationsDenied", "SuccessfulExtractions"},
		"VipStats":            {"KillsAsVip", "VipKills", "VipAssists", "TimesSelectedAsVip", "MaxKillingSpreeAsVip", "TimeAsVip", "LongestTimeAsVip"},
	}
	for block, names := range fields {
		data := object(bundle[block])
		for _, name := range names {
			v, ok := data[name]
			if !ok || v == nil {
				continue
			}
			key := contextSnake(name)
			if strings.HasPrefix(name, "TimeAs") || strings.HasPrefix(name, "LongestTime") {
				if n, ok := contextDuration(textValue(v)); ok {
					objective[key+"_seconds"] = n
				}
			} else {
				objective[key] = v
			}
		}
	}
	zones := object(bundle["ZonesStats"])
	for source, dest := range map[string]string{"StrongholdCaptures": "zone_captures", "StrongholdSecures": "zone_secures", "StrongholdOffensiveKills": "zone_offensive_kills", "StrongholdDefensiveKills": "zone_defensive_kills", "StrongholdScoringTicks": "zone_scoring_ticks"} {
		if v, ok := zones[source]; ok && v != nil {
			objective[dest] = v
		}
	}
	if n, ok := contextDuration(textValue(zones["StrongholdOccupationTime"])); ok {
		objective["time_in_zones_seconds"] = n
	}
	if len(objective) > 0 {
		row["objective"] = objective
	}
}

// fillContextCombatYield ports LevelUp's combat-yield row fields (LevelUp
// internal/sync/performance.go computeCombatYield): damage per kill, damage per death,
// the offensive conversion and the defensive resistance. All four are pure functions of
// the raw API CoreStats, so the standalone computes them from the same numbers LevelUp's
// pipeline persisted. A zero count leaves the per-field reading absent, as in LevelUp.
func fillContextCombatYield(row contextJSON, core map[string]any) {
	kills := contextNumberOrZero(core["Kills"])
	deaths := contextNumberOrZero(core["Deaths"])
	damageDealt := contextNumberOrZero(core["DamageDealt"])
	damageTaken := contextNumberOrZero(core["DamageTaken"])
	if kills > 0 {
		row["damage_per_kill"] = round2(damageDealt / kills)
	}
	if deaths > 0 {
		row["damage_per_death"] = round2(damageTaken / deaths)
	}
	denominator := kills + deaths
	if denominator > 0 {
		row["offensive_conversion"] = round2(kills / denominator)
		row["defensive_resistance"] = round2(deaths / denominator)
	}
}

func contextNumberOrZero(v any) float64 {
	n, _ := contextNumber(v)
	return n
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

func fillContextMedals(row contextJSON, core map[string]any) {
	medals := []contextJSON{}
	row["perfect_kills"] = 0
	for _, v := range array(core["Medals"]) {
		medal := object(v)
		id, ok := medal["NameId"].(float64)
		count, exists := medal["Count"].(float64)
		if ok && exists && id != 0 && count != 0 {
			medals = append(medals, contextJSON{"medal_id": id, "count": count})
			// LevelUp internal/analysis/perfect_kills.go identifies Infinite's Perfect medal.
			if id == 1512363953 {
				row["perfect_kills"] = count
			}
		}
	}
	if len(medals) > 0 {
		row["medals"] = medals
	}
}
