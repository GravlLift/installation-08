// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
	"github.com/llampwall/infinite-theater-3d/internal/haloauth"
)

func TestTokensNeverAppearInErrorsOrLogs(t *testing.T) {
	const secret = "test-credential-do-not-log"
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(w, `{"error":"invalid_grant","error_description":"`+secret+`"}`)
	}))
	defer s.Close()
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	defer slog.SetDefault(previous)
	auth := haloauth.New(t.TempDir(), s.Client(), haloauth.Endpoints{Device: s.URL})
	_, authErr := auth.Login(context.Background(), secret, func(string, string) {})
	api := haloapi.New(s.Client(), haloapi.Endpoints{Stats: s.URL, Discovery: s.URL, Economy: s.URL}, secret, secret)
	_, apiErr := api.Stats(context.Background(), "abc")
	for _, err := range []error{authErr, apiErr} {
		if err == nil || strings.Contains(err.Error(), secret) {
			t.Fatalf("unsafe error %v", err)
		}
	}
	if strings.Contains(logs.String(), secret) {
		t.Fatal("credential appeared in logs")
	}
}
