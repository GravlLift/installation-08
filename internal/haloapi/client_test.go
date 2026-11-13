package haloapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEndpointsAndFilmGone(t *testing.T) {
	var base string
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-343-authorization-spartan") != "test-spartan" && r.URL.Path != "/blob/chunk" && r.URL.Path != "/blob/map.mvar" {
			t.Errorf("missing auth for %s", r.URL.Path)
		}
		switch r.URL.Path {
		case "/hi/players/xuid(123)/matches":
			fmt.Fprint(w, `{"Results":[{"MatchId":"abc","MatchInfo":{"StartTime":"t","MapVariant":{"AssetId":"m1","VersionId":"v1"},"UgcGameVariant":{"AssetId":"g1","VersionId":"v2"}}}]}`)
		case "/hi/maps/m1/versions/v1":
			fmt.Fprint(w, `{"PublicName":"Live Fire - Ranked"}`)
		case "/hi/ugcGameVariants/g1/versions/v2":
			fmt.Fprint(w, `{"PublicName":"Ranked:Oddball"}`)
		case "/hi/matches/abc/stats":
			fmt.Fprint(w, `{"Players":[]}`)
		case "/hi/films/matches/abc/spectate":
			fmt.Fprintf(w, `{"BlobStoragePathPrefix":%q,"CustomData":{"Chunks":[{"Index":0,"ChunkSize":3,"FileRelativePath":"chunk"}]}}`, base+"/blob")
		case "/hi/films/matches/gone/spectate":
			w.WriteHeader(404)
		case "/hi/Maps/map":
			fmt.Fprintf(w, `{"Files":{"Prefix":%q,"FileRelativePaths":["map.mvar"]}}`, base+"/blob")
		case "/hi/players/xuid(123)/customization":
			fmt.Fprint(w, `{"ArmorCores":{}}`)
		case "/blob/chunk":
			fmt.Fprint(w, "abc")
		case "/blob/map.mvar":
			fmt.Fprint(w, "map")
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer s.Close()
	base = s.URL
	c := New(s.Client(), Endpoints{s.URL + "/hi", s.URL + "/hi", s.URL + "/hi"}, "test-spartan", "test-clearance")
	c.interval = 0
	ctx := context.Background()
	ms, err := c.Matches(ctx, "123", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(ms) != 1 || ms[0].Map != "Live Fire - Ranked" || ms[0].Mode != "Ranked:Oddball" {
		t.Fatalf("names not resolved from asset ids: %+v", ms)
	}
	if got := c.ModeName(ctx, []byte(`{"MatchInfo":{"UgcGameVariant":{"AssetId":"g1","VersionId":"v2"}}}`)); got != "Ranked:Oddball" {
		t.Fatalf("mode name %q", got)
	}
	if _, err := c.Stats(ctx, "abc"); err != nil {
		t.Fatal(err)
	}
	m, _, err := c.Manifest(ctx, "abc")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = c.Chunk(ctx, m.Prefix, m.Custom.Chunks[0]); err != nil {
		t.Fatal(err)
	}
	if _, err = c.Mvar(ctx, "map", ""); err != nil {
		t.Fatal(err)
	}
	if _, err = c.Customization(ctx, "123"); err != nil {
		t.Fatal(err)
	}
	_, _, err = c.Manifest(ctx, "gone")
	var gone *FilmUnavailableError
	if !errors.As(err, &gone) {
		t.Fatalf("expected film unavailable: %v", err)
	}
}

func TestRetriesAndBlobDoesNotCarryCredentials(t *testing.T) {
	attempts := 0
	var base string
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/blob" {
			if r.Header.Get("x-343-authorization-spartan") != "" || r.Header.Get("343-clearance") != "" {
				t.Error("credentials sent to blob")
			}
			fmt.Fprint(w, "abc")
			return
		}
		attempts++
		if attempts < 3 {
			w.WriteHeader(503)
			return
		}
		fmt.Fprint(w, `{"MatchInfo":{}}`)
	}))
	defer s.Close()
	base = s.URL
	c := New(s.Client(), Endpoints{Stats: base, Discovery: base, Economy: base}, "test-secret", "test-clearance")
	c.interval = 0
	if _, err := c.Stats(context.Background(), "abc"); err != nil || attempts != 3 {
		t.Fatalf("retry %d %v", attempts, err)
	}
	if _, err := c.Chunk(context.Background(), base, Chunk{Path: "blob", Size: 3}); err != nil {
		t.Fatal(err)
	}
}
