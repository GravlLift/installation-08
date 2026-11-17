package main

// window.go — the shared half of the app window: the --ui flag's modes, the external-link
// rules, and the hidden `window` developer command. The window itself (a WebView2
// runtime on Windows) lives in window_windows.go; on the other systems openWindow is a
// stub that errors, so a launch falls back to the default browser.

import (
	"errors"
	"flag"
	"fmt"
	"net/url"
	"runtime"
)

// uiMode is what a launch opens on a double-click: the app's own window, or the default
// browser.
const (
	uiWindow  = "window"
	uiBrowser = "browser"
)

// defaultUIFor is the --ui default for an OS: the app's own window on Windows (the
// WebView2 runtime ships with the system), the default browser elsewhere.
func defaultUIFor(goos string) string {
	if goos == "windows" {
		return uiWindow
	}
	return uiBrowser
}

// defaultUI is this machine's --ui default.
func defaultUI() string { return defaultUIFor(runtime.GOOS) }

// originOf is the scheme://host of a URL ("" when it has no host, as a relative one).
func originOf(u string) string {
	p, err := url.Parse(u)
	if err != nil || p.Host == "" {
		return ""
	}
	return p.Scheme + "://" + p.Host
}

// externalURLAllowed reports whether the app window may hand u to the user's default
// browser: http and https only, and never the app's own origin (same-origin navigation
// stays in the window).
func externalURLAllowed(u, appOrigin string) bool {
	p, err := url.Parse(u)
	if err != nil {
		return false
	}
	if p.Scheme != "http" && p.Scheme != "https" {
		return false
	}
	if p.Host == "" {
		return false
	}
	if appOrigin != "" && p.Scheme+"://"+p.Host == appOrigin {
		return false
	}
	return true
}

// openExternalURL is the Go function the app window's injected script calls for links to
// other sites: it validates the URL and hands it to the default browser.
func openExternalURL(u, appOrigin string) error {
	if !externalURLAllowed(u, appOrigin) {
		return fmt.Errorf("refusing to open %q in the default browser", u)
	}
	return openBrowser(u)
}

// externalLinksJS is injected at every page load in the app window: clicks on anchors
// whose origin differs from the page's, and window.open calls with such URLs, are handed
// to the default browser through the it3dOpenExternal binding; same-origin navigation and
// every other scheme (blob:, data:, a download URL) stay in the window.
const externalLinksJS = `(function () {
  if (window.__it3dLinks) return;
  window.__it3dLinks = true;
  function toDefaultBrowser(u) {
    var x;
    try { x = new URL(u, location.href); } catch (e) { return false; }
    if (x.origin === location.origin) return false;
    if (x.protocol !== 'http:' && x.protocol !== 'https:') return false;
    window.it3dOpenExternal(x.href);
    return true;
  }
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    var a = t && t.closest ? t.closest('a[href]') : null;
    if (!a) return;
    if (toDefaultBrowser(a.href)) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }, true);
  var open = window.open;
  window.open = function () {
    if (arguments.length > 0 && toDefaultBrowser(String(arguments[0]))) return null;
    return open.apply(this, arguments);
  };
})();`

// runWindow is the hidden developer command: open the app window on a URL, with no server
// (for testing against a dev server). It is not in the usage text.
func runWindow(args []string) error {
	fs := flag.NewFlagSet("window", flag.ContinueOnError)
	url := fs.String("url", "", "URL to open in the app window (no server)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *url == "" {
		return errors.New("window requires --url <url>")
	}
	if err := openWindow(*url); err != nil {
		return fmt.Errorf("app window: %w", err)
	}
	return nil
}
