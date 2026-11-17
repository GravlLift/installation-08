// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weaponicons

import "testing"

func TestGrenadeHUDSources(t *testing.T) {
	want := map[string]hudSource{
		"Frag":   {atlas: 0xa2dcd69e, index: 0},
		"Plasma": {atlas: 0xa2dcd69e, index: 1},
		"Dynamo": {atlas: 0xa2dcd69e, index: 3},
		"Spike":  {atlas: 0xa2dcd69e, index: 2},
	}
	for stem, source := range want {
		if got := hudSources[stem]; got != source {
			t.Errorf("%s source = %+v, want %+v", stem, got, source)
		}
	}
}
