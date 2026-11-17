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
