package main

import (
	"bytes"
	"compress/zlib"
	"context"
	"fmt"
	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMatchFacts(t *testing.T) {
	raw := []byte(`{"MatchInfo":{"MapVariant":{"AssetId":"map"},"UgcGameVariant":{"PublicName":"Slayer"}},"Players":[{"PlayerId":"xuid(123)","PlayerTeamStats":[{"TeamId":1,"Stats":{"CoreStats":{"Kills":5,"Deaths":2,"Assists":3}}}]}],"Teams":[{"TeamId":1,"Stats":{"CoreStats":{"Score":9}}},{"TeamId":0,"Stats":{"CoreStats":{"Score":10}}}]}`)
	f, mapID, err := matchFacts(raw)
	if err != nil {
		t.Fatal(err)
	}
	if mapID != "map" || f.GameVariantName != "Slayer" || len(f.Players) != 1 || f.Players[0].XUID != "123" || f.Players[0].Kills != 5 || f.TeamScores == nil || *f.TeamScores != [2]int{10, 9} {
		t.Fatalf("facts: %+v %s", f, mapID)
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
			fmt.Fprintf(w, `{"BlobStoragePathPrefix":%q,"CustomData":{"Chunks":[{"Index":0,"ChunkType":1,"ChunkSize":%d,"FileRelativePath":"chunk"}]}}`, base+"/blob", compressed.Len())
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
}
