// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestClientLogWritesWarning: a viewer error posted to /api/client-log lands in the server log
// as a "viewer error" warning with its fields; a malformed body is refused.
func TestClientLogWritesWarning(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	clientLogLimit = clientLogLimiter{}

	body := `{"kind":"load-stalled","message":"no progress for 120 s","detail":"phase=decode","page":"#/matches/abc"}`
	rec := httptest.NewRecorder()
	handleClientLog(rec, httptest.NewRequest(http.MethodPost, "/api/client-log", strings.NewReader(body)))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status=%d, want 204", rec.Code)
	}
	out := buf.String()
	for _, want := range []string{`msg="viewer error"`, "kind=load-stalled", "phase=decode", "#/matches/abc"} {
		if !strings.Contains(out, want) {
			t.Fatalf("log %q lacks %q", out, want)
		}
	}

	rec = httptest.NewRecorder()
	handleClientLog(rec, httptest.NewRequest(http.MethodPost, "/api/client-log", strings.NewReader("not json")))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("malformed: status=%d, want 400", rec.Code)
	}
}

// TestClientLogLimiter: at most clientLogPerMinute entries a minute; the refused count is
// reported once when the next minute opens.
func TestClientLogLimiter(t *testing.T) {
	var l clientLogLimiter
	t0 := time.Unix(1_000_000, 0)
	for i := 0; i < clientLogPerMinute; i++ {
		if ok, _ := l.allow(t0); !ok {
			t.Fatalf("entry %d refused inside the cap", i)
		}
	}
	if ok, _ := l.allow(t0.Add(time.Second)); ok {
		t.Fatal("entry over the cap allowed")
	}
	ok, dropped := l.allow(t0.Add(time.Minute))
	if !ok || dropped != 1 {
		t.Fatalf("next minute: ok=%v dropped=%d, want true 1", ok, dropped)
	}
}
