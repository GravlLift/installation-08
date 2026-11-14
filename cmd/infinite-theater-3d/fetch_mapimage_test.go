package main

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

func newMapImageRoot(t *testing.T) *store.Root {
	t.Helper()
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func mapDir(root *store.Root) string {
	return filepath.Join(root.Dir(), "static", "maps", "halo_infinite")
}

func writeTestFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func encodeTestPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func encodeTestJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, image.NewRGBA(image.Rect(0, 0, w, h)), nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// mapImageServer serves a single map's image (at /blob/hero.png) plus its file manifest. When
// fail is set the blob answers 404 so the download fails immediately without retry.
func mapImageServer(t *testing.T, assetID string, body []byte, fail bool, downloads *int) *httptest.Server {
	t.Helper()
	var base string
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/Maps/" + assetID:
			fmt.Fprintf(w, `{"Files":{"Prefix":%q,"FileRelativePaths":["hero.png"]}}`, base+"/blob")
		case "/blob/hero.png":
			if fail {
				w.WriteHeader(404)
				return
			}
			*downloads++
			_, _ = w.Write(body)
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	base = s.URL
	return s
}

func mapImageClient(s *httptest.Server) *haloapi.Client {
	u, _ := url.Parse(s.URL)
	client := s.Client()
	client.Transport = localOnlyTransport{host: u.Host, base: client.Transport}
	return haloapi.New(client, haloapi.Endpoints{Discovery: s.URL}, "fake", "fake")
}

// TestFetchMapImageReplacesSmallThumbnail — a stored thumbnail under the width threshold is
// downloaded again and replaced with the real image.
func TestFetchMapImageReplacesSmallThumbnail(t *testing.T) {
	root := newMapImageRoot(t)
	writeTestFile(t, filepath.Join(mapDir(root), "a1.png"), encodeTestPNG(t, 560, 316))
	downloads := 0
	s := mapImageServer(t, "a1", encodeTestPNG(t, 1200, 675), false, &downloads)
	defer s.Close()
	fetchMapImage(context.Background(), root, mapImageClient(s), "a1", "")
	if downloads != 1 {
		t.Fatalf("downloads = %d, want 1", downloads)
	}
	b, err := os.ReadFile(filepath.Join(mapDir(root), "a1.png"))
	if err != nil {
		t.Fatal(err)
	}
	if w, ok := mapImageWidth(b); !ok || w != 1200 {
		t.Fatalf("stored width = %d ok=%v, want 1200", w, ok)
	}
}

// TestFetchMapImageKeepsLargeStored — a stored image at or above the threshold is not
// re-downloaded.
func TestFetchMapImageKeepsLargeStored(t *testing.T) {
	root := newMapImageRoot(t)
	writeTestFile(t, filepath.Join(mapDir(root), "a2.png"), encodeTestPNG(t, 1200, 675))
	downloads := 0
	s := mapImageServer(t, "a2", encodeTestPNG(t, 500, 280), false, &downloads)
	defer s.Close()
	fetchMapImage(context.Background(), root, mapImageClient(s), "a2", "")
	if downloads != 0 {
		t.Fatalf("downloads = %d, want 0", downloads)
	}
}

// TestFetchMapImageReplacesUndecodable — a stored file that cannot be decoded is treated as
// missing and re-downloaded.
func TestFetchMapImageReplacesUndecodable(t *testing.T) {
	root := newMapImageRoot(t)
	writeTestFile(t, filepath.Join(mapDir(root), "a3.png"), []byte("not an image"))
	downloads := 0
	s := mapImageServer(t, "a3", encodeTestPNG(t, 1200, 675), false, &downloads)
	defer s.Close()
	fetchMapImage(context.Background(), root, mapImageClient(s), "a3", "")
	if downloads != 1 {
		t.Fatalf("downloads = %d, want 1", downloads)
	}
	b, err := os.ReadFile(filepath.Join(mapDir(root), "a3.png"))
	if err != nil {
		t.Fatal(err)
	}
	if w, ok := mapImageWidth(b); !ok || w != 1200 {
		t.Fatalf("stored width = %d ok=%v, want 1200", w, ok)
	}
}

// TestFetchMapImageKeepsExistingOnDownloadError — when the download fails, the existing small
// file is kept, not deleted.
func TestFetchMapImageKeepsExistingOnDownloadError(t *testing.T) {
	root := newMapImageRoot(t)
	small := encodeTestPNG(t, 560, 316)
	writeTestFile(t, filepath.Join(mapDir(root), "a4.png"), small)
	downloads := 0
	s := mapImageServer(t, "a4", small, true, &downloads)
	defer s.Close()
	fetchMapImage(context.Background(), root, mapImageClient(s), "a4", "")
	if downloads != 0 {
		t.Fatalf("downloads = %d, want 0", downloads)
	}
	b, err := os.ReadFile(filepath.Join(mapDir(root), "a4.png"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(b, small) {
		t.Fatal("existing small file was changed")
	}
}

// TestFetchMapImageSmallResultNotRetried — an asset whose image only comes back small is kept
// but not re-downloaded within the same process run.
func TestFetchMapImageSmallResultNotRetried(t *testing.T) {
	root := newMapImageRoot(t)
	downloads := 0
	s := mapImageServer(t, "a5", encodeTestPNG(t, 500, 280), false, &downloads)
	defer s.Close()
	api := mapImageClient(s)
	fetchMapImage(context.Background(), root, api, "a5", "")
	fetchMapImage(context.Background(), root, api, "a5", "")
	if downloads != 1 {
		t.Fatalf("downloads = %d, want 1", downloads)
	}
	b, err := os.ReadFile(filepath.Join(mapDir(root), "a5.png"))
	if err != nil {
		t.Fatal(err)
	}
	if w, ok := mapImageWidth(b); !ok || w != 500 {
		t.Fatalf("stored width = %d ok=%v, want 500", w, ok)
	}
}

// TestFetchMapImageReplacesPngWithJpg — when the new image has a different extension, the old
// file is removed only after the new one is written, so the URL lookup serves the new image.
func TestFetchMapImageReplacesPngWithJpg(t *testing.T) {
	root := newMapImageRoot(t)
	dirs := mapDir(root)
	writeTestFile(t, filepath.Join(dirs, "a6.png"), encodeTestPNG(t, 560, 316))
	downloads := 0
	s := mapImageServer(t, "a6", encodeTestJPEG(t, 1200, 675), false, &downloads)
	defer s.Close()
	fetchMapImage(context.Background(), root, mapImageClient(s), "a6", "")
	if downloads != 1 {
		t.Fatalf("downloads = %d, want 1", downloads)
	}
	jpg, err := os.ReadFile(filepath.Join(dirs, "a6.jpg"))
	if err != nil {
		t.Fatal(err)
	}
	if w, ok := mapImageWidth(jpg); !ok || w != 1200 {
		t.Fatalf("jpg width = %d ok=%v, want 1200", w, ok)
	}
	if _, err := os.Stat(filepath.Join(dirs, "a6.png")); !os.IsNotExist(err) {
		t.Fatalf("old png not removed: %v", err)
	}
	if got := storeMapImageURL(root, "a6"); got != "/static/maps/halo_infinite/a6.jpg" {
		t.Fatalf("storeMapImageURL = %q, want the new jpg", got)
	}
}
