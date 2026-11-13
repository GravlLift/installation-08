package main

// LevelUp internal/service/match_view_converters.go and internal/analysis/combat_yield.go.
func contextCombatYield(row contextJSON) {
	kills, _ := row["kills"].(int)
	deaths, _ := row["deaths"].(int)
	assists, _ := row["assists"].(int)
	dealt, hasDealt := row["damage_dealt"].(float64)
	taken, hasTaken := row["damage_taken"].(float64)
	const effectiveHP = 225.0 // LevelUp internal/games/damage_model.go.
	if hasDealt {
		oc := 0.0
		if dealt > 0 {
			oc = effectiveHP * (float64(kills) + float64(assists)/3) / dealt
		}
		row["offensive_conversion"] = oc
		if kills > 0 {
			row["damage_per_kill"] = dealt / float64(kills)
		}
		if hasTaken {
			dr := 0.0
			if deaths == 0 {
				dr = -1
			} else if taken > 0 && deaths > 0 {
				dr = taken / (effectiveHP * float64(deaths))
			}
			row["defensive_resistance"] = dr
		}
	}
	if hasTaken && deaths > 0 {
		row["damage_per_death"] = taken / float64(deaths)
	}
}
