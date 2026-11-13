package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"

	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

type contextCatalog struct {
	Medals []struct {
		ID     int64 `json:"NameId"`
		Sprite int   `json:"SpriteIndex"`
	} `json:"Medals"`
}

func fetchContextArtifacts(ctx context.Context, root *store.Root, api *haloapi.Client, id string, raw []byte) error {
	var p struct {
		Info struct {
			Playlist struct {
				ID      string `json:"AssetId"`
				Version string `json:"VersionId"`
			} `json:"Playlist"`
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
		return err
	}
	if len(skill) > 0 {
		if err = root.WriteFile(variantPath(root, id, "skill.json"), skill); err != nil {
			return err
		}
	}
	playlist, err := api.Playlist(ctx, p.Info.Playlist.ID, p.Info.Playlist.Version)
	if err != nil {
		return err
	}
	if len(playlist) > 0 {
		if err = root.WriteFile(variantPath(root, id, "playlist.json"), playlist); err != nil {
			return err
		}
	}
	if err = fetchMedalAssets(ctx, root, api); err != nil {
		return err
	}
	if p.Info.Map.ID != "" && store.ModuleKeyValid(p.Info.Map.ID) {
		target := filepath.Join(root.Dir(), "static", "maps", "halo_infinite", p.Info.Map.ID+".png")
		if _, err = os.Stat(target); os.IsNotExist(err) {
			img, e := api.MapImage(ctx, p.Info.Map.ID, p.Info.Map.Version)
			if e != nil {
				return e
			}
			if len(img) > 0 {
				if e = root.WriteFile(target, img); e != nil {
					return e
				}
			}
		} else if err != nil {
			return err
		}
	}
	return nil
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
