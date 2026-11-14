package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os/exec"
	"runtime"
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

// openOnExisting opens the browser on an address that is already taken by another
// running copy and reports no error: the no-argument run uses it to exit cleanly
// instead of failing with a raw listen error.
func openOnExisting(addr string) error {
	slog.Info("address in use, opening browser on the existing server", "addr", addr)
	if err := openBrowser(urlForAddr(addr)); err != nil {
		slog.Warn("could not open the browser", "err", err)
	}
	return nil
}
