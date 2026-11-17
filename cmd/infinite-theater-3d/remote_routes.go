// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
	"github.com/llampwall/infinite-theater-3d/internal/haloauth"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
	"github.com/llampwall/infinite-theater-3d/internal/webdist"
)

type fetchSnapshot struct {
	State   string `json:"state"`
	MatchID string `json:"matchId,omitempty"`
	Done    int    `json:"done"`
	Total   int    `json:"total"`
	Error   string `json:"error,omitempty"`
	// Position is the 1-based place a queued id has in the FIFO queue (1 = next);
	// zero and omitted for every non-queued state.
	Position int `json:"position,omitempty"`
}
type remoteJobs struct {
	mu sync.Mutex
	// queue is the FIFO of queued match ids; the head is fetched when it becomes free.
	// Fetches run one at a time: one runner drains the queue, the rest wait in it.
	queue  []string
	states map[string]fetchSnapshot
	client func(context.Context) (*haloapi.Client, haloauth.Credentials, error)
	fetch  func(context.Context, *store.Root, *haloapi.Client, string, fetchProgress) error
}

func (h serverHandlers) remoteMatches(w http.ResponseWriter, r *http.Request) {
	if h.readOnly {
		// A shared server answers as if signed out, so it never reaches the owner's account.
		writeJSON(w, 401, map[string]string{"error": "sign in required"})
		return
	}
	count := 10
	if s := r.URL.Query().Get("count"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > 25 {
			writeJSON(w, 400, map[string]string{"error": "invalid count"})
			return
		}
		count = n
	}
	gamertag, searched := r.URL.Query().Get("gamertag"), r.URL.Query().Has("gamertag")
	if searched {
		gamertag = strings.TrimSpace(gamertag)
		if !gamertagValid(gamertag) {
			writeJSON(w, 400, map[string]string{"error": "invalid gamertag"})
			return
		}
	}
	api, t, err := h.remote.client(r.Context())
	if err != nil {
		writeJSON(w, 401, map[string]string{"error": "sign in required"})
		return
	}
	// Default: the signed-in account's own history. With ?gamertag=, any player's (the
	// service's match history and films are public across players).
	xuid := t.XUID
	if searched {
		xuid, err = api.XUIDForGamertag(r.Context(), gamertag)
		var notFound *haloapi.GamertagNotFoundError
		if errors.As(err, &notFound) {
			writeJSON(w, 404, map[string]string{"error": "gamertag not found"})
			return
		}
		if err != nil {
			writeJSON(w, 502, map[string]string{"error": "player lookup unavailable"})
			return
		}
	}
	matches, err := api.Matches(r.Context(), xuid, count)
	if err != nil {
		writeJSON(w, 502, map[string]string{"error": "match history unavailable"})
		return
	}
	writeJSON(w, 200, remoteMatchesWithImages(h.root, matches))
	// The response is out; now fetch the missing map pictures in the background so the
	// next list request (the page follows up when a row came back without its image)
	// finds them stored.
	h.startMapImageDownloads(api, matches)
}

// gamertagValid is a loose check on a searched gamertag before it reaches the service:
// 1 to 16 characters (a modern gamertag is up to 12 plus a "#1234" suffix, a classic one up
// to 15), letters (any script), digits, spaces and '#'. The service has the final word.
func gamertagValid(gt string) bool {
	n := 0
	for _, r := range gt {
		n++
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != ' ' && r != '#' {
			return false
		}
	}
	return n >= 1 && n <= 16
}

var (
	mapImageFlightMu sync.Mutex
	mapImageInFlight = map[string]bool{} // asset ids whose image download is running
)

// startMapImageDownloads downloads the map image for each listed match whose image is not
// stored yet, in the background and once per asset while a download is in flight. It never
// blocks the caller: the list response has already been written.
func (h serverHandlers) startMapImageDownloads(api *haloapi.Client, matches []haloapi.Match) {
	seen := map[string]bool{}
	for _, m := range matches {
		id := m.MapAssetID
		if id == "" || seen[id] || m.MapImageURL != "" {
			continue
		}
		seen[id] = true
		go downloadListedMapImage(h.root, api, id, m.MapAssetVersion)
	}
}

func downloadListedMapImage(root *store.Root, api *haloapi.Client, assetID, version string) {
	mapImageFlightMu.Lock()
	if mapImageInFlight[assetID] {
		mapImageFlightMu.Unlock()
		return
	}
	mapImageInFlight[assetID] = true
	mapImageFlightMu.Unlock()
	defer func() {
		mapImageFlightMu.Lock()
		delete(mapImageInFlight, assetID)
		mapImageFlightMu.Unlock()
	}()
	// A detached context with its own deadline, never the list request's (which is
	// already done and must not be cancelled or cancel this).
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	fetchMapImage(ctx, root, api, assetID, version)
}

// remoteMatchesWithImages adds the stored map image URL to each remote match entry (empty
// when the image is not on disk): no extra network request, just a stat of the local file.
func remoteMatchesWithImages(root *store.Root, matches []haloapi.Match) []haloapi.Match {
	for i := range matches {
		matches[i].MapImageURL = storeMapImageURL(root, matches[i].MapAssetID)
	}
	return matches
}

// storeMapImageURL is the URL of the stored map image for an asset id, "" when no image
// file is on disk (the same <root>/static/maps/halo_infinite/<id>.png|jpg form the context
// route uses).
func storeMapImageURL(root *store.Root, assetID string) string {
	if assetID == "" || !store.ModuleKeyValid(assetID) {
		return ""
	}
	for _, name := range []string{assetID + ".png", assetID + ".jpg"} {
		if _, err := os.Stat(filepath.Join(root.Dir(), "static", "maps", "halo_infinite", name)); err == nil {
			return "/static/maps/halo_infinite/" + name
		}
	}
	return ""
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
	if j.states == nil {
		j.states = make(map[string]fetchSnapshot)
	}
	s := j.states[id]
	switch s.State {
	case "queued":
		// Already in the queue: answer with its current position, add no duplicate.
		s.Position = queuePosition(j.queue, id)
	case "downloading", "building":
		// In flight: the snapshot already says so.
	default:
		// Never fetched, ready, or failed: (re)queue it at the back of the FIFO.
		wasEmpty := len(j.queue) == 0
		s = fetchSnapshot{State: "queued", MatchID: id, Position: len(j.queue) + 1}
		j.queue = append(j.queue, id)
		j.states[id] = s
		j.mu.Unlock()
		if wasEmpty {
			// The queue went from empty to non-empty: start the runner that drains it.
			go h.drainRemoteFetchQueue()
		}
		writeJSON(w, http.StatusAccepted, s)
		return
	}
	j.mu.Unlock()
	writeJSON(w, http.StatusAccepted, s)
}

// queuePosition is the id's 1-based position in the FIFO queue, 0 when it is not queued.
func queuePosition(queue []string, id string) int {
	for i, q := range queue {
		if q == id {
			return i + 1
		}
	}
	return 0
}

// drainRemoteFetchQueue fetches the queued ids one at a time, in FIFO order. It runs while
// the queue is non-empty and exits when the last id leaves it. The id being fetched stays at
// the head of the queue while it runs, so the queued ids behind it report stable positions
// ("Queued (2)" keeps meaning what it says until the head is done).
func (h serverHandlers) drainRemoteFetchQueue() {
	id, ok := h.remote.peekHead()
	for ok {
		h.runRemoteFetch(id)
		id, ok = h.remote.popHead()
	}
}

// peekHead is the id at the head of the queue, or false when the queue is empty.
func (j *remoteJobs) peekHead() (string, bool) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if len(j.queue) == 0 {
		return "", false
	}
	return j.queue[0], true
}

// popHead drops the head of the queue once its fetch has finished and returns the next
// head, or false when the queue is now empty. Popping and deciding to stop happen under one
// lock: a startFetch that finds the queue empty starts a new runner, so the runner that saw
// it empty must already be on its way out (two runners would fetch the same id).
func (j *remoteJobs) popHead() (string, bool) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if len(j.queue) > 0 {
		j.queue = j.queue[1:]
	}
	if len(j.queue) == 0 {
		return "", false
	}
	return j.queue[0], true
}
func (h serverHandlers) runRemoteFetch(id string) {
	j := h.remote
	update := func(state string, done, total int) {
		j.mu.Lock()
		j.states[id] = fetchSnapshot{State: state, MatchID: id, Done: done, Total: total}
		j.mu.Unlock()
	}
	api, _, err := j.client(context.Background())
	if err != nil {
		err = &fetchStepError{Step: fetchStepSignIn, Err: err}
	} else {
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
		s.Error = fetchFailureReason(id, err)
	} else {
		s.State = "ready"
	}
	j.states[id] = s
}

// fetchFailureReason logs a failed fetch (match id, failing step, cause) and returns the
// reason the fetch state route reports: "film not available" for a film the service no
// longer serves (the viewer words that one itself), the step and its cause otherwise.
func fetchFailureReason(id string, err error) string {
	step := "fetch"
	var stepErr *fetchStepError
	if errors.As(err, &stepErr) {
		step = stepErr.Step
	}
	slog.Error("match fetch failed", "match_id", id, "step", step, "err", err)
	var gone *haloapi.FilmUnavailableError
	if errors.As(err, &gone) {
		return "film not available"
	}
	return err.Error()
}
func (h serverHandlers) fetchState(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !store.MatchIDValid(id) {
		writeJSON(w, 400, map[string]string{"error": "invalid match id"})
		return
	}
	h.remote.mu.Lock()
	s, ok := h.remote.states[id]
	// A queued id's position moves as the queue advances; report its current place.
	if ok && s.State == "queued" {
		s.Position = queuePosition(h.remote.queue, id)
	}
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
	webFS, _ := webdist.Open()
	h := serverHandlers{root: root, web: web, webFS: webFS, jobs: jobs, weapKeys: weaponKeys, labelCat: labelCat, auth: &authSession{steps: defaultLoginFlow(root.Dir())}, remote: &remoteJobs{client: func(ctx context.Context) (*haloapi.Client, haloauth.Credentials, error) {
		authMu.Lock()
		defer authMu.Unlock()
		return apiClient(ctx, root.Dir())
	}, fetch: fetchMatch}, listCache: newMatchlistCache(), coatingsSetup: &coatingsSetupJob{}, callouts: newCalloutsSource(root.Dir())}
	h.mux = h.buildMux()
	return h
}

// buildMux builds the API route mux with every route bound to h. The handlers it registers
// see h's own fields, so a mux built from a handler with readOnly set serves the read-only
// answers: the read-only mode re-builds one from its wrapped handler (see readOnlyHandler).
func (h serverHandlers) buildMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/auth/state", h.authStateRoute)
	mux.HandleFunc("POST /api/auth/login", h.runLoginRoute)
	mux.HandleFunc("POST /api/auth/logout", h.authLogoutRoute)
	mux.HandleFunc("GET /api/remote/matches", h.remoteMatches)
	mux.HandleFunc("POST /api/matches/{id}/fetch", h.startFetch)
	mux.HandleFunc("GET /api/matches/{id}/fetch/state", h.fetchState)
	mux.HandleFunc("GET /api/health", h.handleHealth)
	mux.HandleFunc("POST /api/client-log", handleClientLog)
	mux.HandleFunc("GET /api/coatings/status", h.handleCoatingStatus)
	mux.HandleFunc("GET /api/coatings/setup/state", h.handleCoatingsSetupState)
	mux.HandleFunc("POST /api/coatings/setup", h.handleCoatingsSetup)
	mux.HandleFunc("GET /api/matches", h.handleMatches)
	mux.HandleFunc("GET /api/matches/{id}/replay", h.handleReplay)
	mux.HandleFunc("GET /api/matches/{id}/spartans", h.handleMatchSpartans)
	mux.HandleFunc("GET /api/matches/{id}/context", h.handleContext)
	mux.HandleFunc("GET /api/matches/{id}/mesh.glb", h.handleMesh)
	mux.HandleFunc("GET /api/matches/{id}/ambience.ogg", h.handleAmbience)
	mux.HandleFunc("GET /api/matches/{id}/callouts", h.handleCallouts)
	mux.HandleFunc("GET /api/matches/{id}/mesh/state", h.handleMeshState)
	mux.HandleFunc("POST /api/matches/{id}/mesh/build", h.handleMeshBuild)
	mux.HandleFunc("POST /api/matches/{id}/mesh/cancel", h.handleMeshCancel)
	mux.HandleFunc("GET /api/matches/{id}/mesh/bvh", h.handleMeshBVH)
	mux.HandleFunc("PUT /api/matches/{id}/mesh/bvh", h.handleMeshBVHPut)
	mux.HandleFunc("GET /api/matches/{id}/variant.glb", h.handleVariant)
	mux.HandleFunc("GET /api/matches/{id}/variant/state", h.handleVariantState)
	mux.HandleFunc("POST /api/matches/{id}/variant/build", h.handleVariantBuild)
	mux.HandleFunc("GET /api/matches/{id}/variant/bvh", h.handleVariantBVH)
	mux.HandleFunc("PUT /api/matches/{id}/variant/bvh", h.handleVariantBVHPut)
	mux.HandleFunc("GET /api/weapons", h.handleWeaponIndex)
	mux.HandleFunc("GET /api/weapons/state", h.handleWeaponState)
	mux.HandleFunc("POST /api/weapons/build", h.handleWeaponBuild)
	mux.HandleFunc("GET /api/weapons/{file}", h.handleWeaponModel)
	mux.HandleFunc("GET /api/first-person/index.json", h.handleFirstPersonIndex)
	mux.HandleFunc("GET /api/first-person/bras.json", h.handleFirstPersonBras)
	mux.HandleFunc("GET /api/first-person/state", h.handleFirstPersonState)
	mux.HandleFunc("POST /api/first-person/build", h.handleFirstPersonBuild)
	mux.HandleFunc("GET /api/first-person/{file}", h.handleFirstPersonFile)
	mux.HandleFunc("GET /api/spartan-pieces/state", h.handleSpartanPiecesState)
	mux.HandleFunc("POST /api/spartan-pieces/build", h.handleSpartanPiecesBuild)
	mux.HandleFunc("GET /api/spartan-pieces/{file}", h.handleSpartanPiecesFile)
	mux.HandleFunc("POST /api/bundle", h.handleBundle)
	mux.HandleFunc("GET /api/announcer/state", h.handleAnnouncerState)
	mux.HandleFunc("GET /api/builds", h.handleBuilds)
	mux.HandleFunc("POST /api/announcer/build", h.handleAnnouncerBuild)
	mux.HandleFunc("GET /static/weapons-assets/halo_infinite/jeu/{file}", h.handleWeaponIconFile)
	mux.HandleFunc("GET /static/weapons-assets/halo_infinite/hud/{file}", h.handleHudIconFile)
	mux.HandleFunc("GET /static/ranks/halo_infinite/{file}", h.handleRankIconFile)
	mux.HandleFunc("GET /api/backdrop/home", h.handleBackdropHome)
	mux.HandleFunc("GET /static/sounds/halo_infinite/{file}", h.handleSoundFile)
	return mux
}
