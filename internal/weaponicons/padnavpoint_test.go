// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weaponicons

import "testing"

func TestReadPadNavpointRejectsInvalidTag(t *testing.T) {
	if _, err := ReadPadNavpoint([]byte("invalid")); err == nil {
		t.Fatal("invalid tag accepted")
	}
}
