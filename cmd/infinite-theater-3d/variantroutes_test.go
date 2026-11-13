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
}
