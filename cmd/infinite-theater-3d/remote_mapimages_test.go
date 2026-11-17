// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// remote_mapimages_test.go — the recent-matches list answers without waiting for the
// missing map pictures (they are downloaded in the background), and repeated list
// requests do not start a second download for an asset that is already in flight. No
// real network, no real token.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
	"github.com/llampwall/infinite-theater-3d/internal/haloauth"
)

// TestRemoteMatchesDownloadMissingMapImagesOnce — the list row for an asset whose image is
// not stored comes back without mapImageUrl while the background download runs; a second
// list request issued while that download is in flight does not start another; the stored
// asset is never downloaded.
func TestRemoteMatchesDownloadMissingMapImagesOnce(t *testing.T) {
	root := newFakeStore(t)
	if err := os.MkdirAll(mapDir(root), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mapDir(root), "stored.png"), encodeTestPNG(t, 1200, 675), 0o644); err != nil {
		t.Fatal(err)
	}

	var downloads atomic.Int32
	gate := make(chan struct{}) // the "new" blob blocks on this, so the download stays in flight
	var base string
	svc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/players/xuid(x1)/matches":
			fmt.Fprint(w, `{"Results":[
				{"MatchId":"m1","MatchInfo":{"StartTime":"2026-02-02T00:00:00Z",
					"MapVariant":{"AssetId":"stored","VersionId":"v1","PublicName":"The Pit"},
					"UgcGameVariant":{"AssetId":"mode1","VersionId":"v1","PublicName":"Slayer"}}},
				{"MatchId":"m2","MatchInfo":{"StartTime":"2026-02-03T00:00:00Z",
					"MapVariant":{"AssetId":"new","VersionId":"v2","PublicName":"Other"},
					"UgcGameVariant":{"AssetId":"mode2","VersionId":"v1","PublicName":"Oddball"}}}]}`)
		case "/Maps/new", "/Maps/new/versions/v2":
			fmt.Fprintf(w, `{"Files":{"Prefix":%q,"FileRelativePaths":["hero.png"]}}`, base+"/blob")
		case "/blob/hero.png":
			downloads.Add(1)
			<-gate
			_, _ = w.Write(encodeTestPNG(t, 1200, 675))
		default:
			w.WriteHeader(404)
		}
	}))
	base = svc.URL
	defer sClose(t, svc, gate)

	h := newTestHandlers(root, nil)
	api := haloapi.New(svc.Client(), haloapi.Endpoints{Stats: svc.URL, Discovery: svc.URL, Economy: svc.URL}, "synthetic", "synthetic")
	h.remote.client = func(ctx context.Context) (*haloapi.Client, haloauth.Credentials, error) {
		return api, haloauth.Credentials{XUID: "x1"}, nil
	}

	// First list request: answered immediately, while the "new" download is still blocked.
	rows := remoteListRows(t, h)
	if rows[0].MapAssetID != "stored" || rows[0].MapImageURL != "/static/maps/halo_infinite/stored.png" {
		t.Fatalf("stored row = %+v, want its stored image URL", rows[0])
	}
	if rows[1].MapAssetID != "new" || rows[1].MapImageURL != "" {
		t.Fatalf("new row = %+v, want no image URL while the download is in flight", rows[1])
	}

	// Second list request while the download is in flight: no second download starts.
	remoteListRows(t, h)

	close(gate)
	waitFor(t, 5*time.Second, func() bool {
		return downloads.Load() == 1 && fileExists(t, filepath.Join(mapDir(root), "new.png"))
	})
	b, err := os.ReadFile(filepath.Join(mapDir(root), "new.png"))
	if err != nil {
		t.Fatal(err)
	}
	if w, ok := mapImageWidth(b); !ok || w != 1200 {
		t.Fatalf("stored width = %d ok=%v, want 1200", w, ok)
	}
	if got := storeMapImageURL(root, "new"); got != "/static/maps/halo_infinite/new.png" {
		t.Fatalf("storeMapImageURL(new) = %q, want the stored URL", got)
	}
}

func fileExists(t *testing.T, path string) bool {
	t.Helper()
	_, err := os.Stat(path)
	return err == nil
}

func remoteListRows(t *testing.T, h http.Handler) []haloapi.Match {
	t.Helper()
	rec := get(t, h, "/api/remote/matches", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var rows []haloapi.Match
	if err := json.Unmarshal(rec.Body.Bytes(), &rows); err != nil {
		t.Fatal(err)
	}
	return rows
}

// sClose releases a blocked download goroutine (if any) before closing the server, so a
// blocked handler cannot hold the server open.
func sClose(t *testing.T, s *httptest.Server, gate chan struct{}) {
	t.Cleanup(func() {
		select {
		case <-gate:
		default:
			close(gate)
		}
		s.Close()
	})
}
