// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"time"
)

// openBrowser opens url in the default browser. It is a variable so tests replace it
// with a fake; no test ever launches a real browser.
var openBrowser = func(url string) error {
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	} else if runtime.GOOS == "darwin" {
		cmd = exec.Command("open", url)
	} else {
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("open browser: %w", err)
	}
	return nil
}

// urlForAddr turns a listen address into the browser URL. The empty host (bind on all
// interfaces) and the wildcard addresses become localhost; a host that is not a valid
// IP literal is passed through (localhost, a hostname); an IPv6 literal is kept in
// brackets so the port delimiter stays unambiguous.
func urlForAddr(addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil || port == "" {
		return ""
	}
	ip := net.ParseIP(host)
	switch {
	case host == "", host == "0.0.0.0" || (ip != nil && ip.IsUnspecified()):
		host = "localhost"
	case ip != nil && ip.To4() == nil:
		host = "[" + host + "]"
	}
	return "http://" + host + ":" + port
}

// openOnListen opens the browser on the server's address once it starts listening. It
// returns immediately; the open runs in its own goroutine and is skipped when the
// context is done before the open starts.
func openOnListen(ctx context.Context, addr string) {
	url := urlForAddr(addr)
	if url == "" {
		slog.Warn("could not derive a browser URL from the listen address", "addr", addr)
		return
	}
	go func() {
		select {
		case <-ctx.Done():
			return
		default:
		}
		if err := openBrowser(url); err != nil {
			slog.Warn("could not open the browser", "err", err)
		}
	}()
}

// existingCopyTimeout bounds the health probe of the address a listen failed on.
const existingCopyTimeout = 2 * time.Second

// isRunningCopy reports whether the server answering on addr is this program (its
// /api/health answers 200 with ok "true"; any other program holding the port fails it) and
// whether that copy serves the viewer. A copy older than the "viewer" field counts as
// serving it, as every packaged build does.
func isRunningCopy(addr string) (running, viewer bool) {
	base := urlForAddr(addr)
	if base == "" {
		return false, false
	}
	client := http.Client{Timeout: existingCopyTimeout}
	resp, err := client.Get(base + "/api/health")
	if err != nil {
		return false, false
	}
	defer resp.Body.Close()
	var health struct {
		OK     string `json:"ok"`
		Viewer string `json:"viewer"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&health) != nil {
		return false, false
	}
	return health.OK == "true", health.Viewer != "false"
}

// openWindowUI opens a launch's UI on the server's address: the app window in window
// mode, the default browser in browser mode. When the window cannot be created it logs a
// warning and falls back to the browser exactly as browser mode does. It reports whether
// the app window was opened and then closed (the server should stop with it).
func openWindowUI(ui, addr string) bool {
	url := urlForAddr(addr)
	if url == "" {
		slog.Warn("could not derive a browser URL from the listen address", "addr", addr)
		return false
	}
	if ui == uiWindow {
		if err := openWindow(url); err != nil {
			slog.Warn("could not open the app window; falling back to the default browser", "err", err)
		} else {
			return true
		}
	}
	if err := openBrowser(url); err != nil {
		slog.Warn("could not open the browser", "err", err)
	}
	return false
}

// openOnExisting handles a listen failure of a run that opens the UI. When the address is
// held by another running copy of this program that serves the viewer, it opens the
// launch's UI (the app window in window mode, the default browser in browser mode) on
// that copy and reports no error, so a second double-click exits cleanly. A copy without
// the viewer (a development server) or anything else holding the address returns an error
// naming the way out, and no UI opens on a page that 404s.
func openOnExisting(addr string, listenErr error, ui string) error {
	running, viewer := isRunningCopy(addr)
	if !running {
		return fmt.Errorf("listen %s: %w", addr, listenErr)
	}
	if !viewer {
		return fmt.Errorf("%s is held by another copy of this program that does not serve the viewer (a development server); stop it, or start this one with --addr 127.0.0.1:<another port>", addr)
	}
	slog.Info("already running, opening the UI on the existing server", "addr", addr)
	openWindowUI(ui, addr)
	return nil
}
