package main

import (
	"context"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
)

func TestVariantRoutes(t *testing.T) {
	root := meshTestStore(t)
	var calls atomic.Int32
	release := make(chan struct{})
	runner, err := meshjobs.New(func(ctx context.Context, key, game, out string) (meshjobs.BuildResult, error) {
		calls.Add(1)
		select {
		case <-release:
		case <-ctx.Done():
			return meshjobs.BuildResult{}, ctx.Err()
		}
		return meshjobs.BuildResult{}, root.WriteFile(variantPath(root, "abc", "variant.glb"), []byte("glTF"))
	}, "", func(key string) bool {
		_, err := os.Stat(variantPath(root, "abc", "variant.glb"))
		return err == nil
	})
	if err != nil {
		t.Fatal(err)
	}
	runner.Start()
	t.Cleanup(func() { runner.Stop(time.Second) })
	h := newTestHandlers(root, runner)
	base := "/api/matches/abc/variant"
	rec := get(t, h, base+".glb", nil)
	if rec.Code != 404 || !strings.Contains(rec.Body.String(), "variant_no_mvar") {
		t.Fatal(rec.Code, rec.Body)
	}
	if err := root.WriteFile(variantPath(root, "abc", "map.mvar"), []byte("mvar")); err != nil {
		t.Fatal(err)
	}
	rec = get(t, h, base+".glb", nil)
	if rec.Code != 404 || !strings.Contains(rec.Body.String(), "variant_not_built") {
		t.Fatal(rec.Code, rec.Body)
	}
	rec = get(t, h, base+"/state", nil)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "absent") {
		t.Fatal(rec.Code, rec.Body)
	}
	rec = postMesh(t, h, base+"/build", map[string]string{"Origin": "https://evil.example"})
	if rec.Code != http.StatusForbidden {
		t.Fatal(rec.Code, rec.Body)
	}
	for i := 0; i < 2; i++ {
		rec = postMesh(t, h, base+"/build", nil)
		if rec.Code != 202 {
			t.Fatal(rec.Code, rec.Body)
		}
	}
	close(release)
	waitMeshReady(t, h, base+"/state")
	if calls.Load() != 1 {
		t.Fatalf("builds = %d", calls.Load())
	}
	rec = get(t, h, base+".glb", nil)
	if rec.Code != 200 || rec.Body.String() != "glTF" {
		t.Fatal(rec.Code, rec.Body)
	}
	// The browser keeps the built file and revalidates it: same file, 304 with no body.
	etag := rec.Header().Get("ETag")
	if etag == "" || rec.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("validators: etag %q, cache-control %q", etag, rec.Header().Get("Cache-Control"))
	}
	rec = get(t, h, base+".glb", map[string]string{"If-None-Match": etag})
	if rec.Code != http.StatusNotModified || rec.Body.Len() != 0 {
		t.Fatal(rec.Code, rec.Body.Len())
	}
	// A rebuild changes the file, so the old validator gets the new bytes.
	if err := root.WriteFile(variantPath(root, "abc", "variant.glb"), []byte("glTF2")); err != nil {
		t.Fatal(err)
	}
	rec = get(t, h, base+".glb", map[string]string{"If-None-Match": etag})
	if rec.Code != 200 || rec.Body.String() != "glTF2" {
		t.Fatal(rec.Code, rec.Body)
	}
}

// TestVariantQualityRoutes — a match variant's ?quality=high is a separate job
// (variant:<id>.high) and file (variant.high.glb) from standard, and an unknown quality
// name is a 400 on the variant routes.
func TestVariantQualityRoutes(t *testing.T) {
	root := meshTestStore(t)
	if err := root.WriteFile(variantPath(root, "abc", "map.mvar"), []byte("mvar")); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	nameOf := func(quality meshjobs.Quality) string {
		if quality == meshjobs.QualityHigh {
			return "variant.high.glb"
		}
		return "variant.glb"
	}
	runner, err := meshjobs.New(func(ctx context.Context, key, game, out string) (meshjobs.BuildResult, error) {
		calls.Add(1)
		// No SetDest here: the build writes its own quality-aware file name.
		_, quality := meshjobs.SplitQuality(key)
		return meshjobs.BuildResult{}, root.WriteFile(variantPath(root, "abc", nameOf(quality)), []byte("glTF"))
	}, "", func(key string) bool {
		_, quality := meshjobs.SplitQuality(key)
		_, statErr := os.Stat(variantPath(root, "abc", nameOf(quality)))
		return statErr == nil
	})
	if err != nil {
		t.Fatal(err)
	}
	runner.Start()
	t.Cleanup(func() { runner.Stop(time.Second) })
	h := newTestHandlers(root, runner)
	base := "/api/matches/abc/variant"

	// Unknown quality: 400 on GET (file + state) and POST build.
	for _, path := range []string{base + ".glb?quality=ultra", base + "/state?quality=ultra"} {
		rec := get(t, h, path, nil)
		if rec.Code != 400 || !strings.Contains(rec.Body.String(), "unknown_quality") {
			t.Fatalf("%s: status=%d body=%s, want 400 unknown_quality", path, rec.Code, rec.Body.String())
		}
	}
	rec := postMesh(t, h, base+"/build?quality=ultra", nil)
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), "unknown_quality") {
		t.Fatalf("build?quality=ultra: status=%d body=%s, want 400", rec.Code, rec.Body.String())
	}

	// High builds to variant.high.glb under its own job; standard stays absent.
	rec = postMesh(t, h, base+"/build?quality=high", nil)
	if rec.Code != 202 {
		t.Fatalf("high build status = %d; body=%s", rec.Code, rec.Body.String())
	}
	body := waitMeshReady(t, h, base+"/state?quality=high")
	if !strings.Contains(body, `"quality":"high"`) {
		t.Fatalf("high state = %s, want quality high", body)
	}
	if _, err := os.Stat(variantPath(root, "abc", "variant.high.glb")); err != nil {
		t.Fatalf("variant.high.glb missing: %v", err)
	}
	if _, err := os.Stat(variantPath(root, "abc", "variant.glb")); !os.IsNotExist(err) {
		t.Fatalf("standard variant.glb created by a high build: %v", err)
	}
	rec = get(t, h, base+"/state", nil)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "absent") {
		t.Fatalf("standard state after high build = %d %s, want absent", rec.Code, rec.Body.String())
	}

	// Standard builds beside it, as a second, separate job.
	postMesh(t, h, base+"/build", nil)
	waitMeshReady(t, h, base+"/state")
	if calls.Load() != 2 {
		t.Fatalf("builds = %d, want 2 (high and standard are separate jobs)", calls.Load())
	}
	if _, err := os.Stat(variantPath(root, "abc", "variant.glb")); err != nil {
		t.Fatalf("variant.glb missing: %v", err)
	}
	if rec := get(t, h, base+".glb", nil); rec.Code != 200 {
		t.Fatalf("standard variant status = %d", rec.Code)
	}
	if rec := get(t, h, base+".glb?quality=high", nil); rec.Code != 200 {
		t.Fatalf("high variant status = %d", rec.Code)
	}
}
