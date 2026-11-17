package main

// serve_launch.go — the launch order of `serve`: claim the data folder, then an address, and
// only then touch the data (store, builds, coatings setup). A launch that cannot claim the
// data folder or an address exits before it writes anything, so a second double-click never
// starts a second set of builds or a second coatings setup beside the first copy (one once
// began a setup and quit halfway, leaving its temporary export behind).

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// errDataDirBusy: another running server holds the data folder.
var errDataDirBusy = errors.New("another copy of Installation 08 is using this data folder")

const (
	// serverLockName is the file a running server holds open exclusively in its data folder.
	// The operating system releases it when the process ends, even when it is killed.
	serverLockName = "server.lock"
	// serverAddrName records the address the holder serves on, so a second launch can open
	// the browser on it.
	serverAddrName = "server.addr"
	// fallbackPorts is how many ports after the default a double-click launch tries when the
	// default is held by another program, before it takes any free port.
	fallbackPorts = 20
)

// dataDirClaim is a server's hold on its data folder.
type dataDirClaim struct {
	dir  string
	lock io.Closer
}

// claimDataDir creates the data folder if needed and takes its server lock; errDataDirBusy
// when another running server holds it.
func claimDataDir(dir string) (*dataDirClaim, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("data folder: %w", err)
	}
	lock, err := lockFile(filepath.Join(dir, serverLockName))
	if err != nil {
		return nil, err
	}
	return &dataDirClaim{dir: dir, lock: lock}, nil
}

// recordAddr writes the address this server listens on beside its lock.
func (c *dataDirClaim) recordAddr(addr string) {
	if err := os.WriteFile(filepath.Join(c.dir, serverAddrName), []byte(addr), 0o644); err != nil {
		slog.Warn("could not record the server address", "err", err)
	}
}

// release removes the address record and lets go of the lock (and its file).
func (c *dataDirClaim) release() {
	_ = os.Remove(filepath.Join(c.dir, serverAddrName))
	_ = c.lock.Close()
	_ = os.Remove(filepath.Join(c.dir, serverLockName))
}

// recordedAddr reads the address the data folder's holder recorded ("" when none).
func recordedAddr(dir string) string {
	b, err := os.ReadFile(filepath.Join(dir, serverAddrName))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// onDataDirBusy handles a launch whose data folder another server holds. With open (a
// double-click), when the holder is reachable and serves the viewer, the launch's UI
// (the app window in window mode, the default browser in browser mode) opens on it and
// the launch exits cleanly; otherwise the error says what holds the folder.
func onDataDirBusy(dir string, open bool, ui string) error {
	busy := fmt.Errorf("%w (%s): close its window first, or start this one with --data <another folder>", errDataDirBusy, dir)
	addr := recordedAddr(dir)
	if addr == "" {
		return busy
	}
	if !open {
		return fmt.Errorf("%w; it serves on http://%s", busy, addr)
	}
	return openOnExisting(addr, busy, ui)
}

// listenServe takes the server's address. When the default address is held by another
// program (or a copy of this one serving another data folder) and the launch is a
// double-click (open, no --addr given), it serves on the next free port instead; an address
// the user named is never replaced.
func listenServe(f serveFlags) (net.Listener, error) {
	ln, err := net.Listen("tcp", f.addr)
	if err == nil {
		return ln, nil
	}
	if !f.open || f.addrSet {
		return nil, fmt.Errorf("listen %s: %w", f.addr, err)
	}
	host, portText, splitErr := net.SplitHostPort(f.addr)
	port, atoiErr := strconv.Atoi(portText)
	if splitErr != nil || atoiErr != nil {
		return nil, fmt.Errorf("listen %s: %w", f.addr, err)
	}
	candidates := make([]string, 0, fallbackPorts+1)
	for p := port + 1; p <= port+fallbackPorts && p < 65536; p++ {
		candidates = append(candidates, net.JoinHostPort(host, strconv.Itoa(p)))
	}
	candidates = append(candidates, net.JoinHostPort(host, "0"))
	for _, c := range candidates {
		if alt, altErr := net.Listen("tcp", c); altErr == nil {
			slog.Info("the default port is in use by another program; serving on another port", "busy", f.addr, "addr", alt.Addr().String())
			return alt, nil
		}
	}
	return nil, fmt.Errorf("listen %s: %w (and no free port nearby)", f.addr, err)
}
