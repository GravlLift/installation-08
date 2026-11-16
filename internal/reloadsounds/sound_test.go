package reloadsounds

import (
	"encoding/binary"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/soundtags"
)

// testSound builds a sound tag whose tag data names event at +0x14 and bank at +0x2c.
func testSound(t *testing.T, deps []testDep, event, bank uint32, size int) *testTag {
	t.Helper()
	tt := &testTag{deps: deps}
	data := make([]byte, size)
	if size >= soundtags.ThirdPersonBankOff+4 {
		binary.LittleEndian.PutUint32(data[soundtags.ThirdPersonEventOff:], event)
		binary.LittleEndian.PutUint32(data[soundtags.ThirdPersonBankOff:], bank)
	}
	tt.block(data)
	return tt
}

func TestThirdPersonEventNeedsItsBankAmongTheDependencies(t *testing.T) {
	deps := []testDep{{"sbnk", 0xC1}, {"snd!", 0xC2}}
	event, bank, ok := soundtags.Event(testSound(t, deps, 0x1234, 0xC1, 0x60).parse(t))
	if !ok || event != 0x1234 || bank != 0xC1 {
		t.Fatalf("event %08x bank %08x ok %v", event, bank, ok)
	}
	cases := map[string]*testTag{
		"bank not a dependency":    testSound(t, deps, 0x1234, 0xC9, 0x60),
		"bank a sound, not a bank": testSound(t, deps, 0x1234, 0xC2, 0x60),
		"no event":                 testSound(t, deps, 0, 0xC1, 0x60),
		"tag data too short":       testSound(t, deps, 0, 0, soundtags.ThirdPersonBankOff),
	}
	for name, tt := range cases {
		if _, _, ok := soundtags.Event(tt.parse(t)); ok {
			t.Errorf("%s: read a third-person event", name)
		}
	}
}
