package build

import (
	"github.com/JGtm/halo-infinite-film-decoder/decfilm"
	"github.com/JGtm/halo-infinite-film-decoder/killicon"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

type KillDetail struct {
	TimeMS          int    `json:"time_ms"`
	Killer          string `json:"killer"`
	AssistState     string `json:"assist_state,omitempty"`
	AssistGamertag  string `json:"assist_gamertag,omitempty"`
	KillerDamagePct *int   `json:"killer_damage_pct,omitempty"`
	AssistDamagePct *int   `json:"assist_damage_pct,omitempty"`
	WeaponKey       string `json:"weapon_key,omitempty"`
	WeaponLabel     string `json:"weapon_label,omitempty"`
}

func killDetails(result *decfilm.Result, deaths []types.Death) []KillDetail {
	if result == nil || !result.LineByLinePublishable() {
		return nil
	}
	ids, _ := gamertagXUIDIndex(deaths)
	details := make([]KillDetail, 0, len(result.Kills))
	for _, k := range result.Kills {
		id, ok := ids[k.Feed.Killer]
		if !ok {
			continue
		}
		d := KillDetail{TimeMS: k.TimeMS, Killer: formatXUID(id)}
		if k.Assist.Known {
			d.AssistState = "none"
			if k.Assist.Name != "" {
				d.AssistState = "named"
				d.AssistGamertag = k.Assist.Name
			}
		}
		if k.KillerDamage.Known {
			n := k.KillerDamage.Pct
			d.KillerDamagePct = &n
		}
		if k.AssistDamage.Known {
			n := k.AssistDamage.Pct
			d.AssistDamagePct = &n
		}
		if icon, ok := killicon.Lookup(k.Source.Tag); ok {
			d.WeaponKey = icon.WeaponKey
			if k.Source.Named {
				d.WeaponLabel = k.Source.Display
			}
		}
		details = append(details, d)
	}
	return details
}
