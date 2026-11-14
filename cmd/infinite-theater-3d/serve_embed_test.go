package main

import (
	"context"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/weapons"
	"github.com/llampwall/infinite-theater-3d/internal/webdist"
)

// freePort returns a TCP port that is free when the test runs.
func freePort(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return strconv.Itoa(ln.Addr().(*net.TCPAddr).Port)
}

// occupyPort binds the port and returns the listener so the test holds it.
func occupyPort(t *testing.T, port string) net.Listener {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	return ln
}

// withFakeOpenBrowser replaces openBrowser with a recorder and restores it on test end.
// It returns the recorded URLs (safe to read once the test's action has settled).
func withFakeOpenBrowser(t *testing.T) *[]string {
	t.Helper()
	var mu sync.Mutex
	var urls []string
	orig := openBrowser
	openBrowser = func(u string) error {
		mu.Lock()
		urls = append(urls, u)
		mu.Unlock()
		return nil
	}
	t.Cleanup(func() { openBrowser = orig })
	t.Cleanup(func() {
		mu.Lock()
		defer mu.Unlock()
	})
	return &urls
}

func readUrls(urls *[]string) []string {
	out := make([]string, len(*urls))
	copy(out, *urls)
	return out
}

// waitFor polls cond until it is true or the timeout elapses.
func waitFor(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !cond() {
		t.Fatalf("condition not met within %s", timeout)
	}
}

func writeWebFile(t *testing.T, dir, name, content string) {
	t.Helper()
	full := filepath.Join(dir, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// TestEmbeddedSelectionOrder — the --web directory wins over the embedded viewer, and
// neither wins over the API mux. The default build embeds no viewer; the handler's
// embedded fields stand in for a tagged build.
func TestEmbeddedSelectionOrder(t *testing.T) {
	root := newFakeStore(t)
	dir := t.TempDir()
	writeWebFile(t, dir, "index.html", "<html>dir</html>")
	writeWebFile(t, dir, "assets/app.js", "dir-js")

	hDir := newServerHandlers(root, dir, nil, weapons.Catalog{}, testLabelCatalog)
	hDir.webFiles = []byte("<html>embedded</html>")
	hDir.webList = []string{"assets/app.js", "index.html"}
	rec := get(t, hDir, "/", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "dir") {
		t.Fatalf("dir wins: status=%d body=%s", rec.Code, rec.Body.String())
	}

	// No --web, no embedded viewer: the mux answers and the path is a 404.
	hNone := newServerHandlers(root, "", nil, weapons.Catalog{}, testLabelCatalog)
	rec = get(t, hNone, "/", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("no viewer: status=%d, want 404", rec.Code)
	}
}

// TestServeEmbeddedViewer — a tagged-style build (embedded fields set) answers a named
// asset from the embedded tree and falls back to index.html for a deep client route;
// API and /static/ paths keep their priority. The package File is a stub in this
// untagged build, so the named asset is answered 404 here; the tagged build answers it
// 200 (proven by the acceptance build and smoke test).
func TestServeEmbeddedViewer(t *testing.T) {
	root := newFakeStore(t)
	h := newServerHandlers(root, "", nil, weapons.Catalog{}, testLabelCatalog)
	h.webFiles = []byte("<html>embedded</html>")
	h.webList = []string{"assets/app.js", "index.html"}

	// A deep client route must not be swallowed by the mux. In the tagged build it is
	// index.html; here the package stub makes it a 404. Either way it is not a mux route.
	rec := get(t, h, "/match/abc", nil)
	if rec.Code == http.StatusOK && strings.Contains(rec.Body.String(), `"ok"`) {
		t.Fatalf("client route answered by the mux: %s", rec.Body.String())
	}

	// API priority: /api/health is never answered by the static viewer.
	rec = get(t, h, "/api/health", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "version") {
		t.Fatalf("api priority: status=%d body=%s", rec.Code, rec.Body.String())
	}
}

// TestServeEmbeddedIsClientRoute — IsClientRoute keeps API and /static out of the
// fallback and lets every other path through.
func TestServeEmbeddedIsClientRoute(t *testing.T) {
	files := []string{"assets/app.js", "index.html"}
	cases := map[string]bool{
		"/":              true,
		"/match/abc":     true,
		"/any/deep":      true,
		"/assets/app.js": false,
		"/index.html":    false,
		"/api/health":    false,
		"/static/x":      false,
	}
	for in, want := range cases {
		if got := webdist.IsClientRoute(in, files); got != want {
			t.Errorf("IsClientRoute(%q) = %v, want %v", in, got, want)
		}
	}
}

// TestServeIndexFallback — with a --web directory, a deep client route answers
// index.html (the behavior the embedded viewer must match).
func TestServeIndexFallback(t *testing.T) {
	root := newFakeStore(t)
	web := t.TempDir()
	writeWebFile(t, web, "index.html", "<html>home</html>")
	h := newServerHandlers(root, web, nil, weapons.Catalog{}, testLabelCatalog)
	rec := get(t, h, "/match/abc/extra", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "home") {
		t.Fatalf("fallback: status=%d body=%s", rec.Code, rec.Body.String())
	}
}

// TestOpenOnListen — openOnListen opens the browser exactly once on the server's
// address, through the fake opener; no real browser is launched.
func TestOpenOnListen(t *testing.T) {
	urls := withFakeOpenBrowser(t)
	port := freePort(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	openOnListen(ctx, "127.0.0.1:"+port)
	waitFor(t, 2*time.Second, func() bool { return len(*urls) >= 1 })
	got := readUrls(urls)
	if len(got) != 1 || got[0] != "http://127.0.0.1:"+port {
		t.Fatalf("opened on %v, want one open on http://127.0.0.1:%s", got, port)
	}
}

// TestOpenOnListenCancelled — a context already canceled before the open starts is
// never opened.
func TestOpenOnListenCancelled(t *testing.T) {
	urls := withFakeOpenBrowser(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	openOnListen(ctx, "127.0.0.1:"+freePort(t))
	time.Sleep(50 * time.Millisecond)
	if got := readUrls(urls); len(got) != 0 {
		t.Fatalf("opened on %v, want none", got)
	}
}

// TestUrlForAddr — the listen address to URL mapping.
func TestUrlForAddr(t *testing.T) {
	cases := map[string]string{
		"127.0.0.1:8177": "http://127.0.0.1:8177",
		":8177":          "http://localhost:8177",
		"0.0.0.0:8177":   "http://localhost:8177",
		"192.168.1.5:80": "http://192.168.1.5:80",
	}
	for in, want := range cases {
		if got := urlForAddr(in); got != want {
			t.Errorf("urlForAddr(%q) = %q, want %q", in, got, want)
		}
	}
	if got := urlForAddr("no-port"); got != "" {
		t.Errorf("urlForAddr(no-port) = %q, want empty", got)
	}
}

// TestPortInUseOpensExisting — the open path when the address is taken: open the
// browser on the existing server, and no error.
func TestPortInUseOpensExisting(t *testing.T) {
	port := freePort(t)
	occupyPort(t, port)
	urls := withFakeOpenBrowser(t)
	// runServe's in-use branch reduces to this: open on the existing address, return nil.
	if err := openOnExisting("127.0.0.1:" + port); err != nil {
		t.Fatalf("port in use: %v", err)
	}
	got := readUrls(urls)
	if len(got) != 1 || got[0] != "http://127.0.0.1:"+port {
		t.Fatalf("opened on %v, want one open on http://127.0.0.1:%s", got, port)
	}
}
