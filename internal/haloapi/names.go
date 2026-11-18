// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package haloapi

import (
	"context"
	"encoding/json"
	"sync"
)

// assetRef is how match history and match stats point at a map or a game mode: an asset
// id and version, never a name. The name comes from the discovery service.
type assetRef struct {
	ID      string `json:"AssetId"`
	Version string `json:"VersionId"`
	Name    string `json:"PublicName"`
}

// Discovery collections an assetRef can be looked up in.
const (
	kindMap  = "maps"
	kindMode = "ugcGameVariants"
)

// assetNames remembers every name already resolved in this process. A published asset
// version never changes, so an entry is never stale.
var assetNames sync.Map

// assetName returns the public name of one asset version, or "" when it has no id or the
// lookup fails: a missing name must never fail a match list or a fetch.
func (c *Client) assetName(ctx context.Context, kind string, ref assetRef) string {
	if ref.Name != "" || ref.ID == "" {
		return ref.Name
	}
	key := c.endpoints.Discovery + "|" + kind + "|" + ref.ID + "|" + ref.Version
	if v, ok := assetNames.Load(key); ok {
		return v.(string)
	}
	endpoint := c.endpoints.Discovery + "/" + kind + "/" + segment(ref.ID)
	if ref.Version != "" {
		endpoint += "/versions/" + segment(ref.Version)
	}
	var asset struct {
		Name string `json:"PublicName"`
	}
	if _, err := c.json(ctx, endpoint, &asset); err != nil || asset.Name == "" {
		return ""
	}
	assetNames.Store(key, asset.Name)
	return asset.Name
}

// MapName returns the map's public name for a raw match stats payload, or "".
func (c *Client) MapName(ctx context.Context, stats []byte) string {
	var p struct {
		Info struct {
			Map assetRef `json:"MapVariant"`
		} `json:"MatchInfo"`
	}
	if json.Unmarshal(stats, &p) != nil {
		return ""
	}
	return c.assetName(ctx, kindMap, p.Info.Map)
}

// ModeName returns the game mode's public name for a raw match stats payload, or "".
func (c *Client) ModeName(ctx context.Context, stats []byte) string {
	var p struct {
		Info struct {
			Mode assetRef `json:"UgcGameVariant"`
		} `json:"MatchInfo"`
	}
	if json.Unmarshal(stats, &p) != nil {
		return ""
	}
	return c.assetName(ctx, kindMode, p.Info.Mode)
}
