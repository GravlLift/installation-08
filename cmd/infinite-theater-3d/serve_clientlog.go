// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// The viewer's errors land in server.log through POST /api/client-log. A failure in the page
// (an uncaught exception, a rejected promise nobody handled, a match load that failed or stopped
// making progress) otherwise lives only in the window's devtools, which a tester never opens: the
// test.18/test.19 meshopt hang left server.log clean while every match spun forever.

const (
	clientLogMaxBody   = 16 << 10
	clientLogMaxField  = 2000
	clientLogPerMinute = 60
)

type clientLogEntry struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
	Detail  string `json:"detail"`
	Page    string `json:"page"`
}

// clientLogLimiter caps how many entries a minute reach the log, so a page throwing in a render
// loop cannot fill the disk.
type clientLogLimiter struct {
	mu      sync.Mutex
	window  time.Time
	count   int
	dropped int
}

var clientLogLimit clientLogLimiter

// allow says whether one more entry may be logged now; dropped is how many the previous minute
// refused, reported once when a new minute opens.
func (l *clientLogLimiter) allow(now time.Time) (ok bool, dropped int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if now.Sub(l.window) >= time.Minute {
		dropped = l.dropped
		l.window, l.count, l.dropped = now, 0, 0
	}
	if l.count >= clientLogPerMinute {
		l.dropped++
		return false, dropped
	}
	l.count++
	return true, dropped
}

func truncateField(s string) string {
	if len(s) <= clientLogMaxField {
		return s
	}
	return s[:clientLogMaxField] + "…"
}

func handleClientLog(w http.ResponseWriter, r *http.Request) {
	var e clientLogEntry
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, clientLogMaxBody)).Decode(&e); err != nil {
		http.Error(w, "bad client log entry", http.StatusBadRequest)
		return
	}
	ok, dropped := clientLogLimit.allow(time.Now())
	if dropped > 0 {
		slog.Warn("viewer errors dropped", "count", dropped)
	}
	if ok {
		slog.Warn("viewer error",
			"kind", truncateField(e.Kind),
			"message", truncateField(e.Message),
			"detail", truncateField(e.Detail),
			"page", truncateField(e.Page),
		)
	}
	w.WriteHeader(http.StatusNoContent)
}
