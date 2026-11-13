// assets.go — THE DAMAGE TAG CATALOGUE SERVES AS VOCABULARY.
//
// WHY THIS SOURCE, AND NO MORE. `damagetag` in the vendored film decoder carries, already
// versioned and already embedded, the INTERNAL ASSET NAME of each damage source:
// `sb_010_grn_un_lightninggrenade`, `sb_008_exp_single_small_hardlight`,
// `sb_010_veh_un_falcongrenadelauncher`. These are the game's words for the same objects
// the kill feed draws — and no harvest returned them, because they are neither in the
// binary nor in the commercial vocabulary.
//
// WHAT IT RETURNED. `killfeed_lightning_grenade` (index 48 — the Dynamo grenade is called
// "lightning grenade" internally, which is why `dynamo_grenade` failed) and
// `killfeed_gatling_mortar` (index 14). It also recovers
// `killfeed_falcon_grenade_launcher` INDEPENDENTLY, which serves as a control: the source
// and the human eye agree.
//
// THE TRANSFORMATION. The catalogue names are GLUED (`lightninggrenade`) where the kill
// feed SEPARATES (`lightning_grenade`). So every insertion of one or two underscores is
// generated, over the whole name and over each of its tails — the `sb_010_grn_un_` prefix
// is a classification, not a name. No dictionary heuristics: a few tens of thousands of
// forms, and only an exact equality comes out.

package weaponicons

import (
	"regexp"
	"strings"

	"github.com/JGtm/halo-infinite-film-decoder/damagetag"
)

var reAssetName = regexp.MustCompile(`[a-z][a-z0-9_]{4,}`)

const maxAssetTail = 28

// assetVocabulary returns the forms derived from the damage catalogue asset names.
func assetVocabulary() []string {
	names := map[string]bool{}
	for _, id := range damagetag.IDs() {
		l, ok := damagetag.Lookup(id)
		if !ok {
			continue
		}
		for _, champ := range []string{l.Detail, l.Name, l.Reserve} {
			for _, m := range reAssetName.FindAllString(strings.ToLower(champ), -1) {
				if strings.Contains(m, "_") {
					names[m] = true
				}
			}
		}
	}
	seen := map[string]bool{}
	var out []string
	for nom := range names {
		for _, q := range assetTails(nom) {
			if len(q) > maxAssetTail {
				continue
			}
			for _, v := range withUnderscores(q) {
				if !seen[v] {
					seen[v] = true
					out = append(out, v)
				}
			}
		}
	}
	return out
}

// assetTails returns the whole name then each of its tails after a `_`.
func assetTails(name string) []string {
	out := []string{name}
	parts := strings.Split(name, "_")
	for i := 1; i < len(parts); i++ {
		out = append(out, strings.Join(parts[i:], "_"))
	}
	return out
}

// withUnderscores returns s, then s with one underscore inserted at every position, then
// at every pair.
func withUnderscores(s string) []string {
	out := []string{s}
	for i := 1; i < len(s); i++ {
		a := s[:i] + "_" + s[i:]
		out = append(out, a)
		for j := i + 2; j < len(a); j++ {
			out = append(out, a[:j]+"_"+a[j:])
		}
	}
	return out
}
