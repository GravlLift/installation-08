// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build windows

package main

import "testing"

// TestWindowLimits — the minimum scales with the DPI, the maximum stays in physical pixels,
// and both add the window's non-client parts (client limits, window sizes out).
func TestWindowLimits(t *testing.T) {
	for _, c := range []struct {
		dpi, ncW, ncH          int32
		minW, minH, maxW, maxH int32
	}{
		{96, 16, 59, 1040, 699, 5136, 2219},
		{144, 22, 80, 1558, 1040, 5142, 2240},
		{0, 0, 0, 1024, 640, 5120, 2160}, // no DPI read: 96
	} {
		minW, minH, maxW, maxH := windowLimits(c.dpi, c.ncW, c.ncH)
		if minW != c.minW || minH != c.minH || maxW != c.maxW || maxH != c.maxH {
			t.Errorf("dpi %d nc %dx%d: got min %dx%d max %dx%d, want min %dx%d max %dx%d",
				c.dpi, c.ncW, c.ncH, minW, minH, maxW, maxH, c.minW, c.minH, c.maxW, c.maxH)
		}
	}
}
