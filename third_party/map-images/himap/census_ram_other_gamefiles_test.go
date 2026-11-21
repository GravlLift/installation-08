// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build gamefiles && !windows

// LOCAL-CHANGE (infinite-theater-3d): ported from The Library with the census scope.
//
// census_ram_other_gamefiles_test.go — outside Windows the census scope has no free memory probe,
// so it opens no other module and the census is skipped.
package himap

import "errors"

// freePhysicalRAM always fails outside Windows.
func freePhysicalRAM() (uint64, error) {
	return 0, errors.New("no free memory probe on this system")
}
