// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// update_check_test.go — the release version ordering (TestVersionNewer) and the
// check's answer on the release API's 200 (newer), 200 (same), 404 and 500
// (TestCheckForUpdate), against an httptest server.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestVersionNewer — the release version ordering the update check relies on.
func TestVersionNewer(t *testing.T) {
	cases := []struct {
		latest, current string
		want            bool
	}{
		{"0.1.0-test.24", "0.1.0-test.23-rc7", true},
		{"0.1.0-test.23", "0.1.0-test.23-rc7", true},
		{"0.1.0", "0.1.0-test.30", true},
		{"v0.1.0-test.24", "0.1.0-test.23-rc7", true},
		{"0.1.0-test.23-rc7", "0.1.0-test.23-rc7", false},
		{"0.1.0-test.23-rc7", "0.1.0-test.24", false},
		{"0.1.0-test.24", "0.1.0", false},
		{"0.2.0", "0.1.0-dev", false},
		{"0.1.0-test.24", "0.1.0-dev", false},
	}
	for _, tc := range cases {
		if got := versionNewer(tc.latest, tc.current); got != tc.want {
			t.Errorf("versionNewer(%q, %q) = %v, want %v", tc.latest, tc.current, got, tc.want)
		}
	}
}

// releaseTestServer serves a latest-release answer with the given status, tag and
// URL, and records that the request carries the API's Accept header and a
// User-Agent.
func releaseTestServer(t *testing.T, status int, tag, url string) *httptest.Server {
	t.Helper()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Accept"); got != "application/vnd.github+json" {
			t.Errorf("Accept = %q, want application/vnd.github+json", got)
		}
		if r.Header.Get("User-Agent") == "" {
			t.Error("request carried no User-Agent header")
		}
		w.WriteHeader(status)
		if status == http.StatusOK {
			_ = json.NewEncoder(w).Encode(map[string]string{"tag_name": tag, "html_url": url})
		}
	}))
	t.Cleanup(ts.Close)
	return ts
}

// TestCheckForUpdate — the check's answer on the API's 200 (newer), 200 (same),
// 404 (no release yet) and 500.
func TestCheckForUpdate(t *testing.T) {
	t.Run("newer release", func(t *testing.T) {
		const tagURL = "https://github.com/llampwall/infinite-theater-3d/releases/tag/v0.1.0-test.24"
		ts := releaseTestServer(t, http.StatusOK, "v0.1.0-test.24", tagURL)
		info := checkForUpdate(context.Background(), ts.Client(), ts.URL, "0.1.0-test.23-rc7")
		if !info.Checked || info.Err != "" {
			t.Fatalf("info = %+v, want checked with no error", info)
		}
		if !info.Newer || info.Latest != "0.1.0-test.24" || info.URL != tagURL || info.Current != "0.1.0-test.23-rc7" {
			t.Fatalf("info = %+v, want latest 0.1.0-test.24, newer, URL set", info)
		}
	})
	t.Run("same version", func(t *testing.T) {
		ts := releaseTestServer(t, http.StatusOK, "v0.1.0-test.23-rc7", "https://github.com/llampwall/infinite-theater-3d/releases/tag/v0.1.0-test.23-rc7")
		info := checkForUpdate(context.Background(), ts.Client(), ts.URL, "0.1.0-test.23-rc7")
		if !info.Checked || info.Newer || info.Err != "" {
			t.Fatalf("info = %+v, want checked, not newer, no error", info)
		}
	})
	t.Run("no release yet", func(t *testing.T) {
		ts := releaseTestServer(t, http.StatusNotFound, "", "")
		info := checkForUpdate(context.Background(), ts.Client(), ts.URL, "0.1.0")
		if !info.Checked || info.Newer || info.Err != "" {
			t.Fatalf("info = %+v, want checked, not newer, no error", info)
		}
	})
	t.Run("api failure", func(t *testing.T) {
		ts := releaseTestServer(t, http.StatusInternalServerError, "", "")
		info := checkForUpdate(context.Background(), ts.Client(), ts.URL, "0.1.0")
		if info.Checked || info.Err == "" {
			t.Fatalf("info = %+v, want unchecked with an error", info)
		}
	})
}
