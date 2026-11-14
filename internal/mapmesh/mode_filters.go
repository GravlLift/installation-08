package mapmesh

// mode_filters.go: the `.mvar` mode labels a match's game mode activates, for the variant object
// layer (himap.FiltresMode). A variant object that carries `<mode>_include` exists only in that
// mode; one that carries `<mode>_exclude` does not exist in it. The mode is read from the match's
// game variant name ("Ranked:Slayer", "Ranked:CTF 5 Captures", ...) by the words the server's
// objective catalog uses (cmd/infinite-theater-3d/serve_objectives.go).

import (
	"regexp"
	"strings"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
	"github.com/JGtm/halo-infinite-map-images/himap"
)

var modeNameWords = regexp.MustCompile(`[^a-z0-9]+`)

// modeLabelStems: the words of a game variant name, and the label stems (`<stem>_include`,
// `<stem>_exclude`) its mode activates. King of the Hill has no stem: its include label is known
// only by its hash (mapvar.LabelHashHillInclude).
var modeLabelStems = []struct {
	words []string
	stems []string
	hill  bool
}{
	{words: []string{"ctf", "capture the flag", "neutral flag"}, stems: []string{"ctf"}},
	{words: []string{"neutral flag"}, stems: []string{"ctf_neutral"}},
	{words: []string{"strongholds"}, stems: []string{"strongholds"}},
	{words: []string{"oddball"}, stems: []string{"oddball"}},
	{words: []string{"king of the hill", "koth"}, hill: true},
	{words: []string{"land grab"}, stems: []string{"landgrab"}},
	{words: []string{"stockpile"}, stems: []string{"stockpile"}},
	{words: []string{"extraction"}, stems: []string{"extraction"}},
	{words: []string{"assault", "neutral bomb", "one bomb"}, stems: []string{"assault"}},
	{words: []string{"infection"}, stems: []string{"infection"}},
	{words: []string{"elimination"}, stems: []string{"elimination"}},
	{words: []string{"total control"}, stems: []string{"totalcontrol"}},
	{words: []string{"firefight"}, stems: []string{"firefight"}},
}

// ModeFilters returns the mode labels the game variant `mode` activates. A mode without
// objective objects (Slayer) or an unknown one activates none: the layer then holds no object
// that only exists in some mode.
func ModeFilters(mode string) himap.FiltresMode {
	name := " " + modeNameWords.ReplaceAllString(strings.ToLower(mode), " ") + " "
	f := himap.FiltresMode{Inclus: map[int32]bool{}, Exclus: map[int32]bool{}}
	for _, m := range modeLabelStems {
		if !hasAnyWord(name, m.words) {
			continue
		}
		for _, s := range m.stems {
			f.Inclus[mapvar.LabelHash(s+"_include")] = true
			f.Exclus[mapvar.LabelHash(s+"_exclude")] = true
		}
		if m.hill {
			f.Inclus[mapvar.LabelHashHillInclude] = true
		}
	}
	return f
}

// hasAnyWord reports whether the space-padded, normalized name holds one of the words.
func hasAnyWord(name string, words []string) bool {
	for _, w := range words {
		if strings.Contains(name, " "+w+" ") {
			return true
		}
	}
	return false
}
