package main

import (
	"strings"
	"testing"
)

func TestRunBuildMeshMissingFlags(t *testing.T) {
	if err := runBuildMesh([]string{}); err == nil || !strings.Contains(err.Error(), "--map and --out are required") {
		t.Fatalf("missing flags: %v", err)
	}
	if err := runBuildMesh([]string{"--map", "sgh_blueprint"}); err == nil || !strings.Contains(err.Error(), "--map and --out are required") {
		t.Fatalf("missing --out: %v", err)
	}
}
