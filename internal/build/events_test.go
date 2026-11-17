// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package build

import (
	"encoding/json"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/highlightevent"
)

func TestEventSidecarRoundTrip(t *testing.T) {
	want := []highlightevent.HighlightEvent{{XUID: 2535444383025750, Gamertag: "Player", EventType: "medal", TypeHint: 50, IsMedal: true, TimeMS: 12345, MedalType: 26}}
	data, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	var got []highlightevent.HighlightEvent
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0] != want[0] {
		t.Fatalf("round trip: %+v", got)
	}
	if name, ok := MedalName(got[0].TypeHint, got[0].MedalType); !ok || name != "Killjoy" {
		t.Fatalf("medal: %q %v", name, ok)
	}
}
