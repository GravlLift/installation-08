package replay

import "testing"

func TestScoreTargetTable(t *testing.T) {
	for variant, want := range map[string]int{
		"Ranked:Slayer":            50,
		"Ranked:CTF":               3,
		"Ranked:Strongholds":       250,
		"Ranked:King of the Hill":  4,
		"Strongholds:Arena":        200,
		"CTF:Arena Neutral Flag":   5,
		"Squad:King of the Hill":   3,
		"BTB:Stockpile":            5,
		"Super Husky Raid:CTF":     3,
		"BTB Heavies:Total Control": 3,
	} {
		got, ok := ScoreTarget(variant)
		if !ok || got != want {
			t.Errorf("ScoreTarget(%q) = %d, %v; want %d, true", variant, got, ok, want)
		}
	}
	// Oddball is a rounds mode: its total overshoots any single target, so the table
	// deliberately declares none (LevelUp regulation.toml [score_target]).
	if _, ok := ScoreTarget("Ranked:Oddball"); ok {
		t.Error("Ranked:Oddball must have no declared target")
	}
}
