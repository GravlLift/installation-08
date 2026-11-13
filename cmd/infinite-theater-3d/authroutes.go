package main

// authroutes.go — sign in from the web page. The server holds one device-code login at a
// time (single-flight): POST /api/auth/login starts it in the background and answers with
// the Microsoft address and short code, GET /api/auth/state reports one shape for every
// case, and POST /api/auth/logout cancels a pending login and removes the stored tokens.
// The device code secret and every token value stay server-side; only the user-facing pair
// (verification address, short code) crosses the wire.

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/haloauth"
)

// loginFlow is the seam the tests replace: it runs the device-code flow against the real
// endpoints in production.
type loginFlow struct {
	start  func(ctx context.Context, id string) (*haloauth.DeviceCode, error)
	poll   func(d *haloauth.DeviceCode, id string) (*haloauth.OAuthToken, time.Duration, error)
	done   func(ctx context.Context, id string, token *haloauth.OAuthToken) (haloauth.Credentials, error)
	logout func() error
}

// defaultLoginFlow wires the real haloauth device-code flow into the session: start
// issues the device code, poll asks the token endpoint once, done exchanges and persists.
func defaultLoginFlow(dir string) loginFlow {
	c := haloauth.New(dir, nil, haloauth.DefaultEndpoints)
	return loginFlow{
		start:  c.StartLogin,
		poll:   c.Poll,
		done:   c.CompleteLogin,
		logout: c.Logout,
	}
}

// authSession holds the one login the server runs at a time. Its fields are read and
// written under the mutex.
type authSession struct {
	// flow runs the device-code steps; it lives on the session (shared by pointer) so the
	// handlers registered on the mux and a test that replaces it see the same value.
	steps   loginFlow
	mu      sync.Mutex
	flow    *haloauth.DeviceCode
	wait    context.Context
	cancel  context.CancelFunc
	uri     string
	code    string
	expires time.Time
	gamer   string
	err     string
}

func (s *authSession) state() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.stateLocked()
}

// stateLocked renders the session's state; the caller holds s.mu.
func (s *authSession) stateLocked() map[string]any {
	if s.wait != nil {
		out := map[string]any{"state": "pending", "verificationUri": s.uri, "userCode": s.code}
		if !s.expires.IsZero() {
			out["expiresAt"] = s.expires.UTC().Format(time.RFC3339)
		}
		return out
	}
	if s.gamer != "" {
		return map[string]any{"state": "signed_in", "gamertag": s.gamer}
	}
	if s.err != "" {
		return map[string]any{"state": "failed", "error": s.err}
	}
	return map[string]any{"state": "signed_out"}
}

// runLoginRoute starts or joins the one login session. Already signed in answers 200 with
// that state; a login in flight answers 202 with the same pending state (no second device
// code); otherwise the flow starts in the background and the answer is 202 as soon as the
// address and code are known. A failed state is cleared so a new POST starts a fresh flow.
func (h serverHandlers) runLoginRoute(w http.ResponseWriter, r *http.Request) {
	if !originAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
		return
	}
	s := h.auth
	s.mu.Lock()
	if s.gamer != "" {
		st := s.stateLocked()
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, st)
		return
	}
	if s.wait != nil {
		st := s.stateLocked()
		s.mu.Unlock()
		writeJSON(w, http.StatusAccepted, st)
		return
	}
	s.err = ""
	s.mu.Unlock()
	go h.runLoginFlow()
	// Wait until the flow has surfaced the code (or failed before it could), then answer
	// with whatever state the session holds.
	var st map[string]any
	for {
		s.mu.Lock()
		st = s.stateLocked()
		ready := s.wait != nil || s.gamer != "" || s.err != ""
		s.mu.Unlock()
		if ready {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	writeJSON(w, http.StatusAccepted, st)
}

// runLoginFlow drives the device-code loop for the session: start, poll at the interval
// the token endpoint asks for, then exchange and persist on success. It never logs a
// secret; the flow seam is built on haloauth, whose errors are already scrubbed.
func (h serverHandlers) runLoginFlow() {
	s := h.auth
	s.mu.Lock()
	if s.wait != nil || s.gamer != "" {
		s.mu.Unlock()
		return
	}
	s.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	s.cancel = cancel
	s.mu.Unlock()
	defer cancel()

	d, err := h.auth.steps.start(ctx, defaultClientID())
	if err != nil {
		h.loginFailed("sign in could not be started; try again")
		return
	}
	s.mu.Lock()
	s.flow = d
	s.wait = d.Wait
	s.uri = d.URI
	s.code = d.Code
	s.expires = time.Now().Add(d.Expires)
	s.mu.Unlock()

	interval := d.Interval
	for {
		select {
		case <-d.Wait.Done():
			h.loginFailed("the sign-in code expired; try again")
			return
		case <-time.After(interval):
		}
		token, adjust, err := h.auth.steps.poll(d, defaultClientID())
		if err != nil {
			h.loginFailed("the sign-in was refused; try again")
			return
		}
		if token == nil {
			interval += adjust
			continue
		}
		identity, err := h.auth.steps.done(d.Wait, defaultClientID(), token)
		if err != nil {
			h.loginFailed("sign in failed; try again")
			return
		}
		s.mu.Lock()
		s.wait = nil
		s.cancel = nil
		s.flow = nil
		s.gamer = identity.Gamertag
		s.mu.Unlock()
		return
	}
}

// loginFailed ends the login session as failed; a subsequent POST starts a fresh flow.
func (h serverHandlers) loginFailed(message string) {
	s := h.auth
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.wait != nil {
		s.cancel()
		s.wait = nil
		s.cancel = nil
		s.flow = nil
		s.uri = ""
		s.code = ""
		s.expires = time.Time{}
	}
	if s.gamer == "" {
		s.err = message
	}
}

// authStateRoute answers GET /api/auth/state with the one shape for all cases. While a
// login is in flight, or one has just finished in this process, it reports that session;
// otherwise it reads the stored credentials (a sign-in from an earlier run, or from the
// CLI). It keeps the legacy signedIn key (web and tests read it) alongside state and
// gamertag.
func (h serverHandlers) authStateRoute(w http.ResponseWriter, r *http.Request) {
	s := h.auth
	s.mu.Lock()
	if s.wait == nil && s.gamer == "" && s.err == "" {
		st := storedAuthState(h.root.Dir())
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, st)
		return
	}
	st := s.stateLocked()
	s.mu.Unlock()
	st["signedIn"] = st["state"] == "signed_in"
	writeJSON(w, http.StatusOK, st)
}

// storedAuthState renders the stored credentials (no session in flight): signed_in with
// the gamertag when valid tokens are on disk, signed_out otherwise.
func storedAuthState(dir string) map[string]any {
	raw, err := haloauth.Load(dir)
	if err != nil {
		return map[string]any{"state": "signed_out", "signedIn": false}
	}
	var c haloauth.Credentials
	if json.Unmarshal(raw, &c) != nil || c.Refresh == "" {
		return map[string]any{"state": "signed_out", "signedIn": false}
	}
	return map[string]any{"state": "signed_in", "gamertag": c.Gamertag, "signedIn": true}
}

// authLogoutRoute cancels a pending login and removes the stored tokens, then answers the
// signed-out state.
func (h serverHandlers) authLogoutRoute(w http.ResponseWriter, r *http.Request) {
	if !originAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
		return
	}
	if err := h.auth.steps.logout(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "sign out failed"})
		return
	}
	s := h.auth
	s.mu.Lock()
	s.gamer = ""
	s.err = ""
	if s.wait != nil {
		s.cancel()
		s.wait = nil
		s.cancel = nil
		s.flow = nil
		s.uri = ""
		s.code = ""
		s.expires = time.Time{}
	}
	st := s.stateLocked()
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, st)
}

// stopPendingLogin cancels the login in flight on server shutdown (the flow's wait fires,
// the session ends failed; nothing is left waiting).
func (h serverHandlers) stopPendingLogin() {
	s := h.auth
	s.mu.Lock()
	if s.wait != nil {
		s.cancel()
	}
	s.mu.Unlock()
}
