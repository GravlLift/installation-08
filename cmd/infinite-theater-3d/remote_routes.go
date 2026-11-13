package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"sync"

	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
	"github.com/llampwall/infinite-theater-3d/internal/haloauth"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

type fetchSnapshot struct {
	State   string `json:"state"`
	MatchID string `json:"matchId,omitempty"`
	Done    int    `json:"done"`
	Total   int    `json:"total"`
	Error   string `json:"error,omitempty"`
}
type remoteJobs struct {
	mu     sync.Mutex
	active bool
	states map[string]fetchSnapshot
}

func (h serverHandlers) authState(w http.ResponseWriter, r *http.Request) {
	raw, err := haloauth.Load(h.root.Dir())
	if err != nil {
		writeJSON(w, 200, map[string]any{"signedIn": false})
		return
	}
	var c haloauth.Credentials
	if json.Unmarshal(raw, &c) != nil || c.Refresh == "" {
		writeJSON(w, 200, map[string]any{"signedIn": false})
		return
	}
	writeJSON(w, 200, map[string]any{"signedIn": true, "gamertag": c.Gamertag})
}
func (h serverHandlers) remoteMatches(w http.ResponseWriter, r *http.Request) {
	count := 10
	if s := r.URL.Query().Get("count"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > 25 {
			writeJSON(w, 400, map[string]string{"error": "invalid count"})
			return
		}
		count = n
	}
	api, t, err := apiClient(r.Context(), h.root.Dir())
	if err != nil {
		writeJSON(w, 401, map[string]string{"error": "sign in required"})
		return
	}
	matches, err := api.Matches(r.Context(), t.XUID, count)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": "match history unavailable"})
		return
	}
	writeJSON(w, 200, matches)
}
func (h serverHandlers) startFetch(w http.ResponseWriter, r *http.Request) {
	if !originAllowed(r) {
		writeJSON(w, 403, map[string]string{"error": "origin_not_allowed"})
		return
	}
	id := r.PathValue("id")
	if !store.MatchIDValid(id) {
		writeJSON(w, 400, map[string]string{"error": "invalid match id"})
		return
	}
	j := h.remote
	j.mu.Lock()
	if j.active {
		j.mu.Unlock()
		writeJSON(w, http.StatusConflict, map[string]string{"error": "fetch already in progress"})
		return
	}
	j.active = true
	if j.states == nil {
		j.states = make(map[string]fetchSnapshot)
	}
	state := fetchSnapshot{State: "queued", MatchID: id}
	j.states[id] = state
	j.mu.Unlock()
	go h.runRemoteFetch(id)
	writeJSON(w, http.StatusAccepted, state)
}
func (h serverHandlers) runRemoteFetch(id string) {
	j := h.remote
	update := func(state string, done, total int) {
		j.mu.Lock()
		j.states[id] = fetchSnapshot{State: state, MatchID: id, Done: done, Total: total}
		j.mu.Unlock()
	}
	api, _, err := apiClient(context.Background(), h.root.Dir())
	if err == nil {
		update("downloading", 0, 0)
		err = fetchMatch(context.Background(), h.root, api, id, update)
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	s := j.states[id]
	if err != nil {
		s.State = "failed"
		s.Error = "fetch failed"
		var gone *haloapi.FilmUnavailableError
		if errors.As(err, &gone) {
			s.Error = "film not available"
		}
	} else {
		s.State = "ready"
	}
	j.states[id] = s
	j.active = false
}
func (h serverHandlers) fetchState(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !store.MatchIDValid(id) {
		writeJSON(w, 400, map[string]string{"error": "invalid match id"})
		return
	}
	h.remote.mu.Lock()
	s, ok := h.remote.states[id]
	h.remote.mu.Unlock()
	if !ok {
		s = fetchSnapshot{State: "idle", MatchID: id}
	}
	writeJSON(w, 200, s)
}
