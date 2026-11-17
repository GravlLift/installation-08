// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// names.go — THE INTERNAL NAME OF EACH ICON, cracked and not guessed.
//
// THE PROBLEM. The `UI display info` block carries a `name` field, but it is not a
// string: it is a StringID, a murmur3. Release tags do ship a string table — except it
// only contains (index, hash) pairs: the texts are stripped. The name is not readable, it
// is hashed.
//
// THE RECIPE, ALREADY VALIDATED ELSEWHERE IN THE REPOSITORY. The Forge object names were
// cracked the same way: harvest the printable strings of the game binary, hash them, and
// see which ones land on the StringIDs sought. The hash function is not re-invented here:
// it is `mapvar.LabelHash` (murmur3 x86_32, seed 0), established by direct correspondence
// and covered by tests.
//
// WHAT IT RETURNS, AND WHAT IT DOES NOT. An INTERNAL name (`assault_rifle`, `skull`,
// `flag`, `mutilator`), not a product label. The internal name identifies an icon, which
// is precisely the open question for everything that is not in the registry.
//
// CONFLICTS ARE PUBLISHED, NOT ARBITRATED. Several `weap` can claim the same index with
// different names (campaign variants carry stale indices). When that happens all the names
// are returned: cutting arbitrarily would give a false label with the look of a
// certainty.

package weaponicons

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

// gameBinary returns the game's binary, that is the LARGEST of the candidates: the file at
// the install root is a 3.9 MiB launcher, the real binary lives under `game/` and weighs
// 80 MiB. Taking the first found gives 0 cracked names — measured.
func gameBinary() string {
	root := moduleRoot("")
	if root == "" {
		return ""
	}
	base := filepath.Dir(root)
	var best string
	var bestSize int64
	for _, c := range []string{
		filepath.Join(base, "game", "HaloInfinite.exe"),
		filepath.Join(base, "HaloInfinite.exe"),
	} {
		if fi, err := os.Stat(c); err == nil && !fi.IsDir() && fi.Size() > bestSize {
			best, bestSize = c, fi.Size()
		}
	}
	return best
}

// harvestStrings harvests the runs of printable ASCII of at least minLen characters.
func harvestStrings(path string, minLen int) (map[string]bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	out := make(map[string]bool, 1<<19)
	r := bufio.NewReaderSize(f, 1<<20)
	cur := make([]byte, 0, 256)
	flush := func() {
		if len(cur) >= minLen {
			out[string(cur)] = true
		}
		cur = cur[:0]
	}
	buf := make([]byte, 1<<16)
	for {
		n, rerr := r.Read(buf)
		for i := 0; i < n; i++ {
			if b := buf[i]; b >= 0x20 && b < 0x7f {
				cur = append(cur, b)
				continue
			}
			flush()
		}
		if rerr != nil {
			break
		}
	}
	flush()
	return out, nil
}

// nameVariants: derived forms of a harvested string. The game often hashes a fragment
// (last segment of a path, extension removed, lowercased) rather than the whole string.
func nameVariants(s string) []string {
	v := []string{s, strings.ToLower(s)}
	if i := strings.LastIndexAny(s, "/\\"); i >= 0 && i+1 < len(s) {
		v = append(v, s[i+1:], strings.ToLower(s[i+1:]))
	}
	if i := strings.LastIndex(s, "."); i > 0 {
		v = append(v, s[:i], strings.ToLower(s[:i]))
	}
	return v
}

// resolveIconNames returns, per atlas index, the cracked internal names — sorted and
// deduplicated.
//
// `canon` is the set of `weap` the registry uses. It serves as a PRIORITY FILTER and it
// is not cosmetic: campaign tags carry STALE atlas indices, and their name — for them
// only — was landing on another weapon's icon. Measured: index 7 was called "shotgun" by
// a legacy tag while the registry reads the Hydra there, and index 5 received "needler" on
// top of "sniper_rifle". When a canonical tag names an index, only it counts; otherwise
// take what there is, conflicts published.
//
// Returns an empty map (and no error) when the game binary is not found: the name is a
// bonus, its absence must not fail the image extraction.
func resolveIconNames(ix *tagIndex, canon map[uint32]bool, owned map[int]bool) (map[int][]string, error) {
	fields, err := loadWeapPlugin()
	if err != nil {
		return nil, err
	}
	offSprite, offIndex, offName, ok := uiBlockOffsets(fields)
	if !ok || offName < 0 {
		return nil, fmt.Errorf("`name` / `sprite index` fields absent from the plugin")
	}
	exe := gameBinary()
	if exe == "" {
		return map[int][]string{}, nil
	}
	strs, err := harvestStrings(exe, 3)
	if err != nil {
		return map[int][]string{}, nil // the name is a bonus, not a requirement
	}
	dict := make(map[uint32]string, len(strs)*2)
	// The curated vocabulary fills what the harvest does not return: the binary does not
	// contain "fusion_coil" or "sandwich" as a standalone token.
	for _, w := range curatedVocabulary {
		if h := uint32(mapvar.LabelHash(w)); dict[h] == "" {
			dict[h] = w
		}
	}
	for s := range strs {
		for _, v := range nameVariants(s) {
			h := uint32(mapvar.LabelHash(v))
			if _, dup := dict[h]; !dup {
				dict[h] = v
			}
		}
	}

	byIndex := map[int]map[string]bool{}
	canonNamed := map[int]bool{} // index named by a canonical tag
	seen := map[uint32]bool{}
	for _, r := range ix.byGroup["weap"] {
		if seen[r.ID] {
			continue
		}
		seen[r.ID] = true
		data, err := ix.extract(r)
		if err != nil {
			continue
		}
		wt, err := openWeapTag(data)
		if err != nil {
			continue
		}
		abs, _, _, found := findUIBlock(wt, data, offSprite)
		if !found || abs+offName+4 > len(data) {
			continue
		}
		sid := readU32LE(data, abs+offName)
		name, hit := dict[sid]
		if hit && !plausibleIdent(name) {
			hit = false // collision: a game name is spelled [a-z0-9_]+
		}
		if !hit {
			continue
		}
		idx := int(readU32LE(data, abs+offIndex))
		isCanon := canon[r.ID]
		if !isCanon {
			// PROVENANCE, and it changes everything. A name from a NON-canonical `weap` is
			// only reliable if its index is — but campaign tags carry STALE indices.
			// Documented case: index 31 was called `shade_turret` while the image is a
			// crate. The name is kept but MARKED, never served as a fact.
			name = "?" + name
		}
		// An index the registry CLAIMS only accepts the name of a canonical tag, even if
		// no canonical cracked: otherwise a legacy tag would baptize index 7 "shotgun"
		// where the registry reads the Hydra.
		if owned[idx] && !isCanon {
			continue
		}
		if canonNamed[idx] && !isCanon {
			continue // a canonical tag already named this index: the others stay silent
		}
		if isCanon && !canonNamed[idx] {
			canonNamed[idx] = true
			delete(byIndex, idx) // set aside what the non-canonical tags had deposited
		}
		if byIndex[idx] == nil {
			byIndex[idx] = map[string]bool{}
		}
		byIndex[idx][name] = true
	}

	out := make(map[int][]string, len(byIndex))
	for idx, set := range byIndex {
		names := make([]string, 0, len(set))
		for n := range set {
			names = append(names, n)
		}
		sort.Strings(names)
		out[idx] = names
	}
	return out, nil
}
