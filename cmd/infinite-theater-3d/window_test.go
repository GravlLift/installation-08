// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// window_test.go — the app window's shared half: the --ui modes and their defaults, the
// external-link rules, and the openWindowUI fallback (a window that cannot be created
// opens the default browser instead). No test opens a real window or a real browser.

import (
	"errors"
	"strings"
	"sync"
	"testing"
)

// errWindowCreateFail stands in for a real window-creation failure; its text is never
// asserted.
var errWindowCreateFail = errors.New("window creation failed")

// withFakeOpenWindow replaces openWindow with a recorder and restores it on test end.
// It returns the recorded URLs and, through the second return, a flag the test can set
// so the fake reports an error on the next open.
func withFakeOpenWindow(t *testing.T) (urls *[]string, fail *bool) {
	t.Helper()
	var mu sync.Mutex
	var rec []string
	var failNext bool
	orig := openWindow
	openWindow = func(u string) error {
		mu.Lock()
		defer mu.Unlock()
		if failNext {
			failNext = false
			return errWindowCreateFail
		}
		rec = append(rec, u)
		return nil
	}
	t.Cleanup(func() {
		mu.Lock()
		defer mu.Unlock()
		openWindow = orig
	})
	return &rec, &failNext
}

// TestDefaultUIFor — the --ui default per OS: the app's own window on Windows, the default
// browser elsewhere.
func TestDefaultUIFor(t *testing.T) {
	if got := defaultUIFor("windows"); got != uiWindow {
		t.Errorf("windows default = %q, want window", got)
	}
	for _, goos := range []string{"linux", "darwin"} {
		if got := defaultUIFor(goos); got != uiBrowser {
			t.Errorf("%s default = %q, want browser", goos, got)
		}
	}
}

// TestParseServeFlagsUI — --ui accepts its two modes and nothing else.
func TestParseServeFlagsUI(t *testing.T) {
	f, err := parseServeFlags(nil)
	if err != nil || f.ui != defaultUI() {
		t.Fatalf("default: ui = %q, err = %v", f.ui, err)
	}
	for _, ui := range []string{uiWindow, uiBrowser} {
		f, err := parseServeFlags([]string{"--ui", ui})
		if err != nil || f.ui != ui {
			t.Fatalf("--ui %s: ui = %q, err = %v", ui, f.ui, err)
		}
	}
	if _, err := parseServeFlags([]string{"--ui", "other"}); err == nil {
		t.Fatal("an unknown --ui value was accepted")
	}
}

// TestExternalURLAllowed — the app window hands only other-site http/https links to the
// default browser.
func TestExternalURLAllowed(t *testing.T) {
	appOrigin := "http://127.0.0.1:8177"
	allowed := map[string]bool{
		// other sites: allowed.
		"https://example.com":        true,
		"https://example.com/a/b":    true,
		"http://other.host:9000/path": true,
		// the app's own origin: navigation stays in the window.
		appOrigin:                   false,
		appOrigin + "/matches":       false,
		"http://127.0.0.1:8177/x":    false,
		// a different port of the same host is a different origin: allowed.
		"http://127.0.0.1:5183":     true,
		// other schemes: refused.
		"javascript:alert(1)":       false,
		"file:///C:/some/file.html": false,
		"blob:http://127.0.0.1:8177/x": false,
		"about:blank":               false,
		// no host: refused.
		"relative/path": false,
	}
	for u, want := range allowed {
		if got := externalURLAllowed(u, appOrigin); got != want {
			t.Errorf("externalURLAllowed(%q) = %v, want %v", u, got, want)
		}
	}
	// with no app origin (the window on a URL without one) same-origin checks do not apply.
	if !externalURLAllowed("http://anyhost:1234", "") {
		t.Error("with no app origin, http links must be allowed")
	}
}

// TestOpenWindowUI — the launch's UI on the server's address, per mode, with the fallback.
func TestOpenWindowUI(t *testing.T) {
	const addr = "127.0.0.1:8177"
	const want = "http://127.0.0.1:8177"

	t.Run("browser mode opens the browser once", func(t *testing.T) {
		urls := withFakeOpenBrowser(t)
		if openWindowUI(uiBrowser, addr) {
			t.Fatal("browser mode must report the window not opened")
		}
		if got := readUrls(urls); len(got) != 1 || got[0] != want {
			t.Fatalf("opened %v, want one on %s", got, want)
		}
	})

	t.Run("window mode opens the window, not the browser", func(t *testing.T) {
		winURLs, _ := withFakeOpenWindow(t)
		browserURLs := withFakeOpenBrowser(t)
		if !openWindowUI(uiWindow, addr) {
			t.Fatal("window mode must report the window opened")
		}
		if got := readUrls(winURLs); len(got) != 1 || got[0] != want {
			t.Fatalf("window opened on %v, want one on %s", got, want)
		}
		if got := readUrls(browserURLs); len(got) != 0 {
			t.Fatalf("browser opened on %v, want nothing", got)
		}
	})

	t.Run("a window that cannot be created falls back to the browser", func(t *testing.T) {
		_, fail := withFakeOpenWindow(t)
		*fail = true
		browserURLs := withFakeOpenBrowser(t)
		if openWindowUI(uiWindow, addr) {
			t.Fatal("a failed window must report the window not opened")
		}
		if got := readUrls(browserURLs); len(got) != 1 || got[0] != want {
			t.Fatalf("fell back to %v, want one browser on %s", got, want)
		}
	})
}

// TestOpenExternalURL — the binding the injected script calls: allowed links go to the
// default browser, refused ones do not.
func TestOpenExternalURL(t *testing.T) {
	appOrigin := "http://127.0.0.1:8177"
	urls := withFakeOpenBrowser(t)
	if err := openExternalURL("https://example.com/x", appOrigin); err != nil {
		t.Fatalf("allowed link refused: %v", err)
	}
	if got := readUrls(urls); len(got) != 1 || got[0] != "https://example.com/x" {
		t.Fatalf("opened %v, want one on the allowed link", got)
	}
	for _, u := range []string{"javascript:alert(1)", appOrigin, appOrigin + "/a", "file:///C:/x.html"} {
		if err := openExternalURL(u, appOrigin); err == nil {
			t.Errorf("refused link %q was opened", u)
		}
	}
	if got := readUrls(urls); len(got) != 1 {
		t.Fatalf("refused links opened the browser %d more time(s)", len(got)-1)
	}
}

// TestExternalLinksJS — the injected script keeps its one guard: it installs once, checks
// the origin, and only http/https leaves for the default browser.
func TestExternalLinksJS(t *testing.T) {
	for _, fragment := range []string{
		"window.__it3dLinks",
		"x.origin === location.origin",
		"x.protocol !== 'http:' && x.protocol !== 'https:'",
		"window.it3dOpenExternal(x.href)",
	} {
		if !strings.Contains(externalLinksJS, fragment) {
			t.Errorf("externalLinksJS missing %q", fragment)
		}
	}
}

// TestRunWindow — the hidden developer command opens the window on its --url and requires
// one.
func TestRunWindow(t *testing.T) {
	if err := runWindow(nil); err == nil {
		t.Fatal("window without --url must fail")
	}
	winURLs, _ := withFakeOpenWindow(t)
	if err := runWindow([]string{"--url", "http://localhost:5183"}); err != nil {
		t.Fatalf("window with --url: %v", err)
	}
	if got := readUrls(winURLs); len(got) != 1 || got[0] != "http://localhost:5183" {
		t.Fatalf("window opened on %v, want one on the given URL", got)
	}
}
