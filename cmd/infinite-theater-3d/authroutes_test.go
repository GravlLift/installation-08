package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/haloauth"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// newTestServer builds a server with the real login flow pointed at an httptest fake for
// the Microsoft endpoints (device and token). The fake's behavior is controlled by the
// channels and counters the test sets.
func newTestServer(t *testing.T, deviceResp, tokenResp string) (serverHandlers, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/device":
			fmt.Fprint(w, deviceResp)
		case "/token":
			fmt.Fprint(w, tokenResp)
		case "/user":
			fmt.Fprint(w, `{"Token":"user-secret"}`)
		case "/xsts":
			fmt.Fprint(w, `{"Token":"xsts-secret","DisplayClaims":{"xui":[{"uhs":"hash","gtg":"Player","xid":"123"}]}}`)
		case "/spartan":
			fmt.Fprintf(w, `{"SpartanToken":"spartan-secret","ExpiresUtc":{"ISO8601Date":%q}}`, time.Now().Add(time.Hour).UTC().Format(time.RFC3339))
		case "/clearance":
			fmt.Fprint(w, `{"FlightConfigurationId":"clearance-secret"}`)
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(srv.Close)
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := newServerHandlers(root, "", nil, weapons.Catalog{}, testLabelCatalog)
	c := haloauth.New(root.Dir(), srv.Client(), haloauth.Endpoints{
		Device: srv.URL + "/device", Token: srv.URL + "/token", User: srv.URL + "/user",
		XSTS: srv.URL + "/xsts", Spartan: srv.URL + "/spartan", Clearance: srv.URL + "/clearance",
	})
	h.auth.steps = loginFlow{
		start:  c.StartLogin,
		poll:   c.Poll,
		done:   c.CompleteLogin,
		logout: c.Logout,
	}
	return h, srv
}

func authReq(method, path string) *http.Request {
	req := httptest.NewRequest(method, path, nil)
	req.Header.Set("Origin", "http://localhost:5183")
	return req
}

func stateBody(t *testing.T, h serverHandlers) map[string]any {
	t.Helper()
	r := httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest(http.MethodGet, "/api/auth/state", nil))
	var st map[string]any
	if json.Unmarshal(r.Body.Bytes(), &st) != nil {
		t.Fatalf("state body: %s", r.Body.String())
	}
	return st
}

func waitState(t *testing.T, h serverHandlers, want string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		st := stateBody(t, h)
		if st["state"] == want {
			return st
		}
		if time.Now().After(deadline) {
			t.Fatalf("state never became %s: %v", want, st)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// TestAuthStateOneShape — the state route answers the single shape in all four cases,
// keeps the legacy signedIn key, and omits fields that do not apply.
func TestAuthStateOneShape(t *testing.T) {
	h, _ := newTestServer(t,
		`{"device_code":"device-secret","user_code":"ABCD","verification_uri":"https://example.test","expires_in":30,"interval":1}`,
		`{"access_token":"access-secret","refresh_token":"refresh-secret"}`,
	)
	st := stateBody(t, h)
	if st["state"] != "signed_out" || st["signedIn"] != false {
		t.Fatalf("signed_out: %v", st)
	}
	if _, ok := st["userCode"]; ok {
		t.Fatalf("signed_out must not carry userCode: %v", st)
	}
}

// TestAuthLoginStartPendingAndJoin — POST starts the flow and answers 202 with the
// verification address and short code; the state route shows pending; a second POST joins
// (202, same code, no second device code issued).
func TestAuthLoginStartPendingAndJoin(t *testing.T) {
	deviceResp := `{"device_code":"device-secret","user_code":"ABCD","verification_uri":"https://example.test","expires_in":30,"interval":1}`
	tokenResp := `{"error":"authorization_pending"}`
	h, _ := newTestServer(t, deviceResp, tokenResp)
	r := httptest.NewRecorder()
	h.ServeHTTP(r, authReq("POST", "/api/auth/login"))
	if r.Code != http.StatusAccepted {
		t.Fatalf("login status = %d, body=%s", r.Code, r.Body.String())
	}
	var st map[string]any
	if json.Unmarshal(r.Body.Bytes(), &st) != nil {
		t.Fatalf("login body: %s", r.Body.String())
	}
	if st["state"] != "pending" || st["verificationUri"] != "https://example.test" || st["userCode"] != "ABCD" {
		t.Fatalf("pending body: %v", st)
	}
	if _, ok := st["expiresAt"]; !ok {
		t.Fatalf("pending body must carry expiresAt: %v", st)
	}
	got := stateBody(t, h)
	if got["state"] != "pending" || got["userCode"] != "ABCD" {
		t.Fatalf("state: %v", got)
	}
	r = httptest.NewRecorder()
	h.ServeHTTP(r, authReq("POST", "/api/auth/login"))
	if r.Code != http.StatusAccepted {
		t.Fatalf("join status = %d", r.Code)
	}
	if json.Unmarshal(r.Body.Bytes(), &st) != nil || st["userCode"] != "ABCD" {
		t.Fatalf("join body: %s", r.Body.String())
	}
}

// TestAuthLoginAlreadySignedIn — while a login succeeded, POST answers 200 with the
// signed-in state and does not start a second flow.
func TestAuthLoginAlreadySignedIn(t *testing.T) {
	deviceResp := `{"device_code":"device-secret","user_code":"ABCD","verification_uri":"https://example.test","expires_in":30,"interval":1}`
	tokenResp := `{"access_token":"access-secret","refresh_token":"refresh-secret"}`
	h, _ := newTestServer(t, deviceResp, tokenResp)
	h.ServeHTTP(httptest.NewRecorder(), authReq("POST", "/api/auth/login"))
	st := waitState(t, h, "signed_in")
	if st["gamertag"] == "" {
		t.Fatalf("signed_in body must carry gamertag: %v", st)
	}
	r := httptest.NewRecorder()
	h.ServeHTTP(r, authReq("POST", "/api/auth/login"))
	if r.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 signed-in", r.Code)
	}
	if !strings.Contains(r.Body.String(), "signed_in") {
		t.Fatalf("body: %s", r.Body.String())
	}
}

// TestAuthLoginRefusedAndRestart — a token-endpoint refusal ends the session failed with
// a short human error; a new POST starts a fresh flow.
func TestAuthLoginRefusedAndRestart(t *testing.T) {
	deviceResp := `{"device_code":"device-secret","user_code":"ABCD","verification_uri":"https://example.test","expires_in":30,"interval":1}`
	tokenResp := `{"error":"authorization_declined"}`
	h, _ := newTestServer(t, deviceResp, tokenResp)
	h.ServeHTTP(httptest.NewRecorder(), authReq("POST", "/api/auth/login"))
	st := waitState(t, h, "failed")
	if err, _ := st["error"].(string); err == "" {
		t.Fatalf("failed body must carry a human error: %v", st)
	}
}

// TestAuthLogout — logout clears a signed-in session and cancels a pending login.
func TestAuthLogout(t *testing.T) {
	deviceResp := `{"device_code":"device-secret","user_code":"ABCD","verification_uri":"https://example.test","expires_in":30,"interval":1}`
	tokenResp := `{"access_token":"access-secret","refresh_token":"refresh-secret"}`
	h, _ := newTestServer(t, deviceResp, tokenResp)
	h.ServeHTTP(httptest.NewRecorder(), authReq("POST", "/api/auth/login"))
	waitState(t, h, "signed_in")
	r := httptest.NewRecorder()
	h.ServeHTTP(r, authReq("POST", "/api/auth/logout"))
	if r.Code != http.StatusOK || !strings.Contains(r.Body.String(), "signed_out") {
		t.Fatalf("logout: %d %s", r.Code, r.Body.String())
	}
	if st := stateBody(t, h); st["state"] != "signed_out" {
		t.Fatalf("after logout: %v", st)
	}
}

// TestAuthOriginCheck — both POST routes refuse a non-loopback Origin with 403.
func TestAuthOriginCheck(t *testing.T) {
	deviceResp := `{"device_code":"device-secret","user_code":"ABCD","verification_uri":"https://example.test","expires_in":30,"interval":1}`
	tokenResp := `{"access_token":"access-secret","refresh_token":"refresh-secret"}`
	h, _ := newTestServer(t, deviceResp, tokenResp)
	for _, path := range []string{"/api/auth/login", "/api/auth/logout"} {
		req := httptest.NewRequest("POST", path, nil)
		req.Header.Set("Origin", "https://evil.example")
		r := httptest.NewRecorder()
		h.ServeHTTP(r, req)
		if r.Code != http.StatusForbidden {
			t.Fatalf("%s: status = %d, want 403", path, r.Code)
		}
	}
}

// TestAuthShutdownCancels — stopping the server cancels a pending login.
func TestAuthShutdownCancels(t *testing.T) {
	deviceResp := `{"device_code":"device-secret","user_code":"ABCD","verification_uri":"https://example.test","expires_in":30,"interval":1}`
	tokenResp := `{"error":"authorization_pending"}`
	h, _ := newTestServer(t, deviceResp, tokenResp)
	h.ServeHTTP(httptest.NewRecorder(), authReq("POST", "/api/auth/login"))
	waitState(t, h, "pending")
	h.stopPendingLogin()
	st := waitState(t, h, "failed")
	if err, _ := st["error"].(string); err == "" {
		t.Fatalf("shutdown must end the session failed: %v", st)
	}
}

// TestAuthNoSecretInResponses — across the whole flow, neither the device code secret nor
// any token value appears in a response body, and nothing secret is logged.
func TestAuthNoSecretInResponses(t *testing.T) {
	var logs bytes.Buffer
	prior := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	defer func() { slog.SetDefault(prior) }()
	deviceResp := `{"device_code":"device-secret","user_code":"ABCD","verification_uri":"https://example.test","expires_in":30,"interval":1}`
	tokenResp := `{"access_token":"access-secret","refresh_token":"refresh-secret"}`
	h, _ := newTestServer(t, deviceResp, tokenResp)
	bodies := []string{}
	r := httptest.NewRecorder()
	h.ServeHTTP(r, authReq("POST", "/api/auth/login"))
	bodies = append(bodies, r.Body.String())
	for i := 0; i < 3; i++ {
		b, _ := json.Marshal(stateBody(t, h))
		bodies = append(bodies, string(b))
	}
	waitState(t, h, "signed_in")
	b, _ := json.Marshal(stateBody(t, h))
	bodies = append(bodies, string(b))
	for _, secret := range []string{"device-secret", "access-secret", "refresh-secret"} {
		for _, body := range bodies {
			if strings.Contains(body, secret) {
				t.Fatalf("secret %q in body: %s", secret, body)
			}
		}
	}
	if strings.Contains(logs.String(), "secret") {
		t.Fatalf("secret in logs: %s", logs.String())
	}
}
