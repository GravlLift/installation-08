// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/mapmesh"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// fakePoseSource is the poseSource the pose routes are tested with: a fixed catalog and a
// fixed GLB body, counting the GLB builds.
type fakePoseSource struct {
	mu      sync.Mutex
	poses   []mapmesh.Pose
	listErr error
	// listErrs, when non-empty, is consumed one error per List call (nil = success).
	listErrs []error
	glb      []byte
	glbCalls int
}

func (f *fakePoseSource) List(context.Context) ([]mapmesh.Pose, error) {
	f.mu.Lock()
	if len(f.listErrs) > 0 {
		err := f.listErrs[0]
		f.listErrs = f.listErrs[1:]
		f.mu.Unlock()
		if err != nil {
			return nil, err
		}
	}
	f.mu.Unlock()
	return f.poses, f.listErr
}

func (f *fakePoseSource) GLB(context.Context, string) ([]byte, error) {
	f.mu.Lock()
	f.glbCalls++
	f.mu.Unlock()
	return f.glb, nil
}

func (f *fakePoseSource) calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.glbCalls
}

func poseTestHandlers(t *testing.T, src *fakePoseSource) (serverHandlers, *store.Root) {
	t.Helper()
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := newServerHandlers(root, "", nil, weapons.Catalog{}, testLabelCatalog)
	// newServerHandlers bound the mux to its own copy of h; rebind it so the routes see
	// the fake source.
	h.poses = newPoseStore(root, src)
	h.mux = h.buildMux()
	return h, root
}

func TestSpartanPosesRoutes(t *testing.T) {
	src := &fakePoseSource{
		poses: []mapmesh.Pose{
			{ID: "mp:intro_emote:any:any:i_see_you", Kind: mapmesh.PoseKindEmote, Name: "i see you",
				Path: "mp / intro_emote / any / any / i_see_you", Frames: 90, FPS: 30},
			{ID: "menu:stance:set_a:rare:stand", Kind: mapmesh.PoseKindStance, Name: "set_a rare stand",
				Path: "menu / stance / set_a / rare / stand", Frames: 12, FPS: 60},
		},
		glb: []byte("glTF-fake-glb"),
	}
	h, root := poseTestHandlers(t, src)
	get := func(url string) *httptest.ResponseRecorder {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", url, nil))
		return r
	}

	// The list.
	r := get("/api/spartan/poses")
	if r.Code != http.StatusOK || !strings.HasPrefix(r.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("list: %d %q", r.Code, r.Header().Get("Content-Type"))
	}
	var list struct {
		Poses []mapmesh.Pose `json:"poses"`
	}
	if err := json.Unmarshal(r.Body.Bytes(), &list); err != nil || len(list.Poses) != 2 {
		t.Fatalf("list body: %v %s", err, r.Body.String())
	}
	if list.Poses[0].ID != "mp:intro_emote:any:any:i_see_you" || list.Poses[0].Kind != "emote" ||
		list.Poses[0].Name != "i see you" || list.Poses[0].Path != "mp / intro_emote / any / any / i_see_you" ||
		list.Poses[0].Frames != 90 || list.Poses[0].FPS != 30 {
		t.Errorf("list pose 0: %+v", list.Poses[0])
	}

	// The GLB: served as a glTF binary, built once and cached.
	id := "mp:intro_emote:any:any:i_see_you"
	r = get("/api/spartan/poses/" + id)
	if r.Code != http.StatusOK || r.Header().Get("Content-Type") != "model/gltf-binary" ||
		string(r.Body.Bytes()) != "glTF-fake-glb" {
		t.Fatalf("glb: %d %q %q", r.Code, r.Header().Get("Content-Type"), r.Body.String())
	}
	if src.calls() != 1 {
		t.Fatalf("glb built %d times, want 1", src.calls())
	}
	cache := filepath.Join(root.Dir(), "poses", poseCacheName(id))
	if _, err := os.Stat(cache); err != nil {
		t.Fatalf("cache file: %v", err)
	}
	if raw, err := os.ReadFile(cache); err != nil || string(raw) != "glTF-fake-glb" {
		t.Fatalf("cache content: %v %q", err, raw)
	}
	// The second GET is served from the cache: the fake is not called again.
	r = get("/api/spartan/poses/" + id)
	if r.Code != http.StatusOK || r.Header().Get("Content-Type") != "model/gltf-binary" ||
		string(r.Body.Bytes()) != "glTF-fake-glb" {
		t.Fatalf("cached glb: %d %q %q", r.Code, r.Header().Get("Content-Type"), r.Body.String())
	}
	if src.calls() != 1 {
		t.Fatalf("cached glb built %d more times, want 0", src.calls()-1)
	}

	// An unknown id is a 404.
	r = get("/api/spartan/poses/no:such:pose")
	if r.Code != http.StatusNotFound || !strings.Contains(r.Body.String(), "pose_not_found") {
		t.Fatalf("unknown id: %d %s", r.Code, r.Body.String())
	}
	// An id outside the character rule is a 400.
	for _, bad := range []string{"Bad_ID", "a%20b"} {
		r = get("/api/spartan/poses/" + bad)
		if r.Code != http.StatusBadRequest {
			t.Fatalf("bad id %q: %d %s", bad, r.Code, r.Body.String())
		}
	}
}

func TestSpartanPosesCatalogRetriesAfterFailure(t *testing.T) {
	src := &fakePoseSource{
		poses:    []mapmesh.Pose{{ID: "mp:intro_emote:any:any:i_see_you", Kind: mapmesh.PoseKindEmote}},
		listErrs: []error{fmt.Errorf("%w: game not reachable", errGameUnavailable)},
	}
	h, _ := poseTestHandlers(t, src)
	get := func(url string) *httptest.ResponseRecorder {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", url, nil))
		return r
	}
	// The first build fails; it is not cached.
	r := get("/api/spartan/poses")
	if r.Code != http.StatusServiceUnavailable || !strings.Contains(r.Body.String(), "game_unavailable") {
		t.Fatalf("first list: %d %s", r.Code, r.Body.String())
	}
	// The second request retries the build and gets the list.
	r = get("/api/spartan/poses")
	if r.Code != http.StatusOK {
		t.Fatalf("second list: %d %s", r.Code, r.Body.String())
	}
	var list struct {
		Poses []mapmesh.Pose `json:"poses"`
	}
	if err := json.Unmarshal(r.Body.Bytes(), &list); err != nil || len(list.Poses) != 1 ||
		list.Poses[0].ID != "mp:intro_emote:any:any:i_see_you" {
		t.Fatalf("second list body: %v %s", err, r.Body.String())
	}
}

func TestSpartanPosesGameUnavailable(t *testing.T) {
	src := &fakePoseSource{listErr: fmt.Errorf("%w: no installed map", errGameUnavailable)}
	h, _ := poseTestHandlers(t, src)
	get := func(url string) *httptest.ResponseRecorder {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", url, nil))
		return r
	}
	r := get("/api/spartan/poses")
	if r.Code != http.StatusServiceUnavailable || !strings.Contains(r.Body.String(), "game_unavailable") {
		t.Fatalf("list: %d %s", r.Code, r.Body.String())
	}
	r = get("/api/spartan/poses/mp:intro_emote:any:any:i_see_you")
	if r.Code != http.StatusServiceUnavailable || !strings.Contains(r.Body.String(), "game_unavailable") {
		t.Fatalf("glb: %d %s", r.Code, r.Body.String())
	}
}

func TestPoseIDValid(t *testing.T) {
	for id, want := range map[string]bool{
		"mp:intro_emote:any:any:i_see_you": true,
		"menu:stance:set-a:rare:stand":     true,
		"a":                                true,
		"":                                 false,
		"Bad":                              false,
		"a b":                              false,
		"a/b":                              false,
	} {
		if got := poseIDValid(id); got != want {
			t.Errorf("poseIDValid(%q) = %v, want %v", id, got, want)
		}
	}
}
