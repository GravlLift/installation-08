package replay

// LOCAL-CHANGE (brief 142, replay parity): the victory-score table the standalone publishes
// on the score timeline. Ported verbatim from LevelUp's
// config/titles/halo_infinite/mappings/regulation.toml [score_target] (the LevelUp
// application injects the table into this module's ScoreInput; the standalone has no config
// file, so the measured values live here). An absent variant returns ok=false: the timeline
// then carries no target, which is the safe fallback (an unfilled bar, never a wrong one).
var scoreTargetByVariant = map[string]int{
	"Slayer:Arena":            50,
	"Team Slayer:Arena":       50,
	"Slayer:Arena Super Fiesta": 50,
	"Slayer:Arena Fiesta":     50,
	"Slayer:Arena Tactical":   50,
	"Arena:Slayer":            50,
	"Arena:Team Slayer":       50,
	"Arena:Team Snipers":      50,
	"Team Snipers:Arena":      50,
	"Fiesta:Slayer":           50,
	"Super Fiesta:Slayer":     50,
	"Tactical:Slayer":         50,
	"Ranked:Slayer":           50,
	"BTB:Slayer":              100,
	"BTB Heavies:Slayer":      100,
	"BTB:Fiesta Slayer":       100,
	"BTB:Team Snipers":        100,
	"CTF:Arena":               3,
	"Arena:CTF":               3,
	"Ranked:CTF":              3,
	"Ranked:CTF 3 Captures":   3,
	"BTB:CTF":                 3,
	"BTB Heavies:CTF":         3,
	"BTB:Fiesta CTF":          3,
	"CTF:BTB":                 3,
	"Husky Raid:CTF":          3,
	"Husky Raid:Super CTF":    3,
	"Super Husky Raid:CTF":    3,
	"Arena:One Flag CTF":      3,
	"BTB:One Flag CTF":        3,
	"CTF:Arena Neutral Flag":  5,
	"Strongholds:Arena":       200,
	"Arena:Strongholds":       200,
	"Ranked:Strongholds":      250,
	"KOTH:Arena":              3,
	"Ranked:King of the Hill": 4,
	"Doubles:King of the Hill": 3,
	"Squad:King of the Hill":  3,
	"BTB:Total Control":       3,
	"BTB Heavies:Total Control": 3,
	"Fiesta Total Control":    3,
	"BTB:Stockpile":           5,
	"Assault:Neutral Bomb":    3,
	"Assault:One Bomb":        3,
	"Arena:VIP":               10,
	"Arena:Escalation Slayer": 11,
	"Event:Escalation Slayer": 11,
}

// ScoreTarget returns the variant's victory score from the table above. ok is false when
// the variant is not declared (absent = no reading, the caller publishes no target).
func ScoreTarget(variant string) (int, bool) {
	v, ok := scoreTargetByVariant[variant]
	return v, ok
}
