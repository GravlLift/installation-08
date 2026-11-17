// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg" // register the jpeg decoder so image.DecodeConfig can size stored .jpg files
	"image/png"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

type contextCatalog struct {
	Medals []struct {
		ID     int64 `json:"nameId"`
		Sprite int   `json:"spriteIndex"`
	} `json:"Medals"`
}

func fetchContextArtifacts(ctx context.Context, root *store.Root, api *haloapi.Client, id string, raw []byte) error {
	var p struct {
		Info struct {
			Playlist struct {
				ID      string `json:"AssetId"`
				Version string `json:"VersionId"`
			} `json:"Playlist"`
			Pair struct {
				ID      string `json:"AssetId"`
				Version string `json:"VersionId"`
			} `json:"PlaylistMapModePair"`
			Map struct {
				ID      string `json:"AssetId"`
				Version string `json:"VersionId"`
			} `json:"MapVariant"`
		} `json:"MatchInfo"`
		Players []struct {
			ID string `json:"PlayerId"`
		} `json:"Players"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return err
	}
	var xuids []string
	for _, player := range p.Players {
		if strings.HasPrefix(player.ID, "xuid(") && strings.HasSuffix(player.ID, ")") {
			xuids = append(xuids, strings.TrimSuffix(strings.TrimPrefix(player.ID, "xuid("), ")"))
		}
	}
	skill, err := api.Skill(ctx, id, xuids)
	if err != nil {
		slog.Warn("match skill unavailable", "id", id, "err", err)
	}
	if len(skill) > 0 {
		if err = root.WriteFile(variantPath(root, id, "skill.json"), skill); err != nil {
			return err
		}
	}
	playlist, err := api.Playlist(ctx, p.Info.Playlist.ID, p.Info.Playlist.Version)
	if err != nil {
		slog.Warn("playlist unavailable", "id", id, "err", err)
	}
	if len(playlist) > 0 {
		if err = root.WriteFile(variantPath(root, id, "playlist.json"), playlist); err != nil {
			return err
		}
	}
	pair, err := api.MapModePair(ctx, p.Info.Pair.ID, p.Info.Pair.Version)
	if err != nil {
		slog.Warn("map mode pair unavailable", "id", id, "err", err)
	}
	if len(pair) > 0 {
		if err = root.WriteFile(variantPath(root, id, "map-mode-pair.json"), pair); err != nil {
			return err
		}
	}
	if err = fetchMedalAssets(ctx, root, api); err != nil {
		slog.Warn("medal assets unavailable", "id", id, "err", err)
	}
	if p.Info.Map.ID != "" && store.ModuleKeyValid(p.Info.Map.ID) {
		fetchMapImage(ctx, root, api, p.Info.Map.ID, p.Info.Map.Version)
	}
	return nil
}

// minimumMapImageWidth is the pixel width below which a stored map image is a thumbnail that
// must be re-downloaded: the full-screen backdrop needs at least this much to be legible.
const minimumMapImageWidth = 1000

var (
	mapImageMu     sync.Mutex
	smallMapImages = map[string]bool{} // asset ids whose image is small; not re-downloaded this run
)

// mapImageWidth reports a stored image's pixel width, reading only its header (png and jpeg
// are the registered decoders). A file that cannot be decoded reports ok=false.
func mapImageWidth(raw []byte) (int, bool) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return 0, false
	}
	return cfg.Width, true
}

// mapImageExt is the file extension matching the image's decoded format (jpeg becomes "jpg"),
// defaulting to "png" when the bytes do not decode to a registered format.
func mapImageExt(raw []byte) string {
	_, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return "png"
	}
	if format == "jpeg" {
		return "jpg"
	}
	return format
}

// fetchMapImage stores a map's image so the backdrop shows the real image, not a thumbnail. A
// stored image that is missing, undecodable, or under minimumMapImageWidth wide is downloaded
// and replaced; the replaced file is removed only after the new one is written. A download that
// fails or yields nothing keeps the existing file, and an asset whose image comes back small is
// kept but not retried again in the same process run.
func fetchMapImage(ctx context.Context, root *store.Root, api *haloapi.Client, assetID, version string) {
	dir := filepath.Join(root.Dir(), "static", "maps", "halo_infinite")
	var existing []byte
	var existingPath string
	for _, name := range []string{assetID + ".png", assetID + ".jpg"} {
		p := filepath.Join(dir, name)
		if b, err := os.ReadFile(p); err == nil {
			existing, existingPath = b, p
			break
		}
	}
	mapImageMu.Lock()
	skip := smallMapImages[assetID]
	mapImageMu.Unlock()
	if skip {
		return
	}
	need := len(existing) == 0
	if !need {
		w, ok := mapImageWidth(existing)
		need = !ok || w < minimumMapImageWidth
	}
	if !need {
		return
	}
	img, err := api.MapImage(ctx, assetID, version)
	if err != nil {
		slog.Warn("map image download failed", "id", assetID, "err", err)
		return
	}
	if len(img) == 0 {
		slog.Warn("map image download empty", "id", assetID)
		return
	}
	target := filepath.Join(dir, assetID+"."+mapImageExt(img))
	if err := root.WriteFile(target, img); err != nil {
		slog.Warn("map image write failed", "id", assetID, "err", err)
		return
	}
	if existingPath != "" && existingPath != target {
		if err := os.Remove(existingPath); err != nil && !os.IsNotExist(err) {
			slog.Warn("map image remove failed", "id", assetID, "err", err)
		}
	}
	if w, ok := mapImageWidth(img); !ok || w < minimumMapImageWidth {
		mapImageMu.Lock()
		smallMapImages[assetID] = true
		mapImageMu.Unlock()
	}
}
func fetchMedalAssets(ctx context.Context, root *store.Root, api *haloapi.Client) error {
	catalogPath := filepath.Join(root.Dir(), "medals", "metadata.json")
	raw, err := os.ReadFile(catalogPath)
	if os.IsNotExist(err) {
		raw, err = api.MedalCatalog(ctx)
		if err != nil {
			return err
		}
		if len(raw) == 0 {
			return nil
		}
	} else if err != nil {
		return err
	}
	var catalog contextCatalog
	if err = json.Unmarshal(raw, &catalog); err != nil {
		return err
	}
	missing := false
	for _, m := range catalog.Medals {
		if m.ID > 0 && m.Sprite >= 0 {
			target := filepath.Join(root.Dir(), "static", "medals", "halo_infinite", fmt.Sprintf("%d.png", m.ID))
			if _, e := os.Stat(target); os.IsNotExist(e) {
				missing = true
			} else if e != nil {
				return e
			}
		}
	}
	if !missing {
		return root.WriteFile(catalogPath, raw)
	}
	sheet, err := api.MedalSheet(ctx)
	if err != nil {
		return err
	}
	if len(sheet) == 0 {
		return nil
	}
	img, err := png.Decode(bytes.NewReader(sheet))
	if err != nil {
		return err
	}
	columns := img.Bounds().Dx() / 256
	if columns == 0 {
		return fmt.Errorf("invalid medal sheet")
	}
	for _, m := range catalog.Medals {
		if m.ID <= 0 || m.Sprite < 0 {
			continue
		}
		target := filepath.Join(root.Dir(), "static", "medals", "halo_infinite", fmt.Sprintf("%d.png", m.ID))
		if _, err = os.Stat(target); err == nil {
			continue
		} else if !os.IsNotExist(err) {
			return err
		}
		x, y := m.Sprite%columns*256, m.Sprite/columns*256
		rect := image.Rect(x, y, x+256, y+256)
		if !rect.In(img.Bounds()) {
			continue
		}
		var b bytes.Buffer
		if err = png.Encode(&b, img.(interface {
			SubImage(image.Rectangle) image.Image
		}).SubImage(rect)); err != nil {
			return err
		}
		if err = root.WriteFile(target, b.Bytes()); err != nil {
			return err
		}
	}
	return root.WriteFile(catalogPath, raw)
}
