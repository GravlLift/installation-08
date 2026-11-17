// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build windows

package main

// window_closeguard_windows.go — the app window's close guard: while the page says an
// export is running, a WM_CLOSE asks before closing, and a No keeps the window open.

import (
	"unsafe"

	"sync/atomic"

	"golang.org/x/sys/windows"
)

// Win32 constants the close guard needs.
const (
	mbYesNo = 0x00000004
	idYes   = 6
)

// closeGuard tracks, on one atomic flag, whether an export is running in the page. The
// flag is written by the it3dExportBusy binding (any thread) and read on a WM_CLOSE
// (the main OS thread).
type closeGuard struct {
	busy atomic.Bool
}

// setBusy is the it3dExportBusy binding's body.
func (g *closeGuard) setBusy(busy bool) { g.busy.Store(busy) }

// closeAllowed decides a WM_CLOSE: it closes outright when nothing is running; while an
// export runs it defers to ask, the user's answer to "close anyway?" (true: close).
func (g *closeGuard) closeAllowed(ask func() bool) bool {
	if !g.busy.Load() {
		return true
	}
	return ask()
}

// askCloseWhileExportRunning shows the close guard's Yes/No dialog and reports the
// answer: true when the user chose Yes. It runs on the main OS thread, inside the
// WM_CLOSE that triggered it.
func askCloseWhileExportRunning() bool {
	text := "An export is still running. Close anyway?"
	ret, _, _ := procMessageBoxW.Call(0,
		uintptr(unsafe.Pointer(windows.StringToUTF16Ptr(text))),
		uintptr(unsafe.Pointer(windows.StringToUTF16Ptr(appDisplayName))), mbYesNo)
	return ret == idYes
}
