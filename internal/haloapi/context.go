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

func (c *Client) MapModePair(ctx context.Context, id, version string) ([]byte, error) {
	if id == "" || version == "" {
		return nil, nil
	}
	var v any
	return c.json(ctx, c.endpoints.Discovery+"/mapModePairs/"+segment(id)+"/versions/"+segment(version), &v)
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

// mapImageRank ranks a map image path for selection: the full-screen backdrop wants the
// largest image, so a path naming "hero" wins, then "screenshot", then any other image, and
// "thumbnail" is last (it is still chosen when it is the only image). Non-image files rank
// below zero so they are never selected.
func mapImageRank(p string) int {
	s := strings.ToLower(p)
	if !(strings.HasSuffix(s, ".png") || strings.HasSuffix(s, ".jpg") || strings.HasSuffix(s, ".jpeg") || strings.HasSuffix(s, ".webp")) {
		return -1
	}
	switch {
	case strings.Contains(s, "hero"):
		return 3
	case strings.Contains(s, "screenshot"):
		return 2
	case strings.Contains(s, "thumbnail"):
		return 0
	default:
		return 1
	}
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
	rank := -1
	for _, p := range v.Files.Paths {
		if r := mapImageRank(p); r > rank {
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
