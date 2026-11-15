package main

// serve_launch_test.go — the launch order's pieces: the data folder claim (a second claim is
// refused until the first is released, and release leaves no files), the busy-folder path
// (the browser opens on the holder when it serves the viewer), and the busy-port fallback
// (a double-click moves to another port; an address the user named is never replaced).

import (
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestClaimDataDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	first, err := claimDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := claimDataDir(dir); !errors.Is(err, errDataDirBusy) {
		t.Fatalf("second claim: err = %v, want errDataDirBusy", err)
	}
	first.recordAddr("127.0.0.1:1234")
	if got := recordedAddr(dir); got != "127.0.0.1:1234" {
		t.Fatalf("recorded addr = %q", got)
	}
	first.release()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("release left %d files behind", len(entries))
	}
	again, err := claimDataDir(dir)
	if err != nil {
		t.Fatalf("claim after release: %v", err)
	}
	again.release()
}

func TestDataDirBusyOpensHolder(t *testing.T) {
	holder := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"ok": "true", "version": "test", "viewer": "true"})
	}))
	t.Cleanup(holder.Close)
	dir := t.TempDir()
	claim, err := claimDataDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(claim.release)
	addr := holder.Listener.Addr().String()
	claim.recordAddr(addr)
	urls := withFakeOpenBrowser(t)
	if err := onDataDirBusy(dir, true); err != nil {
		t.Fatalf("double-click on a busy folder: %v", err)
	}
	if got := readUrls(urls); len(got) != 1 || got[0] != "http://"+addr {
		t.Fatalf("opened %v, want http://%s", got, addr)
	}
	if err := onDataDirBusy(dir, false); !errors.Is(err, errDataDirBusy) {
		t.Fatalf("serve on a busy folder: err = %v, want errDataDirBusy", err)
	}
}

func TestDataDirBusyNoHolderAddr(t *testing.T) {
	urls := withFakeOpenBrowser(t)
	if err := onDataDirBusy(t.TempDir(), true); !errors.Is(err, errDataDirBusy) {
		t.Fatalf("err = %v, want errDataDirBusy", err)
	}
	if got := readUrls(urls); len(got) != 0 {
		t.Fatalf("opened %v, want nothing", got)
	}
}

func TestListenServeFallback(t *testing.T) {
	busy, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { busy.Close() })
	addr := busy.Addr().String()

	ln, err := listenServe(serveFlags{addr: addr, open: true})
	if err != nil {
		t.Fatalf("double-click on a busy port: %v", err)
	}
	if ln.Addr().String() == addr {
		t.Fatal("fallback listened on the busy address")
	}
	ln.Close()

	if _, err := listenServe(serveFlags{addr: addr, open: true, addrSet: true}); err == nil {
		t.Fatal("an address the user named was replaced")
	}
	if _, err := listenServe(serveFlags{addr: addr}); err == nil {
		t.Fatal("serve without --open moved to another port")
	}
}

func TestParseServeFlagsAddrSet(t *testing.T) {
	f, err := parseServeFlags(nil)
	if err != nil || f.addrSet {
		t.Fatalf("default: addrSet = %v, err = %v", f.addrSet, err)
	}
	f, err = parseServeFlags([]string{"--addr", "127.0.0.1:9000"})
	if err != nil || !f.addrSet {
		t.Fatalf("--addr given: addrSet = %v, err = %v", f.addrSet, err)
	}
}
