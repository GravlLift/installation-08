// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build windows

package main

import "testing"

// TestCloseGuard — a WM_CLOSE closes outright while nothing is running; while an
// export runs it defers to the user's answer, and a No keeps the window open.
func TestCloseGuard(t *testing.T) {
	g := &closeGuard{}

	// Not busy: the close proceeds without asking.
	asked := false
	if !g.closeAllowed(func() bool { asked = true; return true }) {
		t.Errorf("idle close declined, want it to proceed")
	}
	if asked {
		t.Errorf("idle close asked the user, want it to proceed without asking")
	}

	// Busy: the answer decides. Yes closes, No does not.
	g.setBusy(true)
	if g.closeAllowed(func() bool { return false }) {
		t.Errorf("busy close with a No proceeded, want it declined")
	}
	if !g.closeAllowed(func() bool { return true }) {
		t.Errorf("busy close with a Yes declined, want it to proceed")
	}

	// The flag is the it3dExportBusy binding's state: back to false, the close
	// proceeds without asking again.
	g.setBusy(false)
	asked = false
	if !g.closeAllowed(func() bool { asked = true; return true }) {
		t.Errorf("close after the export ended declined, want it to proceed")
	}
	if asked {
		t.Errorf("close after the export ended asked the user, want it to proceed without asking")
	}
}
