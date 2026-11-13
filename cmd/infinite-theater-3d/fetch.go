package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/JGtm/halo-infinite-film-decoder/decfilm"
	"github.com/JGtm/halo-infinite-film-decoder/filmcache"
	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
	"github.com/llampwall/infinite-theater-3d/internal/haloauth"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

func authClient(dir string) *haloauth.Client {
	return haloauth.New(dir, nil, haloauth.DefaultEndpoints)
}
func apiClient(ctx context.Context, dir string) (*haloapi.Client, haloauth.Credentials, error) {
	t, err := authClient(dir).Current(ctx)
	if err != nil {
		return nil, t, err
	}
	return haloapi.New(nil, haloapi.DefaultEndpoints, t.Spartan, t.Clearance), t, nil
}
func runLogin(args []string) error {
	fs := flag.NewFlagSet("login", flag.ContinueOnError)
	id := fs.String("client-id", os.Getenv("IT3D_CLIENT_ID"), "Microsoft public client ID (required)")
	data := fs.String("data", "", "data directory")
	if err := fs.Parse(args); err != nil {
		return err
	}
	dir, err := dataDirFor(*data)
	if err != nil {
		return err
	}
	t, err := authClient(dir).Login(context.Background(), *id, func(uri, code string) { fmt.Printf("Open %s and enter %s\n", uri, code) })
	if err == nil {
		fmt.Printf("Signed in as %s\n", t.Gamertag)
	}
	return err
}
func runLogout(args []string) error {
	fs := flag.NewFlagSet("logout", flag.ContinueOnError)
	data := fs.String("data", "", "data directory")
	if err := fs.Parse(args); err != nil {
		return err
	}
	dir, err := dataDirFor(*data)
	if err != nil {
		return err
	}
	return authClient(dir).Logout()
}
func runMatches(args []string) error {
	fs := flag.NewFlagSet("matches", flag.ContinueOnError)
	data := fs.String("data", "", "data directory")
	count := fs.Int("count", 10, "number of matches (1-25)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	dir, err := dataDirFor(*data)
	if err != nil {
		return err
	}
	api, t, err := apiClient(context.Background(), dir)
	if err != nil {
		return err
	}
	matches, err := api.Matches(context.Background(), t.XUID, *count)
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(matches)
}
func runFetch(args []string) error {
	fs := flag.NewFlagSet("fetch", flag.ContinueOnError)
	data := fs.String("data", "", "data directory")
	id := fs.String("match", "", "match id")
	if err := fs.Parse(args); err != nil {
		return err
	}
	dir, err := dataDirFor(*data)
	if err != nil {
		return err
	}
	root, err := store.New(dir)
	if err != nil {
		return err
	}
	api, _, err := apiClient(context.Background(), dir)
	if err != nil {
		return err
	}
	return fetchMatch(context.Background(), root, api, *id, nil)
}

type savedChunk struct {
	Index      int    `json:"index"`
	Type       int    `json:"chunk_type"`
	Start      int    `json:"start_ms"`
	Size       int    `json:"size_bytes"`
	RemoteSize int    `json:"remote_size"`
	RemotePath string `json:"remote_path"`
}
type savedManifest struct {
	Chunks []savedChunk `json:"chunks"`
}
type fetchProgress func(string, int, int)

func fetchMatch(ctx context.Context, root *store.Root, api *haloapi.Client, id string, progress fetchProgress) error {
	if !store.MatchIDValid(id) {
		return errors.New("invalid match id")
	}
	if progress == nil {
		progress = func(string, int, int) {}
	}
	m, _, err := api.Manifest(ctx, id)
	if err != nil {
		return err
	}
	if len(m.Custom.Chunks) == 0 {
		return errors.New("film manifest has no chunks")
	}
	manifestPath, _ := root.MatchManifestPath(id)
	chunkDir, _ := root.MatchChunksDir(id)
	var saved savedManifest
	if raw, e := os.ReadFile(manifestPath); e == nil {
		_ = json.Unmarshal(raw, &saved)
	}
	old := map[int]savedChunk{}
	for _, ch := range saved.Chunks {
		old[ch.Index] = ch
	}
	saved.Chunks = nil
	for i, ch := range m.Custom.Chunks {
		if ch.Index < 0 || ch.Path == "" {
			return errors.New("invalid film chunk metadata")
		}
		target := filmcache.CheminDuChunk(chunkDir, ch.Index)
		prev, ok := old[ch.Index]
		info, e := os.Stat(target)
		if !ok || e != nil || prev.Size <= 0 || info.Size() != int64(prev.Size) || prev.RemoteSize != ch.Size || prev.RemotePath != ch.Path {
			raw, e := api.Chunk(ctx, m.Prefix, ch)
			if e != nil {
				return e
			}
			raw, e = decfilm.Decompresser(raw)
			if e != nil {
				return errors.New("invalid compressed film chunk")
			}
			if len(raw) == 0 {
				return errors.New("empty film chunk")
			}
			if e = root.WriteFile(target, raw); e != nil {
				return e
			}
			prev.Size = len(raw)
		}
		saved.Chunks = append(saved.Chunks, savedChunk{Index: ch.Index, Type: ch.Type, Start: ch.Start, Size: prev.Size, RemoteSize: ch.Size, RemotePath: ch.Path})
		raw, _ := json.Marshal(saved)
		if err = root.WriteFile(manifestPath, raw); err != nil {
			return err
		}
		progress("downloading", i+1, len(m.Custom.Chunks))
	}
	raw, err := api.Stats(ctx, id)
	if err != nil {
		return err
	}
	facts, mapID, err := matchFacts(raw)
	if err != nil {
		return errors.New("invalid match stats")
	}
	stats, _ := json.Marshal(facts)
	statsPath, _ := root.MatchStatsPath(id)
	if err = root.WriteFile(statsPath, stats); err != nil {
		return err
	}
	if mapID != "" {
		mvar, e := api.Mvar(ctx, mapID)
		if e != nil {
			return e
		}
		if e = root.WriteFile(filepath.Join(filepath.Dir(statsPath), "map.mvar"), mvar); e != nil {
			return e
		}
	}
	for _, p := range facts.Players {
		if p.XUID == "" || strings.Trim(p.XUID, "0123456789") != "" {
			continue
		}
		armor, e := api.Customization(ctx, p.XUID)
		if e != nil {
			return e
		}
		if e = root.WriteFile(filepath.Join(filepath.Dir(statsPath), "customization", p.XUID+".json"), armor); e != nil {
			return e
		}
	}
	progress("building", len(m.Custom.Chunks), len(m.Custom.Chunks))
	return buildStored(root, id, importFlags{})
}
