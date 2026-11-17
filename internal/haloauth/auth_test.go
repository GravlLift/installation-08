// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package haloauth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLoginAndRefresh(t *testing.T) {
	var logs bytes.Buffer
	prior := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	defer func() {
		slog.SetDefault(prior)
		for _, secret := range []string{"device-secret", "access-secret", "refresh-secret", "user-secret", "xsts-secret", "xbox-secret", "spartan-secret", "clearance-secret"} {
			if strings.Contains(logs.String(), secret) {
				t.Error("credential in logs")
			}
		}
	}()
	var requests []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.URL.Path)
		switch r.URL.Path {
		case "/device":
			fmt.Fprint(w, `{"device_code":"device-secret","user_code":"ABCD","verification_uri":"https://example.test","expires_in":30,"interval":1}`)
		case "/token":
			fmt.Fprint(w, `{"access_token":"access-secret","refresh_token":"refresh-secret","expires_in":3600}`)
		case "/user":
			fmt.Fprint(w, `{"Token":"user-secret"}`)
		case "/xsts":
			var body struct{ RelyingParty string }
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body.RelyingParty == "http://xboxlive.com" {
				fmt.Fprint(w, `{"Token":"xbox-secret","DisplayClaims":{"xui":[{"gtg":"Player","xid":"123"}]}}`)
			} else {
				fmt.Fprint(w, `{"Token":"xsts-secret","DisplayClaims":{"xui":[{"uhs":"hash"}]}}`)
			}
		case "/spartan":
			fmt.Fprintf(w, `{"SpartanToken":"spartan-secret","ExpiresUtc":{"ISO8601Date":%q}}`, time.Now().Add(time.Hour).UTC().Format(time.RFC3339))
		case "/clearance":
			fmt.Fprint(w, `{"FlightConfigurationId":"clearance-secret"}`)
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	e := Endpoints{server.URL + "/device", server.URL + "/token", server.URL + "/user", server.URL + "/xsts", server.URL + "/spartan", server.URL + "/clearance"}
	c := New(t.TempDir(), server.Client(), e)
	var shown bool
	got, err := c.Login(context.Background(), "client", func(uri, code string) { shown = uri == "https://example.test" && code == "ABCD" })
	if err != nil || !shown || got.Gamertag != "Player" || got.XUID != "123" {
		t.Fatalf("login: %+v %v", got, err)
	}
	if strings.Join(requests, ",") != "/device,/token,/user,/xsts,/xsts,/spartan,/clearance" {
		t.Fatal(requests)
	}
	c.tokens.Expires = time.Time{}
	if err := c.persist(c.tokens); err != nil {
		t.Fatal(err)
	}
	c = New(c.dir, server.Client(), e)
	got, err = c.Current(context.Background())
	if err != nil || got.Spartan != "spartan-secret" {
		t.Fatalf("refresh: %v", err)
	}
	if len(requests) != 13 {
		t.Fatal(requests)
	}
}

func TestExpiredRefreshIsSafe(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		fmt.Fprint(w, `{"error":"invalid_grant","error_description":"refresh-secret"}`)
	}))
	defer s.Close()
	c := New(t.TempDir(), s.Client(), Endpoints{Token: s.URL})
	c.tokens = Credentials{ClientID: "client", Refresh: "refresh-secret"}
	_, err := c.Current(context.Background())
	if err == nil || strings.Contains(err.Error(), "refresh-secret") {
		t.Fatalf("unsafe error: %v", err)
	}
}

func TestAuthRedirectDoesNotForwardCredentials(t *testing.T) {
	leaked := false
	sink := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaked = true; w.WriteHeader(200) }))
	defer sink.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, sink.URL, http.StatusTemporaryRedirect)
	}))
	defer source.Close()
	c := New(t.TempDir(), source.Client(), Endpoints{Device: source.URL})
	_, err := c.Login(context.Background(), "synthetic-client", func(string, string) {})
	if err == nil || leaked {
		t.Fatalf("redirect forwarded credentials: %v", err)
	}
}
