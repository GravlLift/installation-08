// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weapons

// banners.go reads the team banner a weapon attaches to its model (the CTF flag's holographic
// cloth and team emblem, himap.BanniereEquipe) for the library index, and writes its images
// beside the models. A weapon without banner effects has no entry.

import (
	"context"
	"errors"
	"fmt"
	"image/png"
	"log/slog"
	"path/filepath"
	"regexp"

	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// Banner is one weapon's team banner in the library index.
type Banner struct {
	// Marker is where the banner's effects sit on the model: model space, glTF axes (the GLB's).
	Marker [3]float64 `json:"marker"`
	// Cloth is the banner's cloth quad (one image).
	Cloth BannerLayer `json:"cloth"`
	// Emblem is the emblem quad, its images by team index; nil when the banner has none.
	Emblem *BannerLayer `json:"emblem,omitempty"`
}

// BannerLayer is one quad of a banner (world units, glTF axes of the model). The quad stands in
// the plane of Across and the model's up axis.
type BannerLayer struct {
	Files  []string `json:"files"`
	Width  float64  `json:"width"`
	Height float64  `json:"height"`
	// Pivot is the anchor of the quad at its position, in the quad's normalized coordinates
	// [-0.5, 0.5] (x along Across, y up).
	Pivot [2]float64 `json:"pivot"`
	// Offset moves the quad's anchor from the marker.
	Offset [3]float64 `json:"offset"`
	// Across is the direction the quad's width runs along (the marker's +Y).
	Across [3]float64 `json:"across"`
	Alpha  float64    `json:"alpha"`
	// Additive: the particle adds light to the scene instead of covering it.
	Additive bool `json:"additive"`
}

// bannerFilePattern names a banner image of the library: banner-<key>-cloth.png or
// banner-<key>-emblem<rank>.png.
var bannerFilePattern = regexp.MustCompile(`^banner-[0-9a-f]{8}-(cloth|emblem[0-9]{1,2})\.png$`)

// BannerFile says whether name is a banner image of the library.
func BannerFile(name string) bool { return bannerFilePattern.MatchString(name) }

// readBanners reads the banner of every weapon key and writes its images into dir. The map is
// never nil; a weapon without a banner is left out.
func readBanners(ctx context.Context, a *himap.Arsenal, gameRoot, module, dir string, keys []string) (map[string]Banner, error) {
	paths, err := himap.GeometrySearchPathMonde(gameRoot, module)
	if err != nil {
		return nil, err
	}
	ix, err := himap.NewModuleIndex(paths...)
	if err != nil {
		return nil, fmt.Errorf("weapon tag index: %w", err)
	}
	defer func() {
		if err := ix.Close(); err != nil {
			slog.WarnContext(ctx, "closing weapon tag index", "err", err)
		}
	}()
	out := map[string]Banner{}
	for _, key := range keys {
		b, ok, err := bannerOfKey(a, ix, key, dir)
		if err != nil {
			return nil, fmt.Errorf("banner of %s: %w", key, err)
		}
		if ok {
			out[key] = b
		}
	}
	slog.InfoContext(ctx, "team banners read", "weapons", len(keys), "with_banner", len(out))
	return out, nil
}

// bannerOfKey reads one weapon's banner and writes its images; false when it has none.
func bannerOfKey(a *himap.Arsenal, ix *himap.ModuleIndex, key, dir string) (Banner, bool, error) {
	id, err := parseKey(key)
	if err != nil {
		return Banner{}, false, err
	}
	raw, err := ix.Extract(id)
	if err != nil {
		return Banner{}, false, nil
	}
	atts, err := weaponicons.ReadEffectAttachments(raw)
	if err != nil {
		slog.Warn("weapon attachments unreadable", "weapon", key, "err", err)
		return Banner{}, false, nil
	}
	if len(atts) == 0 {
		return Banner{}, false, nil
	}
	attaches := make([]himap.AttacheEffet, 0, len(atts))
	for _, at := range atts {
		attaches = append(attaches, himap.AttacheEffet{Effet: at.Effect, Marqueur: at.Marker})
	}
	hb, err := a.BanniereEquipe(id, attaches)
	if err != nil {
		if !errors.Is(err, himap.ErrSansBanniere) {
			slog.Warn("weapon banner unreadable", "weapon", key, "err", err)
		}
		return Banner{}, false, nil
	}
	b := Banner{Marker: gltfOf(hb.Marqueur)}
	cloth := "banner-" + key + "-cloth.png"
	if err := writePNG(dir, cloth, hb.ImageTissu); err != nil {
		return Banner{}, false, err
	}
	b.Cloth = layerOf(hb.Tissu, []string{cloth})
	if len(hb.Emblemes) > 0 {
		files := make([]string, 0, len(hb.Emblemes))
		for k, img := range hb.Emblemes {
			name := fmt.Sprintf("banner-%s-emblem%d.png", key, k)
			if err := writePNG(dir, name, img); err != nil {
				return Banner{}, false, err
			}
			files = append(files, name)
		}
		e := layerOf(hb.Embleme, files)
		b.Emblem = &e
	}
	return b, true, nil
}

// haloAcross is the marker's +Y, the direction a banner quad's width runs along (Halo axes).
var haloAcross = [3]float64{0, 1, 0}

func layerOf(c himap.CoucheBanniere, files []string) BannerLayer {
	return BannerLayer{
		Files: files, Width: roundRange(c.Largeur), Height: roundRange(c.Hauteur),
		Pivot:  [2]float64{roundRange(c.Pivot[0]), roundRange(c.Pivot[1])},
		Offset: gltfOf(c.Decalage), Across: gltfOf(haloAcross),
		Alpha: roundRange(c.Alpha), Additive: c.Additif,
	}
}

// gltfOf turns a Halo-axes vector into the GLB's axes (axesGLB), rounded like the other read
// values (adding 0 turns a negated zero into 0).
func gltfOf(v [3]float64) [3]float64 {
	return [3]float64{roundRange(v[0]), roundRange(v[2]), roundRange(-v[1]) + 0}
}

// writePNG writes a decoded texture as dir/name, atomically.
func writePNG(dir, name string, t himap.Texture) error {
	_, err := writeFile(filepath.Join(dir, name), func(w ioWriter) error { return png.Encode(w, t.Image) })
	return err
}
