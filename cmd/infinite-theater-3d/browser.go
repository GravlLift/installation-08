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

// isRunningCopy reports whether the server answering on addr is this program: its
// /api/health answers 200 with ok "true". Any other program holding the port fails it.
func isRunningCopy(addr string) bool {
	base := urlForAddr(addr)
	if base == "" {
		return false
	}
	client := http.Client{Timeout: existingCopyTimeout}
	resp, err := client.Get(base + "/api/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	var health struct {
		OK string `json:"ok"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&health) != nil {
		return false
	}
	return health.OK == "true"
}

// openOnExisting handles a listen failure of a run that opens the browser. When the
// address is held by another running copy of this program, it opens the browser on that
// copy and reports no error, so a second double-click exits cleanly. When anything else
// holds the address, it returns the listen error.
func openOnExisting(addr string, listenErr error) error {
	if !isRunningCopy(addr) {
		return fmt.Errorf("listen %s: %w", addr, listenErr)
	}
	slog.Info("already running, opening the browser on the existing server", "addr", addr)
	if err := openBrowser(urlForAddr(addr)); err != nil {
		slog.Warn("could not open the browser", "err", err)
	}
	return nil
}
