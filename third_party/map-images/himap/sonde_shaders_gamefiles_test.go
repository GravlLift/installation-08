//go:build gamefiles

package himap

// sonde_shaders_gamefiles_test.go — sonde : groupe et chaines lisibles des shaders de materiau
// designes par LEVELUP_SONDE_SHADERS (GlobalID hexa separes par des virgules).

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestSondeShaders(t *testing.T) {
	root, err := DeployRoot()
	if err != nil {
		t.Skipf("installation absente : %v", err)
	}
	liste := os.Getenv("LEVELUP_SONDE_SHADERS")
	if liste == "" {
		t.Skip("LEVELUP_SONDE_SHADERS vide")
	}
	var tous []string
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() && filepath.Ext(p) == ".module" {
			tous = append(tous, p)
		}
		return nil
	})
	idx, err := NewModuleIndex(tous...)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = idx.Close() }()
	for _, h := range strings.Split(liste, ",") {
		v, err := strconv.ParseUint(strings.TrimSpace(h), 16, 32)
		if err != nil {
			t.Fatal(err)
		}
		id := uint32(v)
		g, m, ok := idx.Lookup(id)
		if !ok {
			t.Logf("%08x : absent", id)
			continue
		}
		tag, err := idx.Extract(id)
		if err != nil {
			t.Logf("%08x : %v", id, err)
			continue
		}
		rel, _ := filepath.Rel(root, m)
		t.Logf("%08x [%s] %s %d o : %q", id, g, rel, len(tag), chainesLisibles(tag, 5, 25))
	}
}
