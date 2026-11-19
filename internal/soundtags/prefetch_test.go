// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package soundtags

import (
	"encoding/binary"
	"testing"
)

func TestPrefetchedTellsACutMediaFromAWholeOne(t *testing.T) {
	riff := func(announced, held int) []byte {
		b := make([]byte, held)
		copy(b, "RIFF")
		binary.LittleEndian.PutUint32(b[4:], uint32(announced-8))
		return b
	}
	if prefetched(riff(100, 100)) {
		t.Fatal("a whole media read as prefetched")
	}
	if !prefetched(riff(4096, 100)) {
		t.Fatal("a cut media read as whole")
	}
	if prefetched([]byte("OggS....")) || prefetched(nil) {
		t.Fatal("a non-RIFF media read as prefetched")
	}
}
