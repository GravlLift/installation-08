package main

import (
	"bytes"
	"compress/zlib"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/JGtm/halo-infinite-film-decoder/filmcache"
	"github.com/JGtm/halo-infinite-film-decoder/finalise"
	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
	"github.com/llampwall/infinite-theater-3d/internal/haloauth"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

func authClient(dir string) *haloauth.Client {
	return haloauth.New(dir, nil, haloauth.DefaultEndpoints)
}
func apiClient(ctx context.Context, dir string) (*haloapi.Client, haloauth.Credentials, error) {
	return apiFor(ctx, authClient(dir))
}

func apiFor(ctx context.Context, auth *haloauth.Client) (*haloapi.Client, haloauth.Credentials, error) {
	t, err := auth.Current(ctx)
	if err != nil {
		return nil, t, err
	}
	return haloapi.New(nil, haloapi.DefaultEndpoints, t.Spartan, t.Clearance), t, nil
}

// publicClientID is this project's own Microsoft app registration (a public client: no
// secret exists). IT3D_CLIENT_ID or --client-id replaces it.
const publicClientID = "d3efe43c-09c8-4f73-a92e-e6883c46acd5"

func defaultClientID() string {
	if id := os.Getenv("IT3D_CLIENT_ID"); id != "" {
		return id
	}
	return publicClientID
}

func runLogin(args []string) error {
	fs := flag.NewFlagSet("login", flag.ContinueOnError)
	id := fs.String("client-id", defaultClientID(), "Microsoft public client ID")
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
	ctx := context.Background()
	if err := fetchMatch(ctx, root, api, *id, nil); err != nil {
		return err
	}
	if _, err := os.Stat(variantPath(root, *id, "map.mvar")); err == nil {
		if _, err := buildMatchVariant(ctx, root, *id, "", variantPath(root, *id, "variant.glb")); err != nil {
			slog.Warn("variant build failed after fetch", "id", *id, "err", err)
		} else {
			slog.Info("variant built after fetch", "id", *id)
		}
	}
	return nil
}

type savedChunk struct {
	Index      int    `json:"index"`
	Type       int    `json:"chunk_type"`
	Start      int    `json:"start_ms"`
	Size       int    `json:"size_bytes"`
	RemoteSize int    `json:"remote_size"`
	RemotePath string `json:"remote_path_hash"`
	Digest     string `json:"sha256"`
}
type savedManifest struct {
	Chunks []savedChunk `json:"chunks"`
}
type fetchProgress func(string, int, int)

type fetchOptions struct {
	progress fetchProgress
	build    func(*store.Root, string) error
}

func fetchMatch(ctx context.Context, root *store.Root, api *haloapi.Client, id string, progress fetchProgress) error {
	return fetchPipeline(ctx, root, api, id, fetchOptions{progress: progress, build: func(root *store.Root, id string) error { return buildStored(root, id, importFlags{}) }})
}
func fetchPipeline(ctx context.Context, root *store.Root, api *haloapi.Client, id string, opts fetchOptions) error {
	progress := opts.progress
	if !store.MatchIDValid(id) {
		return errors.New("invalid match id")
	}
	if progress == nil {
		progress = func(string, int, int) {}
	}
	total, err := fetchChunks(ctx, root, api, id, progress)
	if err != nil {
		return err
	}
	if err = fetchArtifacts(ctx, root, api, id); err != nil {
		return err
	}
	progress("building", total, total)
	return opts.build(root, id)
}
func fetchChunks(ctx context.Context, root *store.Root, api *haloapi.Client, id string, progress fetchProgress) (int, error) {
	m, _, err := api.Manifest(ctx, id)
	if err != nil {
		return 0, err
	}
	if len(m.Custom.Chunks) == 0 {
		return 0, &haloapi.FilmUnavailableError{}
	}
	if !finalise.Finalise(m.Custom.Chunks, func(ch haloapi.Chunk) int { return ch.Type }) {
		return 0, errors.New("film is not finalized")
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
			return 0, errors.New("invalid film chunk metadata")
		}
		target := filmcache.CheminDuChunk(chunkDir, ch.Index)
		prev, ok := old[ch.Index]
		raw, e := os.ReadFile(target)
		remoteHash := fmt.Sprintf("%x", sha256.Sum256([]byte(ch.Path)))
		valid := ok && e == nil && len(raw) == prev.Size && prev.Size > 0 && prev.RemoteSize == ch.Size && prev.RemotePath == remoteHash && fmt.Sprintf("%x", sha256.Sum256(raw)) == prev.Digest
		if !valid {
			raw, e = api.Chunk(ctx, m.Prefix, ch)
			if e != nil {
				return 0, e
			}
			raw, e = inflateChunk(raw)
			if e != nil {
				return 0, errors.New("invalid compressed film chunk")
			}
			if len(raw) == 0 {
				return 0, errors.New("empty film chunk")
			}
			if e = root.WriteFile(target, raw); e != nil {
				return 0, e
			}
		}
		saved.Chunks = append(saved.Chunks, savedChunk{Index: ch.Index, Type: ch.Type, Start: ch.Start, Size: len(raw), RemoteSize: ch.Size, RemotePath: remoteHash, Digest: fmt.Sprintf("%x", sha256.Sum256(raw))})
		data, _ := json.Marshal(saved)
		if err = root.WriteFile(manifestPath, data); err != nil {
			return 0, err
		}
		progress("downloading", i+1, len(m.Custom.Chunks))
	}
	return len(m.Custom.Chunks), nil
}
func fetchArtifacts(ctx context.Context, root *store.Root, api *haloapi.Client, id string) error {
	raw, err := api.Stats(ctx, id)
	if err != nil {
		return err
	}
	facts, mapID, mapVersion, err := matchFacts(raw)
	if err != nil {
		return errors.New("invalid match stats")
	}
	if facts.GameVariantName == "" {
		facts.GameVariantName = api.ModeName(ctx, raw)
	}
	stats, _ := json.Marshal(facts)
	statsPath, _ := root.MatchStatsPath(id)
	if err = root.WriteFile(filepath.Join(filepath.Dir(statsPath), "stats-full.json"), raw); err != nil {
		return err
	}
	if err = root.WriteFile(statsPath, stats); err != nil {
		return err
	}
	if mapID != "" {
		mvar, e := api.Mvar(ctx, mapID, mapVersion)
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
	return nil
}

func inflateChunk(raw []byte) ([]byte, error) {
	reader, err := zlib.NewReader(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, 256<<20+1))
	if err != nil {
		return nil, err
	}
	if len(data) > 256<<20 {
		return nil, errors.New("film chunk too large")
	}
	return data, nil
}
