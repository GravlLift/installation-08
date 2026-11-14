package haloapi

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestMapImageRank — the path->rank table: hero beats screenshot, screenshot beats thumbnail,
// thumbnail alone is still chosen (its rank is above a non-image), non-image files are ignored,
// and matching is case-insensitive.
func TestMapImageRank(t *testing.T) {
	cases := []struct {
		name string
		path string
		rank int
	}{
		{"hero", "maps/hero.png", 3},
		{"screenshot", "maps/screenshot.jpg", 2},
		{"other image", "maps/scene.jpeg", 1},
		{"thumbnail last", "maps/thumbnail.png", 0},
		{"thumbnail above non-image", "maps/thumbnail.png", 0},
		{"non-image ignored", "maps/map.mvar", -1},
		{"case ignored hero", "MAPS/HERO.JPG", 3},
		{"case ignored thumbnail", "Thumbnail.PNG", 0},
	}
	for _, tc := range cases {
		if got := mapImageRank(tc.path); got != tc.rank {
			t.Errorf("%s: mapImageRank(%q) = %d, want %d", tc.name, tc.path, got, tc.rank)
		}
	}
	if !(mapImageRank("hero.png") > mapImageRank("screenshot.png")) {
		t.Error("hero should beat screenshot")
	}
	if !(mapImageRank("screenshot.png") > mapImageRank("thumbnail.png")) {
		t.Error("screenshot should beat thumbnail")
	}
}

// TestMapImagePicksHero — MapImage selects the highest-ranked image: with several images listed,
// the hero is downloaded even when a thumbnail and a screenshot are also present.
func TestMapImagePicksHero(t *testing.T) {
	var base string
	var gotPath string
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hi/Maps/m1/versions/v1":
			fmt.Fprintf(w, `{"Files":{"Prefix":%q,"FileRelativePaths":["thumbnail.png","screenshot.jpg","hero.png"]}}`, base+"/blob")
		case "/blob/hero.png":
			gotPath = r.URL.Path
			fmt.Fprint(w, "hero-bytes")
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer s.Close()
	base = s.URL
	c := New(s.Client(), Endpoints{Discovery: s.URL + "/hi"}, "sp", "cl")
	c.interval = 0
	raw, err := c.MapImage(context.Background(), "m1", "v1")
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "hero-bytes" || gotPath != "/blob/hero.png" {
		t.Fatalf("hero not selected: %q from %s", raw, gotPath)
	}
}

// TestMapImagePicksFirstScreenshot — with no hero, a screenshot wins over a thumbnail, and among
// several screenshots the first in list order is taken.
func TestMapImagePicksFirstScreenshot(t *testing.T) {
	var base string
	var gotPath string
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hi/Maps/m1/versions/v1":
			fmt.Fprintf(w, `{"Files":{"Prefix":%q,"FileRelativePaths":["thumbnail.png","shot_b.png","shot_a.png"]}}`, base+"/blob")
		case "/blob/shot_b.png", "/blob/shot_a.png":
			gotPath = r.URL.Path
			fmt.Fprint(w, "shot-bytes")
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer s.Close()
	base = s.URL
	c := New(s.Client(), Endpoints{Discovery: s.URL + "/hi"}, "sp", "cl")
	c.interval = 0
	raw, err := c.MapImage(context.Background(), "m1", "v1")
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "shot-bytes" || gotPath != "/blob/shot_b.png" {
		t.Fatalf("first screenshot not selected: %q from %s", raw, gotPath)
	}
}
