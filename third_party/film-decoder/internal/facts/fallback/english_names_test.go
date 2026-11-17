// LOCAL-CHANGE (infinite-theater-3d): log and error strings translated to English.
package fallback

// english_names_test.go — AUCUN REPLI NE PEUT ATTEINDRE LE JOURNAL SANS NOM ANGLAIS.
//
// Parcourt [Table] (la meme liste que l'assemblage, pas une copie) et exige une entree dans
// `englishNames` (english_names.go) pour chaque [Repli.Nom]. Un nouveau repli pose sans son nom
// anglais rougit ICI, avant d'atteindre `replay/fallbacks_publication.go` en francais.

import "testing"

func TestEveryRegistryEntryHasAnEnglishName(t *testing.T) {
	for _, r := range Table() {
		if _, ok := EnglishName(r.Nom); !ok {
			t.Errorf("%s: no English name in englishNames (english_names.go) — add one", r.Nom)
		}
	}
}
