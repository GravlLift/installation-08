package himap

import (
	"encoding/binary"
	"reflect"
	"testing"
)

// TestPremiersProjectiles : la premiere reference de projectile de chaque element, et rien quand un
// element n'en porte pas.
func TestPremiersProjectiles(t *testing.T) {
	bloc := make([]byte, 3*16)
	pose := func(o int, v uint32) { binary.LittleEndian.PutUint32(bloc[o:], v) }
	pose(4, 0xaaaa)
	pose(8, 0xbbbb)
	pose(16+12, 0xcccc)
	pose(32, 0xdddd)
	pose(36, 0x1234)
	projs := map[uint32]bool{0xaaaa: true, 0xbbbb: true, 0xcccc: true, 0xdddd: true}
	if got, want := premiersProjectiles(bloc, 3, projs), []uint32{0xaaaa, 0xcccc, 0xdddd}; !reflect.DeepEqual(got, want) {
		t.Errorf("projectiles = %x, attendu %x", got, want)
	}
	delete(projs, 0xcccc)
	if got := premiersProjectiles(bloc, 3, projs); got != nil {
		t.Errorf("element sans projectile : %x, attendu nil", got)
	}
}
