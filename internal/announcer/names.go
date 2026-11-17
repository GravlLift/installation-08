// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package announcer

import (
	"regexp"
	"strings"
)

// The dialogue tag names its vocalizations by string id only, so the names below are the ones
// matched against those ids (StringID) on the installed game; a 32-bit id leaves room for a
// chance match, so the lines were sampled by transcription of the decoded audio (every objective,
// time, score and the main mode names said what their name says). They are the lines the viewer
// schedules (web:
// announcerVoice.ts maps its calls onto them). The game ships a second, chattier announcer (bank
// `sb_001_vo_ai_mp_announcerstacker`, names ending in "ally"/"enemy"): the owner hears it in the
// announcer's voice during matches, so it is the game's CTF and Assault objective chatter. The
// main bank has the "ours" capture and the flag returns; the stacker fills the rest (the enemy
// capture, the flag taken, the bomb), named `<subject><verb>ally`/`<subject><verb>enemy` where
// "ally"/"enemy" is the side from the listener's point of view.
var (
	// ModeNames are said when a match starts, one per game mode.
	ModeNames = []string{
		"slayer", "tacticalslayer", "bigslayer", "lonewolves", "strongholds", "tacticalstrongholds",
		"fiestastrongholds", "totalcontrol", "totalcontrolintro", "landgrab", "juggernaut", "vip",
		"elimination", "tacticalelimination", "fiestaelimination", "tacticalattrition", "fiestaattrition",
		"tacticaloddball", "race", "firefight", "ctfstart", "oneflagintro", "neutralflagintro",
		"kingofthehillintro", "swatintro", "stockpileintro", "extractionintro", "grifballintro",
	}
	// TimeNames are the remaining-time warnings ("Five minutes" ... "10 seconds"). The game also
	// has "60seconds", which says the same minute as "1minutes".
	TimeNames = []string{"5minutes", "2minutes", "1minutes", "30seconds", "10seconds"}
	// ScoreNames are the lead and overtime calls.
	ScoreNames = []string{"lostlead", "overtime"}
	// ObjectiveNames are the objective calls. The main bank covers the "ours" capture and the two
	// flag returns; the last five are the stacker bank's CTF and Assault lines it does not have
	// (the enemy capture, the flag taken on both sides, the bomb on both sides).
	ObjectiveNames = []string{
		"flagcaptured", "teamflagreturned", "enemyflagreturned", "strongholdcaptured",
		"strongholdlost", "hillcontrolled", "hillcontrolledenemy", "newvip",
		"flagcapturedenemy", "flagtakenally", "flagtakenenemy", "bombdetonatedally", "bombdetonatedenemy",
	}
)

// medalAliases are medals whose vocalization spells their name differently.
var medalAliases = map[string]string{"killamanjaro": "killimanjaro"}

// voiceName keeps the letters and digits of a name, lowercased: "Double Kill" -> "doublekill".
var voiceName = regexp.MustCompile(`[^a-z0-9]+`)

// MedalVoiceNames returns the vocalization names a medal can have, in order of preference: its
// name ("&" read "and"), then its name followed by "medal" (the game has both shapes for some
// medals, and only one for others).
func MedalVoiceNames(medal string) []string {
	base := voiceName.ReplaceAllString(strings.ReplaceAll(strings.ToLower(medal), "&", "and"), "")
	if alias, ok := medalAliases[base]; ok {
		base = alias
	}
	if base == "" {
		return nil
	}
	return []string{base, base + "medal"}
}

// CallNames is every name the viewer can schedule, for the given medal names.
func CallNames(medals []string) []string {
	var out []string
	for _, group := range [][]string{ModeNames, TimeNames, ScoreNames, ObjectiveNames} {
		out = append(out, group...)
	}
	for _, m := range medals {
		out = append(out, MedalVoiceNames(m)...)
	}
	return out
}

// ValidName reports whether a name is safe as a file name part: lowercase letters and digits.
func ValidName(name string) bool {
	return name != "" && !voiceName.MatchString(name)
}
