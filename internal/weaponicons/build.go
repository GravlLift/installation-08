// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// build.go — the build entry point: index the archives, resolve the weapon-to-icon link,
// crack the names, decode every atlas image, and write the PNG set plus index.json.

package weaponicons

import (
	"context"
	"encoding/json"
	"fmt"
	"image"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// atlasTag is one icon atlas bitmap and the file stem its icons are written under.
type atlasTag struct {
	ID    uint32
	Style string
}

// atlasTags: the icon atlases and their file stems. The two weapon bitmaps are the same
// icon set rendered two ways (same count, same dimensions index by index); the sandbox
// atlas is the kill feed's (weapons seen from far, vehicles, grenades, death pictograms).
var atlasTags = []atlasTag{
	{0xbc17adf1, "contour"},
	{0xe39747c8, "silhouette"},
	{sandboxAtlasTag, "killfeed"},
}

// atlasLimit is the number of images to extract per atlas (the declared count of the
// largest atlas is well below it).
const atlasLimit = 120

// OutDir is the icon set's folder below the data directory.
func OutDir(dataDir string) string {
	return filepath.Join(dataDir, "assets", "weapons-icons", "halo_infinite", "jeu")
}

// SetReady says whether the icon set is built: index.json is present in the output folder
// and the set was decoded by the current decoder (DecoderStampCurrent).
func SetReady(dataDir string) bool {
	_, err := os.Stat(filepath.Join(OutDir(dataDir), "index.json"))
	return err == nil && DecoderStampCurrent(OutDir(dataDir))
}

// iconEntry describes one extracted icon, as written in index.json.
type iconEntry struct {
	Index          int      `json:"index"`
	Style          string   `json:"style"`
	File           string   `json:"file"`
	GameName       string   `json:"nom_jeu,omitempty"` // the game's INTERNAL name, cracked (names.go)
	NameUnverified bool     `json:"nom_a_verifier,omitempty"`
	WeaponKey      string   `json:"arme,omitempty"`      // the registry weapon key; the field is named `arme` because a scanner reads `key` + an entropic string as a secret
	WeapTags       []string `json:"tags_weap,omitempty"` // the tags that claim this index (the high 32 bits of a filmshell weapon id)
	SourceTag      string   `json:"source_tag"`
	SourceW        int      `json:"source_w"`
	SourceH        int      `json:"source_h"`
	CroppedW       int      `json:"cropped_w"`
	CroppedH       int      `json:"cropped_h"`
	BC7Format      int      `json:"bc7_format"`
	Noise          string   `json:"alpha_noise"`
}

// Build decodes every icon atlas of the install at gameRoot (empty auto-detects it the
// way the other builds always do) and writes the PNG set and index.json into
// OutDir(dataDir). It returns the number of entries written and the total byte count of
// the files it wrote.
func Build(ctx context.Context, gameRoot, dataDir string) (entries, bytes int, err error) {
	root := moduleRoot(gameRoot)
	if root == "" {
		return 0, 0, fmt.Errorf("game install not found: pass --game or set %s", himap.DeployRootEnv)
	}
	out := OutDir(dataDir)
	if err := os.MkdirAll(out, 0o750); err != nil {
		return 0, 0, fmt.Errorf("create output folder: %w", err)
	}
	slog.InfoContext(ctx, "weapon icon build", "archives", root, "out", out)

	ix := buildIndex("")
	slog.InfoContext(ctx, "module index built", "archives", ix.nMods, "entries", ix.nEntry)

	icons, err := resolveWeaponIcons(ix)
	if err != nil {
		return 0, 0, fmt.Errorf("resolve weapon to icon: %w", err)
	}
	keyByIndex := make(map[int]string, len(icons))
	for _, w := range icons {
		keyByIndex[w.Index] = w.Key
	}
	// The families without an icon are the grenades: they are not `weap` tags (they live
	// in `eqip` + `proj`, declared by the globals tag) and have no `UI display info`
	// block. Expected, not a failure.
	slog.InfoContext(ctx, "weapons resolved", "resolved", len(icons), "families", len(weaponFamilies()))

	indexOwned := make(map[int]bool, len(icons))
	for _, w := range icons {
		indexOwned[w.Index] = true
	}
	canon := make(map[uint32]bool, len(weaponFamilies()))
	for _, w := range weaponFamilies() {
		canon[w.ID] = true
	}
	names, err := resolveIconNames(ix, canon, indexOwned)
	if err != nil {
		return 0, 0, fmt.Errorf("icon names: %w", err)
	}
	slog.InfoContext(ctx, "names cracked", "weapon atlas", len(names))
	kfNames := resolveKillfeedNames(ix)
	slog.InfoContext(ctx, "kill feed names", "named", len(kfNames))
	tagsByIndex, err := weapTagsByIndex(ix)
	if err != nil {
		return 0, 0, fmt.Errorf("tags by index: %w", err)
	}

	all, total, err := writeAtlas(ctx, ix, out, keyByIndex, names, kfNames, tagsByIndex)
	if err != nil {
		return 0, 0, err
	}
	if err := writeIndex(out, all); err != nil {
		return 0, 0, err
	}
	if fi, err := os.Stat(filepath.Join(out, "index.json")); err == nil {
		total += int(fi.Size())
	}
	if err := WriteDecoderStamp(out); err != nil {
		return 0, 0, err
	}
	slog.InfoContext(ctx, "weapon icon set built", "entries", len(all), "bytes", total, "out", out)
	return len(all), total, nil
}

// writeAtlas decodes and writes one icon file per image for every atlas. It returns the
// entry list and the byte count of the PNG files written.
func writeAtlas(ctx context.Context, ix *tagIndex, out string, keyByIndex map[int]string,
	names map[int][]string, kfNames map[int]string, tagsByIndex map[int][]string,
) ([]iconEntry, int, error) {
	var all []iconEntry
	total := 0
	for _, at := range atlasTags {
		n := 0
		for idx := 0; idx < atlasLimit; idx++ {
			img, im, err := decodeAlphaGlyph(ix, at.ID, idx)
			if err != nil {
				slog.InfoContext(ctx, "atlas stops", "style", at.Style, "index", idx, "err", err)
				break
			}
			if err := ctx.Err(); err != nil {
				return nil, 0, err
			}
			name := fmt.Sprintf("%s-%02d.png", at.Style, idx)
			if err := writePNG(filepath.Join(out, name), img); err != nil {
				return nil, 0, fmt.Errorf("write %s: %w", name, err)
			}
			fi, err := os.Stat(filepath.Join(out, name))
			if err != nil {
				return nil, 0, err
			}
			total += int(fi.Size())
			all = append(all, entryFor(at, name, keyByIndex, names, kfNames, tagsByIndex, img, im, idx))
			n++
		}
		slog.InfoContext(ctx, "atlas written", "style", at.Style, "icons", n)
	}
	return all, total, nil
}

// entryFor fills the index.json entry of one icon.
func entryFor(at atlasTag, name string, keyByIndex map[int]string,
	names map[int][]string, kfNames map[int]string, tagsByIndex map[int][]string,
	img *image.NRGBA, im bitmImg, idx int,
) iconEntry {
	// The weapon key only applies to the two weapon atlases: the sandbox atlas has its
	// own numbering, unrelated to `sprite index`.
	key, gameName := "", ""
	unverified := false
	switch at.ID {
	case 0xbc17adf1, 0xe39747c8:
		key = keyByIndex[idx]
		// Several names = several `weap` claim the index (campaign variants with stale
		// indices). All are published: arbitrating would give a false label with the look
		// of a certainty. The `?` marker sorts into its own field so the value stays clean
		// and the doubt stays visible.
		parts := make([]string, 0, len(names[idx]))
		for _, nm := range names[idx] {
			if strings.HasPrefix(nm, "?") {
				nm = nm[1:]
				unverified = true
			}
			parts = append(parts, nm)
		}
		gameName = strings.Join(parts, " | ")
	case sandboxAtlasTag:
		gameName = kfNames[idx]
	}
	return iconEntry{
		Index: idx, Style: at.Style, File: name, WeaponKey: key,
		WeapTags: tagsByIndex[idx],
		GameName: gameName, NameUnverified: unverified,
		SourceTag: fmt.Sprintf("%08x", at.ID),
		SourceW:   im.W, SourceH: im.H,
		CroppedW: img.Bounds().Dx(), CroppedH: img.Bounds().Dy(),
		BC7Format: im.Format,
		Noise:     fmt.Sprintf("%.4f", alphaNoise(img)),
	}
}

// WeaponKeyContourFile maps a weapon key to its contour icon file through the built
// index.json (the `arme` field of the contour-style entries). It returns an empty map
// when the set is not built yet: a kill without an icon falls back to its label, as
// LevelUp does.
func WeaponKeyContourFile(dataDir string) (map[string]string, error) {
	raw, err := os.ReadFile(filepath.Join(OutDir(dataDir), "index.json"))
	if err != nil {
		return nil, err
	}
	var entries []iconEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, e := range entries {
		if e.Style == "contour" && e.WeaponKey != "" {
			out[e.WeaponKey] = e.File
		}
		if e.Style == "contour" {
			for _, tag := range e.WeapTags {
				for _, family := range weaponFamilyTable {
					if tag == fmt.Sprintf("%08x", family.ID) {
						out[family.Key] = e.File
					}
				}
			}
		}
	}
	return out, nil
}

// KillfeedFiles lists the kill feed atlas sprites of the built set: stem (`killfeed-NN`,
// the name the killicon bridge gives) -> file. Unlike contour and silhouette, these
// sprites already point toward the victim, as the game draws them. A set that is not
// built yet is an error and the caller falls back to no icon.
func KillfeedFiles(dataDir string) (map[string]string, error) {
	raw, err := os.ReadFile(filepath.Join(OutDir(dataDir), "index.json"))
	if err != nil {
		return nil, err
	}
	var entries []iconEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, e := range entries {
		if e.Style == "killfeed" && strings.HasSuffix(e.File, ".png") {
			out[strings.TrimSuffix(e.File, ".png")] = e.File
		}
	}
	return out, nil
}

// writeIndex sorts the entries and writes index.json next to the PNGs.
func writeIndex(out string, entries []iconEntry) error {
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Index != entries[j].Index {
			return entries[i].Index < entries[j].Index
		}
		return entries[i].Style < entries[j].Style
	})
	blob, err := json.MarshalIndent(entries, "", " ")
	if err != nil {
		return fmt.Errorf("index.json: %w", err)
	}
	return os.WriteFile(filepath.Join(out, "index.json"), append(blob, '\n'), 0o600)
}

// pct renders a percentage, or "0.00" for a zero denominator.
func pct(n, total int) string {
	if total <= 0 {
		return "0.00"
	}
	return fmt.Sprintf("%.2f", 100*float64(n)/float64(total))
}
