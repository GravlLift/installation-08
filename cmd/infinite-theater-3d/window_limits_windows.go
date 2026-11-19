// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build windows

package main

// window_limits_windows.go — the app window's size limits, answered on WM_GETMINMAXINFO by
// the subclassed window procedure (window_menu_windows.go).
//
// The MINIMUM is a client area of 1024x640 at 100% scale, scaled by the window's DPI: below it
// the pages' layouts (the player's strip, stage and transport; the home lists) stop fitting.
// The MAXIMUM is a client area of 5120x2160 physical pixels: past it the 3D view's render
// targets grow with no screen to show them on. It is physical, not scaled, because the render
// cost is counted in physical pixels; a 5120x2160 monitor still maximizes to its full work area.
// The limits are client sizes; Windows wants window sizes, so the frame, caption and menu bar
// the window has at that moment are added.

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	wmGetMinMaxInfo = 0x0024

	windowMinClientW = 1024 // at 96 DPI
	windowMinClientH = 640
	windowMaxClientW = 5120 // physical pixels
	windowMaxClientH = 2160
)

var procGetClientRect = windows.NewLazySystemDLL("user32.dll").NewProc("GetClientRect")

// minMaxInfo is user32's MINMAXINFO.
type minMaxInfo struct {
	Reserved     [2]int32
	MaxSize      [2]int32
	MaxPosition  [2]int32
	MinTrackSize [2]int32
	MaxTrackSize [2]int32
}

// windowLimits returns the minimum and maximum WINDOW sizes for a window at dpi whose
// non-client parts (frame, caption, menu bar) add ncW and ncH to its client area.
func windowLimits(dpi, ncW, ncH int32) (minW, minH, maxW, maxH int32) {
	if dpi <= 0 {
		dpi = 96
	}
	minW = windowMinClientW*dpi/96 + ncW
	minH = windowMinClientH*dpi/96 + ncH
	maxW = windowMaxClientW + ncW
	maxH = windowMaxClientH + ncH
	return
}

// applyWindowLimits writes the limits into the MINMAXINFO a WM_GETMINMAXINFO points at, after
// the original procedure has filled it. The maximum never goes below the minimum, and the
// maximized size keeps Windows' own value when it is already smaller (a monitor smaller than
// the cap maximizes to its work area as before).
func applyWindowLimits(hwnd windows.Handle, lParam uintptr) {
	if lParam == 0 {
		return
	}
	var wr, cr windows.Rect
	if r, _, _ := procGetWindowRect.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&wr))); r == 0 {
		return
	}
	if r, _, _ := procGetClientRect.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&cr))); r == 0 {
		return
	}
	ncW := (wr.Right - wr.Left) - (cr.Right - cr.Left)
	ncH := (wr.Bottom - wr.Top) - (cr.Bottom - cr.Top)
	if ncW < 0 || ncH < 0 {
		return
	}
	dpi, _, _ := procGetDpiForWindow.Call(uintptr(hwnd))
	minW, minH, maxW, maxH := windowLimits(int32(dpi), ncW, ncH)
	// A small screen (a 1366x768 laptop at 125%) cannot hold the minimum: it then shrinks to
	// the monitor's work area, so the window always fits on the screen it is on.
	hMon, _, _ := procMonitorFromWindow.Call(uintptr(hwnd), monitorDefaultTonearest)
	var mi monitorInfo
	mi.CbSize = uint32(unsafe.Sizeof(mi))
	if r, _, _ := procGetMonitorInfoW.Call(hMon, uintptr(unsafe.Pointer(&mi))); r != 0 {
		minW = min(minW, mi.RcWork.Right-mi.RcWork.Left)
		minH = min(minH, mi.RcWork.Bottom-mi.RcWork.Top)
	}
	mmi := *(**minMaxInfo)(unsafe.Pointer(&lParam)) // lParam is a pointer the system owns for this call
	mmi.MinTrackSize = [2]int32{minW, minH}
	mmi.MaxTrackSize = [2]int32{max(maxW, minW), max(maxH, minH)}
	if mmi.MaxSize[0] > mmi.MaxTrackSize[0] {
		mmi.MaxSize[0] = mmi.MaxTrackSize[0]
	}
	if mmi.MaxSize[1] > mmi.MaxTrackSize[1] {
		mmi.MaxSize[1] = mmi.MaxTrackSize[1]
	}
}
