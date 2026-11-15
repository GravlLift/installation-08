package build

import (
	"context"
	"fmt"

	"github.com/JGtm/halo-infinite-film-decoder/damagetag"
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
	// KillfeedSprite is the stem of the game's kill feed atlas sprite for the damage
	// source (`killfeed-NN`, served as killfeed-NN.png from the weapon icon set). It is
	// set for weapons and also for the sources the weapon registry does not name (melee,
	// the spike grenade, splatter, falls), which carry no WeaponKey.
	KillfeedSprite string `json:"killfeed_sprite,omitempty"`
}

// environmentSprite is the kill feed atlas sprite the extraction named `environment`
// (index.json). upstream killicon/neutral.go uses it for DEGAT_GLOBAL deaths
// (labels.tsv qualifies that class as "fall, environment").
var environmentSprite = killicon.NeutralSprites()[killicon.NeutralKindEnvironment]

// killSprite picks the kill feed sprite of a kill's damage source, in the order of
// specificity: the killicon bridge (weapons, grenades, vehicles, turrets, coils, melee),
// then the collision category (splatter, which no damage tag names), then the
// DEGAT_GLOBAL class (fall, environment). Anything else gets no sprite: a guessed icon
// would be a wrong claim about what killed the player.
func killSprite(k decfilm.Kill) (killicon.Icon, bool) {
	if icon, ok := killicon.Lookup(k.Source.Tag); ok {
		return icon, true
	}
	if k.Source.Category == decfilm.CategoryCollisionDamage {
		return killicon.Splatter(), true
	}
	if k.Source.Class == damagetag.ClassGlobal && environmentSprite != "" {
		return killicon.Icon{Sprite: environmentSprite, Genre: killicon.GenreClasse}, true
	}
	return killicon.Icon{}, false
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
		if icon, ok := killSprite(k); ok {
			d.WeaponKey = icon.WeaponKey
			d.KillfeedSprite = icon.Sprite
			if k.Source.Named {
				d.WeaponLabel = k.Source.Display
			}
		}
		details = append(details, d)
	}
	return details
}

// DecodeKillDetails decodes only the kill feed of a stored film and returns its kill
// details: the part of Build that kill-details.json needs, without assembling the replay
// document. It serves the refresh of a kill-details.json written before a field existed.
func DecodeKillDetails(ctx context.Context, in Input) ([]KillDetail, error) {
	entry, err := resolveMapEntry(in)
	if err != nil {
		return nil, err
	}
	matchID := resolveMatchID(in)
	film, _ := loadFilm(ctx, in, matchID)
	if film == nil {
		return nil, fmt.Errorf("%w: %s", ErrUnreadable, in.ChunkDir)
	}
	res := decodeKills(ctx, matchID, film, entry)
	if res == nil {
		return nil, fmt.Errorf("kill feed of %s not decoded", matchID)
	}
	return killDetails(res, scanDeaths(ctx, matchID, film)), nil
}
