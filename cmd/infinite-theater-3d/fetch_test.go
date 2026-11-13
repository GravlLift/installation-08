package main

import (
	"bytes"
	"compress/zlib"
	"context"
	"fmt"
	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

type localOnlyTransport struct {
	host string
	base http.RoundTripper
}

func (t localOnlyTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Host != t.host {
		return nil, fmt.Errorf("unexpected outbound request to %s", r.URL.Host)
	}
	return t.base.RoundTrip(r)
}

func TestMatchFacts(t *testing.T) {
	raw := []byte(`{"MatchInfo":{"MapVariant":{"AssetId":"map"},"UgcGameVariant":{"PublicName":"Slayer"},"Playlist":{"PublicName":"Ranked Arena"}},"Players":[{"PlayerId":"xuid(123)","LastTeamId":1,"PlayerTeamStats":[{"TeamId":1,"Stats":{"CoreStats":{"Kills":5,"Deaths":2,"Assists":3}}}]}],"Teams":[{"TeamId":1,"Stats":{"CoreStats":{"Score":9,"RoundsWon":1,"RoundsLost":0,"RoundsTied":0}}},{"TeamId":0,"Stats":{"CoreStats":{"Score":10,"RoundsWon":2,"RoundsLost":0,"RoundsTied":0}}}]}`)
	f, mapID, _, playlist, err := matchFacts(raw)
	if err != nil {
		t.Fatal(err)
	}
	if mapID != "map" || f.GameVariantName != "Slayer" || len(f.Players) != 1 || f.Players[0].XUID != "123" || f.Players[0].Kills != 5 || f.TeamScores == nil || *f.TeamScores != [2]int{10, 9} {
		t.Fatalf("facts: %+v %s", f, mapID)
	}
	if playlist != "Ranked Arena" {
		t.Fatalf("playlist: %q", playlist)
	}
	if f.TeamRoundsWon == nil || (*f.TeamRoundsWon)[0] != [3]int{2, 0, 0} || (*f.TeamRoundsWon)[1] != [3]int{1, 0, 0} {
		t.Fatalf("rounds: %+v", f.TeamRoundsWon)
	}
}

func TestFetchResume(t *testing.T) {
	var compressed bytes.Buffer
	zw := zlib.NewWriter(&compressed)
	_, _ = zw.Write([]byte("synthetic film"))
	_ = zw.Close()
	downloads := 0
	var base string
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hi/films/matches/abc/spectate":
			fmt.Fprintf(w, `{"BlobStoragePathPrefix":%q,"CustomData":{"Chunks":[{"Index":0,"ChunkType":3,"ChunkSize":%d,"FileRelativePath":"chunk"}]}}`, base+"/blob", compressed.Len())
		case "/blob/chunk":
			downloads++
			_, _ = w.Write(compressed.Bytes())
		case "/hi/matches/abc/stats":
			fmt.Fprint(w, `{"Players":[]}`)
		default:
			w.WriteHeader(404)
		}
	}))
	defer s.Close()
	base = s.URL
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	api := haloapi.New(s.Client(), haloapi.Endpoints{Stats: s.URL + "/hi", Discovery: s.URL + "/hi", Economy: s.URL + "/hi"}, "fake", "fake")
	for i := 0; i < 2; i++ {
		if err := fetchMatch(context.Background(), root, api, "abc", nil); err == nil {
			t.Fatal("invalid film unexpectedly built")
		}
	}
	if downloads != 1 {
		t.Fatalf("downloaded %d times", downloads)
	}
	chunkDir, _ := root.MatchChunksDir("abc")
	if err := os.WriteFile(filepath.Join(chunkDir, "chunk_00.bin"), []byte("xxxxxxxxxxxxxx"), 0o600); err != nil {
		t.Fatal(err)
	}
	_ = fetchMatch(context.Background(), root, api, "abc", nil)
	if downloads != 2 {
		t.Fatalf("corrupt chunk was not downloaded again: %d", downloads)
	}
}

func TestFetchRejectsIncompleteFixture(t *testing.T) {
	const id = "fb1a1a72-0000-0000-0000-000000000000"
	chunks := make([][]byte, 3)
	for i := range chunks {
		raw, err := os.ReadFile(filepath.Join("..", "..", "third_party", "film-decoder", "replay", "testdata", "minifilm_fb1a1a72", fmt.Sprintf("chunk_%02d.bin", i)))
		if err != nil {
			t.Fatal(err)
		}
		var buf bytes.Buffer
		zw := zlib.NewWriter(&buf)
		_, _ = zw.Write(raw)
		_ = zw.Close()
		chunks[i] = buf.Bytes()
	}
	var base string
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/spectate"):
			fmt.Fprintf(w, `{"BlobStoragePathPrefix":%q,"CustomData":{"Chunks":[{"Index":0,"ChunkType":1,"ChunkSize":%d,"FileRelativePath":"0"},{"Index":1,"ChunkType":2,"ChunkSize":%d,"FileRelativePath":"1"},{"Index":2,"ChunkType":3,"ChunkSize":%d,"FileRelativePath":"2"}]}}`, base+"/blob", len(chunks[0]), len(chunks[1]), len(chunks[2]))
		case strings.HasPrefix(r.URL.Path, "/blob/"):
			i, _ := strconv.Atoi(path.Base(r.URL.Path))
			_, _ = w.Write(chunks[i])
		case strings.HasSuffix(r.URL.Path, "/stats"):
			fmt.Fprint(w, `{"MatchInfo":{"UgcGameVariant":{"PublicName":"Capture the Flag"}},"Players":[]}`)
		default:
			w.WriteHeader(404)
		}
	}))
	defer s.Close()
	base = s.URL
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	api := haloapi.New(s.Client(), haloapi.Endpoints{Stats: s.URL, Discovery: s.URL, Economy: s.URL}, "fake", "fake")
	if err = fetchMatch(context.Background(), root, api, id, nil); err == nil {
		t.Fatal("incomplete minifilm unexpectedly built")
	}
}

func TestFetchPipelineStoresArtifacts(t *testing.T) {
	var compressed bytes.Buffer
	zw := zlib.NewWriter(&compressed)
	_, _ = zw.Write([]byte("film-data"))
	_ = zw.Close()
	var base string
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/films/matches/abc/spectate":
			fmt.Fprintf(w, `{"BlobStoragePathPrefix":%q,"CustomData":{"Chunks":[{"Index":0,"ChunkType":3,"ChunkSize":%d,"FileRelativePath":"film"}]}}`, base+"/blob", compressed.Len())
		case "/blob/film":
			_, _ = w.Write(compressed.Bytes())
		case "/matches/abc/stats":
			fmt.Fprint(w, `{"MatchInfo":{"MapVariant":{"AssetId":"map","VersionId":"ver"},"UgcGameVariant":{"PublicName":"Slayer"}},"Players":[{"PlayerId":"xuid(123)","LastTeamId":1}]}`)
		case "/Maps/map/versions/ver":
			fmt.Fprintf(w, `{"Files":{"Prefix":%q,"FileRelativePaths":["base.mvar","map.mvar"]}}`, base+"/blob")
		case "/blob/map.mvar":
			fmt.Fprint(w, "map-data")
		case "/players/xuid(123)/customization":
			fmt.Fprint(w, `{"ArmorCores":{"ArmorCores":[]},"SpartanBody":{"BodyType":"Medium"}}`)
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer s.Close()
	base = s.URL
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	serverURL, err := url.Parse(base)
	if err != nil {
		t.Fatal(err)
	}
	client := s.Client()
	client.Transport = localOnlyTransport{host: serverURL.Host, base: client.Transport}
	api := haloapi.New(client, haloapi.Endpoints{Stats: base, Discovery: base, Economy: base}, "fake", "fake")
	built := false
	opts := fetchOptions{build: func(root *store.Root, id string) error { built = true; return nil }}
	if err = fetchPipeline(context.Background(), root, api, "abc", opts); err != nil {
		t.Fatal(err)
	}
	if !built {
		t.Fatal("build not called")
	}
	for _, name := range []string{"manifest.json", "stats.json", "stats-full.json", "map.mvar", "customization/123.json", "chunks/chunk_00.bin"} {
		if _, err = os.Stat(filepath.Join(root.MatchesDir(), "abc", name)); err != nil {
			t.Fatal(err)
		}
	}
	full, err := os.ReadFile(filepath.Join(root.MatchesDir(), "abc", "stats-full.json"))
	if err != nil || !bytes.Contains(full, []byte(`"PlayerId":"xuid(123)"`)) {
		t.Fatalf("full stats not saved: %s, %v", full, err)
	}
}

func TestFetchContextArtifacts(t *testing.T) {
	var calls = map[string]int{}
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls[r.URL.Path]++
		switch r.URL.Path {
		case "/matches/abc/skill":
			fmt.Fprint(w, `{"Value":[]}`)
		case "/playlists/pl/versions/ver":
			fmt.Fprint(w, `{"PublicName":"Ranked Arena"}`)
		case "/mapModePairs/pair/versions/ver":
			fmt.Fprint(w, `{"PublicName":"Ranked:Oddball on Live Fire"}`)
		case "/Waypoint/file/medals/metadata.json":
			fmt.Fprint(w, `{"Medals":[{"nameId":42,"name":{"value":"Test"},"spriteIndex":0}]}`)
		case "/Waypoint/file/medals/images/medal_sheet_xl.png":
			img := image.NewRGBA(image.Rect(0, 0, 256, 256))
			_ = png.Encode(w, img)
		case "/Maps/map/versions/ver":
			fmt.Fprintf(w, `{"Files":{"Prefix":%q,"FileRelativePaths":["thumbnail.png"]}}`, "http://"+r.Host+"/blob")
		case "/blob/thumbnail.png":
			fmt.Fprint(w, "map-image")
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer s.Close()
	u, _ := url.Parse(s.URL)
	client := s.Client()
	client.Transport = localOnlyTransport{host: u.Host, base: client.Transport}
	api := haloapi.New(client, haloapi.Endpoints{Stats: s.URL, Discovery: s.URL, Economy: s.URL, Skill: s.URL, GameCMS: s.URL}, "fake", "fake")
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	raw := []byte(`{"MatchInfo":{"Playlist":{"AssetId":"pl","VersionId":"ver"},"PlaylistMapModePair":{"AssetId":"pair","VersionId":"ver"},"MapVariant":{"AssetId":"map","VersionId":"ver"}},"Players":[{"PlayerId":"xuid(123)"}]}`)
	for i := 0; i < 2; i++ {
		if err := fetchContextArtifacts(context.Background(), root, api, "abc", raw); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range []string{"matches/abc/skill.json", "matches/abc/playlist.json", "matches/abc/map-mode-pair.json", "medals/metadata.json", "static/medals/halo_infinite/42.png", "static/maps/halo_infinite/map.png"} {
		if _, err := os.Stat(filepath.Join(root.Dir(), filepath.FromSlash(p))); err != nil {
			t.Errorf("%s: %v", p, err)
		}
	}
	if calls["/Waypoint/file/medals/metadata.json"] != 1 || calls["/Waypoint/file/medals/images/medal_sheet_xl.png"] != 1 {
		t.Fatalf("catalog not reused: %v", calls)
	}
}
