package main

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"sync"

	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
	"github.com/llampwall/infinite-theater-3d/internal/haloauth"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
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
	client func(context.Context) (*haloapi.Client, haloauth.Credentials, error)
	fetch  func(context.Context, *store.Root, *haloapi.Client, string, fetchProgress) error
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
	api, t, err := h.remote.client(r.Context())
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
	api, _, err := j.client(context.Background())
	if err == nil {
		update("downloading", 0, 0)
		err = j.fetch(context.Background(), h.root, api, id, update)
		if err == nil {
			// The fetch route is where the server learns about a match added while it runs:
			// the new match's map mesh and variant layer join the build queue here, through
			// the runner's own readiness checks.
			h.enqueueMatchBuilds(id)
		}
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

// newServerHandlers builds the server: the API routes on a mux, wrapped by the static
// fallback. It returns the concrete handler (which implements http.Handler) so a test can
// drive the routes directly as well as through the full server.
func newServerHandlers(root *store.Root, web string, jobs *meshjobs.Runner, weaponKeys weapons.Catalog,
	labelCat weapons.LabelCatalog,
) serverHandlers {
	var authMu sync.Mutex
	h := serverHandlers{root: root, web: web, jobs: jobs, weapKeys: weaponKeys, labelCat: labelCat, auth: &authSession{steps: defaultLoginFlow(root.Dir())}, remote: &remoteJobs{client: func(ctx context.Context) (*haloapi.Client, haloauth.Credentials, error) {
		authMu.Lock()
		defer authMu.Unlock()
		return apiClient(ctx, root.Dir())
	}, fetch: fetchMatch}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/auth/state", h.authStateRoute)
	mux.HandleFunc("POST /api/auth/login", h.runLoginRoute)
	mux.HandleFunc("POST /api/auth/logout", h.authLogoutRoute)
	mux.HandleFunc("GET /api/remote/matches", h.remoteMatches)
	mux.HandleFunc("POST /api/matches/{id}/fetch", h.startFetch)
	mux.HandleFunc("GET /api/matches/{id}/fetch/state", h.fetchState)
	mux.HandleFunc("GET /api/health", h.handleHealth)
	mux.HandleFunc("GET /api/matches", h.handleMatches)
	mux.HandleFunc("GET /api/matches/{id}/replay", h.handleReplay)
	mux.HandleFunc("GET /api/matches/{id}/context", h.handleContext)
	mux.HandleFunc("GET /api/matches/{id}/mesh.glb", h.handleMesh)
	mux.HandleFunc("GET /api/matches/{id}/mesh/state", h.handleMeshState)
	mux.HandleFunc("POST /api/matches/{id}/mesh/build", h.handleMeshBuild)
	mux.HandleFunc("GET /api/matches/{id}/variant.glb", h.handleVariant)
	mux.HandleFunc("GET /api/matches/{id}/variant/state", h.handleVariantState)
	mux.HandleFunc("POST /api/matches/{id}/variant/build", h.handleVariantBuild)
	mux.HandleFunc("GET /api/weapons", h.handleWeaponIndex)
	mux.HandleFunc("GET /api/weapons/state", h.handleWeaponState)
	mux.HandleFunc("POST /api/weapons/build", h.handleWeaponBuild)
	mux.HandleFunc("GET /api/weapons/{file}", h.handleWeaponModel)
	mux.HandleFunc("GET /api/first-person/index.json", h.handleFirstPersonIndex)
	mux.HandleFunc("GET /api/first-person/bras.json", h.handleFirstPersonBras)
	mux.HandleFunc("GET /api/first-person/state", h.handleFirstPersonState)
	mux.HandleFunc("POST /api/first-person/build", h.handleFirstPersonBuild)
	mux.HandleFunc("GET /api/first-person/{file}", h.handleFirstPersonFile)
	mux.HandleFunc("GET /static/weapons-assets/halo_infinite/jeu/{file}", h.handleWeaponIconFile)
	mux.HandleFunc("GET /static/weapons-assets/halo_infinite/hud/{file}", h.handleHudIconFile)
	mux.HandleFunc("GET /static/ranks/halo_infinite/{file}", h.handleRankIconFile)
	mux.HandleFunc("GET /static/sounds/halo_infinite/{file}", h.handleSoundFile)
	h.mux = mux
	return h
}
