package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/weapons"
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

// embeddedViewer is a stand-in for the tree a tagged build embeds.
func embeddedViewer() fstest.MapFS {
	return fstest.MapFS{
		"index.html":    {Data: []byte("<html>embedded</html>")},
		"assets/app.js": {Data: []byte("embedded-js")},
	}
}

// TestEmbeddedSelectionOrder: the --web directory wins over the embedded viewer, the
// embedded viewer answers when no directory is given, and with neither the mux answers.
func TestEmbeddedSelectionOrder(t *testing.T) {
	root := newFakeStore(t)
	dir := t.TempDir()
	writeWebFile(t, dir, "index.html", "<html>dir</html>")

	hDir := newServerHandlers(root, dir, nil, weapons.Catalog{}, testLabelCatalog)
	hDir.webFS = embeddedViewer()
	rec := get(t, hDir, "/", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "dir") {
		t.Fatalf("dir wins: status=%d body=%s", rec.Code, rec.Body.String())
	}

	hEmbedded := newServerHandlers(root, "", nil, weapons.Catalog{}, testLabelCatalog)
	hEmbedded.webFS = embeddedViewer()
	rec = get(t, hEmbedded, "/", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "embedded") {
		t.Fatalf("embedded answers: status=%d body=%s", rec.Code, rec.Body.String())
	}

	hNone := newServerHandlers(root, "", nil, weapons.Catalog{}, testLabelCatalog)
	hNone.webFS = nil
	rec = get(t, hNone, "/", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("no viewer: status=%d, want 404", rec.Code)
	}
}

// TestServeEmbeddedViewer: the embedded viewer answers a named asset with its own
// content, answers index.html for a client route, and leaves the API and the /static/
// routes to the mux.
func TestServeEmbeddedViewer(t *testing.T) {
	root := newFakeStore(t)
	h := newServerHandlers(root, "", nil, weapons.Catalog{}, testLabelCatalog)
	h.webFS = embeddedViewer()

	rec := get(t, h, "/assets/app.js", nil)
	if rec.Code != http.StatusOK || rec.Body.String() != "embedded-js" {
		t.Fatalf("asset: status=%d body=%s", rec.Code, rec.Body.String())
	}
	for _, route := range []string{"/match/abc", "/assets", "/dev/map.glb"} {
		rec = get(t, h, route, nil)
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "embedded") {
			t.Fatalf("client route %s: status=%d body=%s", route, rec.Code, rec.Body.String())
		}
	}
	rec = get(t, h, "/api/health", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "version") {
		t.Fatalf("api priority: status=%d body=%s", rec.Code, rec.Body.String())
	}
}

// TestStaticRoutesStayWithTheMux: a /static/ path is answered by the mux's own routes
// (icons, ranks, sounds), never by the viewer's index.html, with a --web directory and
// with the embedded viewer alike.
func TestStaticRoutesStayWithTheMux(t *testing.T) {
	root := newFakeStore(t)
	dir := t.TempDir()
	writeWebFile(t, dir, "index.html", "<html>dir</html>")
	hDir := newServerHandlers(root, dir, nil, weapons.Catalog{}, testLabelCatalog)
	hEmbedded := newServerHandlers(root, "", nil, weapons.Catalog{}, testLabelCatalog)
	hEmbedded.webFS = embeddedViewer()

	for name, h := range map[string]serverHandlers{"dir": hDir, "embedded": hEmbedded} {
		rec := get(t, h, "/static/sounds/halo_infinite/absent.ogg", nil)
		if rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "<html>") {
			t.Fatalf("%s: status=%d body=%s, want the sound route's 404", name, rec.Code, rec.Body.String())
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

// TestPortInUseOpensExisting: when another running copy holds the address (its health
// route answers), the browser opens on that copy and the run reports no error.
func TestPortInUseOpensExisting(t *testing.T) {
	copyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/health" {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"ok": "true", "version": "test"})
	}))
	t.Cleanup(copyServer.Close)
	addr := copyServer.Listener.Addr().String()
	urls := withFakeOpenBrowser(t)
	if err := openOnExisting(addr, errors.New("address in use")); err != nil {
		t.Fatalf("running copy on the port: %v", err)
	}
	got := readUrls(urls)
	if len(got) != 1 || got[0] != "http://"+addr {
		t.Fatalf("opened on %v, want one open on http://%s", got, addr)
	}
}

// TestPortInUseByAnotherProgram: when something that is not this program holds the
// address, the listen error is returned and no browser opens.
func TestPortInUseByAnotherProgram(t *testing.T) {
	port := freePort(t)
	ln := occupyPort(t, port)
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			conn.Close()
		}
	}()
	urls := withFakeOpenBrowser(t)
	listenErr := errors.New("address in use")
	if err := openOnExisting("127.0.0.1:"+port, listenErr); !errors.Is(err, listenErr) {
		t.Fatalf("err = %v, want the listen error", err)
	}
	if got := readUrls(urls); len(got) != 0 {
		t.Fatalf("opened %v, want no browser open", got)
	}
}
