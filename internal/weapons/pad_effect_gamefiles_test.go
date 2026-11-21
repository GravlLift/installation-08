// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build gamefiles

package weapons

import (
	"encoding/binary"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// TestPadEffectFromGame pins the references in the installed tags independently of renderer support.
func TestPadEffectFromGame(t *testing.T) {
	root, err := himap.DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	module := filepath.Join(root, "pc", "levels", "multi", "sgh_blueprint", "sgh_blueprint-rtx-new.module")
	paths, err := himap.GeometrySearchPathMonde(root, module)
	if err != nil {
		t.Fatal(err)
	}
	idx, err := himap.NewModuleIndex(paths...)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = idx.Close() }()

	for _, tag := range []struct {
		id   uint32
		size int
		refs []struct {
			offset int
			group  string
			id     uint32
		}
	}{
		{0xcf098056, 7694, []struct {
			offset int
			group  string
			id     uint32
		}{
			{0x107c, "gldf", 0x92275534}, {0x1220, "gldf", 0x5443c497},
			{0x1108, "lens", 0xc2f90227}, {0x1338, "lens", 0x37393001},
			{0x1398, "prt3", 0xcfecb502}, {0x1dc0, "lsnd", 0x0338979c},
		}},
		{0xcfecb502, 1816, []struct {
			offset int
			group  string
			id     uint32
		}{
			{0x3d8, "shdv", 0x7e36462d}, {0x538, "bitm", 0x4a769081}, {0x570, "bitm", 0x88361a52},
		}},
		{0x000024a6, 5492, []struct {
			offset int
			group  string
			id     uint32
		}{
			{0x1318, "osgd", 0x023bc98e}, {0x1334, "hsgd", 0x394f1a04},
		}},
		{0x023bc98e, 704, []struct {
			offset int
			group  string
			id     uint32
		}{
			{0x1b8, "ostd", 0xbc1c7256},
		}},
	} {
		raw, err := idx.Extract(tag.id)
		if err != nil {
			t.Fatalf("%08x: %v", tag.id, err)
		}
		if len(raw) != tag.size {
			t.Fatalf("%08x: %d bytes, want %d", tag.id, len(raw), tag.size)
		}
		for _, ref := range tag.refs {
			got := binary.LittleEndian.Uint32(raw[ref.offset:])
			group := string([]byte{raw[ref.offset+15], raw[ref.offset+14], raw[ref.offset+13], raw[ref.offset+12]})
			if got != ref.id || group != ref.group {
				t.Errorf("%08x+%x: %s %08x, want %s %08x", tag.id, ref.offset, group, got, ref.group, ref.id)
			}
		}
	}
}
