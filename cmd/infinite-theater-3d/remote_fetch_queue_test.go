package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
	"github.com/llampwall/infinite-theater-3d/internal/haloauth"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// TestRemoteFetchQueue covers the FIFO fetch queue: three ids queued at once keep their
// order, positions update as the queue advances, a queued id gets no duplicate entry, and
// a failed id may be queued again. The fake fetch blocks on a per-id channel, so the test
// controls exactly when each download ends.
func TestRemoteFetchQueue(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := newServerHandlers(root, "", nil, weapons.Catalog{}, testLabelCatalog)
	h.remote.client = func(context.Context) (*haloapi.Client, haloauth.Credentials, error) {
		return nil, haloauth.Credentials{}, nil
	}
	// Every gate exists before any POST: a fetch that started before its gate was created
	// would block on a nil channel forever.
	gates := map[string]chan struct{}{
		"a": make(chan struct{}),
		"b": make(chan struct{}),
		"c": make(chan struct{}),
	}
	var orderMu sync.Mutex
	order := []string{}
	h.remote.fetch = func(_ context.Context, _ *store.Root, _ *haloapi.Client, id string, progress fetchProgress) error {
		orderMu.Lock()
		order = append(order, id)
		orderMu.Unlock()
		progress("downloading", 0, 1)
		<-gates[id]
		if id == "b" {
			return errors.New("boom")
		}
		return nil
	}
	post := func(id string) fetchSnapshot {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("POST", "/api/matches/"+id+"/fetch", nil))
		if r.Code != http.StatusAccepted {
			t.Fatal(id, r.Code, r.Body.String())
		}
		var s fetchSnapshot
		if json.Unmarshal(r.Body.Bytes(), &s) != nil {
			t.Fatal(r.Body.String())
		}
		return s
	}
	state := func(id string) fetchSnapshot {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", "/api/matches/"+id+"/fetch/state", nil))
		var s fetchSnapshot
		if json.Unmarshal(r.Body.Bytes(), &s) != nil {
			t.Fatal(r.Body.String())
		}
		return s
	}
	// waitForState polls until the id's state contains want.
	waitForState := func(id, want string) {
		deadline := time.Now().Add(5 * time.Second)
		for {
			s := state(id)
			if strings.Contains(s.State, want) {
				return
			}
			if time.Now().After(deadline) {
				t.Fatal("waiting for", want, "got", id, s)
			}
			time.Sleep(time.Millisecond)
		}
	}

	// Queue three ids at once; each 202 carries its position.
	if s := post("a"); s.State != "queued" || s.Position != 1 {
		t.Fatal(s)
	}
	if s := post("b"); s.State != "queued" || s.Position != 2 {
		t.Fatal(s)
	}
	if s := post("c"); s.State != "queued" || s.Position != 3 {
		t.Fatal(s)
	}
	// Fetching a queued id again answers 202 and adds no duplicate to the queue.
	if s := post("a"); s.State != "queued" && s.State != "downloading" {
		t.Fatal(s)
	}
	// a downloads first; while it runs, b is queued position 2 and c position 3.
	waitForState("a", "downloading")
	if s := state("b"); s.State != "queued" || s.Position != 2 {
		t.Fatal(s)
	}
	if s := state("c"); s.State != "queued" || s.Position != 3 {
		t.Fatal(s)
	}
	close(gates["a"])
	waitForState("a", "ready")
	// b now runs; behind it c is queued position 2.
	waitForState("b", "downloading")
	if s := state("c"); s.State != "queued" || s.Position != 2 {
		t.Fatal(s)
	}
	close(gates["b"])
	waitForState("b", "failed")
	if s := state("b"); s.Error == "" {
		t.Fatal(s)
	}
	// c ran after b; positions stayed FIFO throughout.
	close(gates["c"])
	waitForState("c", "ready")
	// A failed id may be queued again; it goes to the back and runs in order.
	if s := post("b"); s.State != "queued" || s.Position != 1 {
		t.Fatal(s)
	}
	gates["b"] = make(chan struct{})
	waitForState("b", "downloading")
	close(gates["b"])
	waitForState("b", "failed")

	orderMu.Lock()
	got := strings.Join(order, ",")
	orderMu.Unlock()
	if got != "a,b,c,b" {
		t.Fatal("fetch order:", got)
	}
}
