package haloapi

import (
	"context"
	"errors"
	"net/url"
	"strings"
)

func (c *Client) Skill(ctx context.Context, id string, xuids []string) ([]byte, error) {
	if c.endpoints.Skill == "" || len(xuids) == 0 {
		return nil, nil
	}
	q := url.Values{}
	for _, x := range xuids {
		if x != "" && strings.Trim(x, "0123456789") == "" {
			q.Add("players", "xuid("+x+")")
		}
	}
	if len(q) == 0 {
		return nil, nil
	}
	var v any
	return c.json(ctx, c.endpoints.Skill+"/matches/"+segment(id)+"/skill?"+q.Encode(), &v)
}
func (c *Client) Playlist(ctx context.Context, id, version string) ([]byte, error) {
	if id == "" || version == "" {
		return nil, nil
	}
	var v any
	return c.json(ctx, c.endpoints.Discovery+"/playlists/"+segment(id)+"/versions/"+segment(version), &v)
}
func (c *Client) MedalCatalog(ctx context.Context) ([]byte, error) {
	if c.endpoints.GameCMS == "" {
		return nil, nil
	}
	var v any
	return c.json(ctx, c.endpoints.GameCMS+"/Waypoint/file/medals/metadata.json", &v)
}
func (c *Client) MedalSheet(ctx context.Context) ([]byte, error) {
	if c.endpoints.GameCMS == "" {
		return nil, nil
	}
	return c.get(ctx, c.endpoints.GameCMS+"/Waypoint/file/medals/images/medal_sheet_xl.png", true)
}
func (c *Client) MapImage(ctx context.Context, id, version string) ([]byte, error) {
	if id == "" {
		return nil, nil
	}
	endpoint := c.endpoints.Discovery + "/Maps/" + segment(id)
	if version != "" {
		endpoint += "/versions/" + segment(version)
	}
	var v struct {
		Files struct {
			Prefix string   `json:"Prefix"`
			Paths  []string `json:"FileRelativePaths"`
		} `json:"Files"`
	}
	if _, err := c.json(ctx, endpoint, &v); err != nil {
		return nil, err
	}
	selected := ""
	rank := 0
	for _, p := range v.Files.Paths {
		s := strings.ToLower(p)
		if !(strings.HasSuffix(s, ".png") || strings.HasSuffix(s, ".jpg") || strings.HasSuffix(s, ".jpeg") || strings.HasSuffix(s, ".webp")) {
			continue
		}
		r := 1
		if strings.Contains(s, "hero") || strings.Contains(s, "screenshot") {
			r = 2
		}
		if strings.Contains(s, "thumbnail") {
			r = 3
		}
		if r > rank {
			selected, rank = p, r
		}
	}
	if selected == "" || v.Files.Prefix == "" {
		return nil, nil
	}
	raw, err := c.get(ctx, blobURL(v.Files.Prefix, selected), false)
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return nil, errors.New("empty map image")
	}
	return raw, nil
}
