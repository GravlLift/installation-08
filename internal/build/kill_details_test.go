package build

import (
	"github.com/JGtm/halo-infinite-film-decoder/decfilm"
	"github.com/JGtm/halo-infinite-film-decoder/types"
	"testing"
)

func TestKillDetails(t *testing.T) {
	result := &decfilm.Result{BijectionDetermined: true, Kills: []decfilm.Kill{{TimeMS: 30000, Feed: decfilm.FeedTruth{Killer: "Alpha"}, Assist: decfilm.Assist{Known: true, Name: "Helper"}, KillerDamage: decfilm.DamageShare{Known: true, Pct: 75}}}}
	details := killDetails(result, []types.Death{{XUID: 1, Gamertag: "Alpha"}})
	if len(details) != 1 || details[0].Killer != "1" || details[0].AssistState != "named" || details[0].AssistGamertag != "Helper" || details[0].KillerDamagePct == nil || *details[0].KillerDamagePct != 75 {
		t.Fatalf("details: %+v", details)
	}
	result.BijectionDetermined = false
	if got := killDetails(result, nil); got != nil {
		t.Fatalf("unpublishable details: %+v", got)
	}
}
