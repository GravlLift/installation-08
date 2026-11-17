// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"bytes"
	"compress/zlib"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// TestFetchArtifactsCachesArmorDefinitions: each definition the equipped armor
// reads is fetched once into the shared GameCMS cache; a re-fetch of the match
// serves the cache without hitting the fake again.
func TestFetchArtifactsCachesArmorDefinitions(t *testing.T) {
	var compressed bytes.Buffer
	zw := zlib.NewWriter(&compressed)
	_, _ = zw.Write([]byte("film-data"))
	_ = zw.Close()
	calls := map[string]int{}
	var base string
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls[r.URL.Path]++
		switch r.URL.Path {
		case "/films/matches/abc/spectate":
			fmt.Fprintf(w, `{"BlobStoragePathPrefix":%q,"CustomData":{"Chunks":[{"Index":0,"ChunkType":3,"ChunkSize":%d,"FileRelativePath":"film"}]}}`, base+"/blob", compressed.Len())
		case "/blob/film":
			_, _ = w.Write(compressed.Bytes())
		case "/Waypoint/file/medals/metadata.json":
			fmt.Fprint(w, `{"Medals":[]}`)
		case "/matches/abc/stats":
			fmt.Fprint(w, `{"MatchInfo":{"UgcGameVariant":{"PublicName":"Slayer"}},"Players":[{"PlayerId":"xuid(123)","LastTeamId":1}]}`)
		case "/players/xuid(123)/customization":
			fmt.Fprint(w, `{"ArmorCores":{"ArmorCores":[{"CoreId":"core","CorePath":"core.json","IsEquipped":true,"Themes":[{"IsEquipped":true,"ThemePath":"infinite/customization/armor/cores/core/theme.json","HelmetPath":"infinite/customization/armor/items/helmet.json","CoatingPath":"infinite/customization/armor/coatings/steel.json"}]}]},"SpartanBody":{"BodyType":"Medium"}}`)
		case "/progression/file/infinite/customization/armor/cores/core/theme.json":
			fmt.Fprint(w, `{"CommonData":{"Id":"theme","Type":"ArmorTheme"},"TagId":1234,"CoreRegionData":{"BaseRegionData":[{"RegionId":{"m_identifier":1},"PermutationId":{"m_identifier":2}}]}}`)
		case "/progression/file/infinite/customization/armor/items/helmet.json":
			fmt.Fprint(w, `{"CommonData":{"Id":"helmet","Type":"ArmorHelmet"},"RegionData":[{"RegionId":{"m_identifier":7},"PermutationId":{"m_identifier":9}}]}`)
		case "/progression/file/infinite/customization/armor/coatings/steel.json":
			fmt.Fprint(w, `{"CommonData":{"Id":"steel","Type":"ArmorCoating"},"StyleId":{"m_identifier":42}}`)
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
	api := haloapi.New(client, haloapi.Endpoints{Stats: base, Discovery: base, Economy: base, GameCMS: base}, "fake", "fake")
	opts := fetchOptions{build: func(*store.Root, string) error { return nil }}
	if err = fetchPipeline(context.Background(), root, api, "abc", opts); err != nil {
		t.Fatal(err)
	}
	defs := []string{
		"/progression/file/infinite/customization/armor/cores/core/theme.json",
		"/progression/file/infinite/customization/armor/items/helmet.json",
		"/progression/file/infinite/customization/armor/coatings/steel.json",
	}
	for _, p := range defs {
		if calls[p] != 1 {
			t.Fatalf("definition %s fetched %d times", p, calls[p])
		}
		if _, err = os.Stat(filepath.Join(root.Dir(), "gamecms", filepath.FromSlash(p[len("/progression/file/"):]))); err != nil {
			t.Fatalf("cache miss %s: %v", p, err)
		}
	}
	if err = fetchPipeline(context.Background(), root, api, "abc", opts); err != nil {
		t.Fatal(err)
	}
	for _, p := range defs {
		if calls[p] != 1 {
			t.Fatalf("definition %s re-fetched: %d calls", p, calls[p])
		}
	}
}

// TestFetchArtifactsCachesWeaponDefinitions: each definition an equipped weapon
// theme reads (coating and theme files) is fetched once into the shared GameCMS
// cache; a re-fetch serves the cache without hitting the fake again.
func TestFetchArtifactsCachesWeaponDefinitions(t *testing.T) {
	var compressed bytes.Buffer
	zw := zlib.NewWriter(&compressed)
	_, _ = zw.Write([]byte("film-data"))
	_ = zw.Close()
	calls := map[string]int{}
	var base string
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls[r.URL.Path]++
		switch r.URL.Path {
		case "/films/matches/abc/spectate":
			fmt.Fprintf(w, `{"BlobStoragePathPrefix":%q,"CustomData":{"Chunks":[{"Index":0,"ChunkType":3,"ChunkSize":%d,"FileRelativePath":"film"}]}}`, base+"/blob", compressed.Len())
		case "/blob/film":
			_, _ = w.Write(compressed.Bytes())
		case "/Waypoint/file/medals/metadata.json":
			fmt.Fprint(w, `{"Medals":[]}`)
		case "/matches/abc/stats":
			fmt.Fprint(w, `{"MatchInfo":{"UgcGameVariant":{"PublicName":"Slayer"}},"Players":[{"PlayerId":"xuid(123)","LastTeamId":1}]}`)
		case "/players/xuid(123)/customization":
			fmt.Fprint(w, `{"WeaponCores":{"WeaponCores":[{"CoreId":"br","CorePath":"br.json","CoreType":"WeaponBR","Themes":[{"IsEquipped":true,"ThemePath":"inventory/weapon/themes/br.json","CoatingPath":"inventory/weapon/coatings/4257011.json"}]}]}}`)
		case "/progression/file/inventory/weapon/coatings/4257011.json":
			fmt.Fprint(w, `{"CommonData":{"Id":"4257011","Type":"WeaponCoating"},"StyleId":{"m_identifier":-139792058}}`)
		case "/progression/file/inventory/weapon/themes/br.json":
			fmt.Fprint(w, `{"CommonData":{"Id":"br-theme","Type":"WeaponTheme"}}`)
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
	api := haloapi.New(client, haloapi.Endpoints{Stats: base, Discovery: base, Economy: base, GameCMS: base}, "fake", "fake")
	opts := fetchOptions{build: func(*store.Root, string) error { return nil }}
	if err = fetchPipeline(context.Background(), root, api, "abc", opts); err != nil {
		t.Fatal(err)
	}
	defs := []string{
		"/progression/file/inventory/weapon/coatings/4257011.json",
		"/progression/file/inventory/weapon/themes/br.json",
	}
	for _, p := range defs {
		if calls[p] != 1 {
			t.Fatalf("definition %s fetched %d times", p, calls[p])
		}
		if _, err = os.Stat(filepath.Join(root.Dir(), "gamecms", filepath.FromSlash(p[len("/progression/file/"):]))); err != nil {
			t.Fatalf("cache miss %s: %v", p, err)
		}
	}
	if err = fetchPipeline(context.Background(), root, api, "abc", opts); err != nil {
		t.Fatal(err)
	}
	for _, p := range defs {
		if calls[p] != 1 {
			t.Fatalf("definition %s re-fetched: %d calls", p, calls[p])
		}
	}
}
