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
			fmt.Fprint(w, `{"Results":[{"MatchId":"abc"}]}`)
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
	if _, err := c.Matches(ctx, "123", 1); err != nil {
		t.Fatal(err)
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
	if _, err = c.Mvar(ctx, "map"); err != nil {
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
