// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// update_check.go — the update check: the GitHub release lookup, the release
// version ordering it compares, the one startup check that runs in the background,
// and the /api/update route that reports its cached result.

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// releasesAPI is the GitHub API endpoint that answers the repository's latest release.
const releasesAPI = "https://api.github.com/repos/llampwall/infinite-theater-3d/releases/latest"

// updateInfo is the update-check result the /api/update route reports.
type updateInfo struct {
	Current string `json:"current"`
	Latest  string `json:"latest"`
	URL     string `json:"url"`
	Newer   bool   `json:"newer"`
	Checked bool   `json:"checked"`
	Err     string `json:"error"`
}

// checkForUpdate asks the release API (api) for the latest release and compares its
// tag with the current version, with a 10 second timeout cut from ctx. A 404 (no
// release published yet) is not an error: it answers checked, not newer.
func checkForUpdate(ctx context.Context, client *http.Client, api, current string) updateInfo {
	info := updateInfo{Current: current}
	if client == nil {
		client = http.DefaultClient
	}
	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, api, nil)
	if err != nil {
		info.Err = err.Error()
		return info
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Installation08/"+current)
	resp, err := client.Do(req)
	if err != nil {
		info.Err = err.Error()
		return info
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		// No release published yet: nothing is newer, and that is not an error.
		info.Checked = true
		info.Latest = current
		return info
	}
	if resp.StatusCode != http.StatusOK {
		info.Err = fmt.Sprintf("release API answered with status %d", resp.StatusCode)
		return info
	}
	var rel struct {
		TagName string `json:"tag_name"`
		HTMLURL string `json:"html_url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		info.Err = fmt.Sprintf("decode release answer: %v", err)
		return info
	}
	info.Checked = true
	info.Latest = strings.TrimPrefix(rel.TagName, "v")
	info.URL = rel.HTMLURL
	info.Newer = versionNewer(info.Latest, current)
	return info
}

// versionNewer says whether latest is newer than current. Both are
// MAJOR.MINOR.PATCH with an optional leading "v" and an optional -pre
// pre-release suffix; a release is newer than its pre-releases. Pre-release
// identifiers compare dot by dot with their leading numbers compared
// numerically, so test.24 > test.23-rc7 and test.23 > test.23-rc7. A current
// that ends in -dev (a source build) is never offered an update.
func versionNewer(latest, current string) bool {
	if strings.HasSuffix(current, "-dev") {
		return false
	}
	lt, lp := splitPreRelease(stripLeadingV(latest))
	ct, cp := splitPreRelease(stripLeadingV(current))
	if c := compareVersionCore(lt, ct); c != 0 {
		return c > 0
	}
	switch {
	case lp == "" && cp == "":
		return false
	case lp == "":
		return true // a release is newer than its own pre-releases
	case cp == "":
		return false
	}
	return comparePreRelease(lp, cp) > 0
}

// stripLeadingV removes the leading "v" a release tag carries.
func stripLeadingV(v string) string {
	return strings.TrimPrefix(v, "v")
}

// splitPreRelease splits a version at its first "-" into core and pre-release
// (the pre-release is "" when absent).
func splitPreRelease(v string) (core, pre string) {
	i := strings.IndexByte(v, '-')
	if i < 0 {
		return v, ""
	}
	return v[:i], v[i+1:]
}

// compareVersionCore compares the MAJOR.MINOR.PATCH parts numerically (a missing
// part is zero).
func compareVersionCore(a, b string) int {
	pa := strings.Split(a, ".")
	pb := strings.Split(b, ".")
	for i := 0; i < 3; i++ {
		na, nb := 0, 0
		if i < len(pa) {
			na, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			nb, _ = strconv.Atoi(pb[i])
		}
		switch {
		case na > nb:
			return 1
		case na < nb:
			return -1
		}
	}
	return 0
}

// comparePreRelease compares pre-release suffixes: dot-separated identifiers one
// by one, the one with more identifiers newer when the shared ones all tie.
func comparePreRelease(a, b string) int {
	pa := strings.Split(a, ".")
	pb := strings.Split(b, ".")
	for i := 0; i < len(pa) && i < len(pb); i++ {
		if c := comparePreIdentifier(pa[i], pb[i]); c != 0 {
			return c
		}
	}
	switch {
	case len(pa) > len(pb):
		return 1
	case len(pa) < len(pb):
		return -1
	}
	return 0
}

// comparePreIdentifier compares two pre-release identifiers: their leading
// numbers (23 in 23-rc7) compare numerically; when the numbers tie, the
// identifier without a suffix is newer than the one with one (test.23 is newer
// than test.23-rc7); identifiers without a leading number compare as strings.
func comparePreIdentifier(a, b string) int {
	an, aRest, aHas := leadingNumber(a)
	bn, bRest, bHas := leadingNumber(b)
	if aHas && bHas {
		if an != bn {
			if an > bn {
				return 1
			}
			return -1
		}
		switch {
		case aRest == "" && bRest != "":
			return 1
		case aRest != "" && bRest == "":
			return -1
		}
	}
	return strings.Compare(a, b)
}

// leadingNumber is s's leading run of digits as a number, with the rest of s
// (no number, the whole s, when it does not start with a digit).
func leadingNumber(s string) (n int64, rest string, has bool) {
	i := 0
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	if i == 0 {
		return 0, s, false
	}
	n, _ = strconv.ParseInt(s[:i], 10, 64)
	return n, s[i:], true
}

// updateState caches the startup update check's result so the /api/update route
// can report it (checked stays false until the check has run).
var updateState struct {
	mu   sync.Mutex
	info updateInfo
}

// startUpdateCheck schedules the one startup update check: a goroutine runs it
// after a short delay (so it does not race server startup) and stores the
// result. A -dev build skips it; that build's menu reports its own message.
func startUpdateCheck() {
	if strings.HasSuffix(Version, "-dev") {
		return
	}
	go func() {
		time.Sleep(15 * time.Second)
		info := checkForUpdate(context.Background(), http.DefaultClient, releasesAPI, Version)
		updateState.mu.Lock()
		updateState.info = info
		updateState.mu.Unlock()
	}()
}

// handleUpdate answers GET /api/update with the cached update-check result.
func handleUpdate(w http.ResponseWriter, r *http.Request) {
	updateState.mu.Lock()
	info := updateState.info
	updateState.mu.Unlock()
	info.Current = Version
	writeJSON(w, http.StatusOK, info)
}
