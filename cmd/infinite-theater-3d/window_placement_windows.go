// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build windows

package main

// window_placement_windows.go — the app window's remembered placement: size, position,
// maximized state, and the DPI it was captured at, in a small JSON file beside the
// WebView2 folder, restored at launch when it is still on a connected monitor. With no
// remembered placement, the default is the client area (the web view, under the title
// bar and menu bar) at exactly 16:9, appWindowWidth x appWindowHeight DIPs scaled to the
// primary monitor's DPI, shrunk keeping 16:9 if the outer window (client plus title bar,
// borders and the menu bar, from AdjustWindowRectExForDpi) would not fit the monitor's
// work area, and centered on it.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	procMonitorFromRect          = windows.NewLazySystemDLL("user32.dll").NewProc("MonitorFromRect")
	procGetWindowPlacement       = windows.NewLazySystemDLL("user32.dll").NewProc("GetWindowPlacement")
	procShowWindow               = windows.NewLazySystemDLL("user32.dll").NewProc("ShowWindow")
	procGetSystemMetrics         = windows.NewLazySystemDLL("user32.dll").NewProc("GetSystemMetrics")
	procGetDpiForWindow          = windows.NewLazySystemDLL("user32.dll").NewProc("GetDpiForWindow")
	procAdjustWindowRectExForDpi = windows.NewLazySystemDLL("user32.dll").NewProc("AdjustWindowRectExForDpi")
	procGetDpiForMonitor         = windows.NewLazySystemDLL("shcore.dll").NewProc("GetDpiForMonitor")
)

// Win32 constants the placement logic needs.
const (
	monitorDefaultTonull    = 0
	monitorDefaultToPrimary = 1
	swMaximize              = 3
	smCxScreen              = 0
	smCyScreen              = 1
	// mdtEffectiveDpi is shcore's MDT_EFFECTIVE_DPI: the DPI Windows actually scales the
	// monitor's content by (as opposed to MDT_ANGULAR_DPI/MDT_RAW_DPI, which this app never
	// needs).
	mdtEffectiveDpi = 0
	// wsOverlappedWindow is user32's WS_OVERLAPPEDWINDOW, the style webview_go creates the
	// app's top-level window with (third_party/webview_go/libs/webview/include/webview.h):
	// WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX |
	// WS_MAXIMIZEBOX. AdjustWindowRectExForDpi needs the real style to size the outer
	// window correctly; a mismatch would misjudge the title bar and border thickness.
	wsOverlappedWindow = 0x00CF0000
)

// windowPlacement is the saved state of the app window. DPI is the display scale
// Width/Height were captured at (0 for a placement from an older save, or the DPI-96
// default before this field existed): applyWindowPlacement rescales the size when the
// window reopens at a different DPI, so a remembered window keeps its real-world size
// instead of becoming too small (moving to a monitor with a higher scale) or spilling off
// the screen (a lower one).
type windowPlacement struct {
	X         int  `json:"x"`
	Y         int  `json:"y"`
	Width     int  `json:"width"`
	Height    int  `json:"height"`
	Maximized bool `json:"maximized"`
	DPI       int  `json:"dpi,omitempty"`
}

// windowPlacementFile is the placement record, beside the WebView2 folder.
func windowPlacementFile() string {
	return filepath.Join(filepath.Dir(webviewUserDataFolder()), "window.json")
}

// placementFromData is loadWindowPlacement with the file read and the monitor check
// given: the pure half, so tests drive it with an injected monitor check. It reports
// the placement usable only when it is a real window rect on a connected monitor.
func placementFromData(data []byte, monitorContains func(left, top, right, bottom int) bool) (windowPlacement, bool) {
	var p windowPlacement
	if err := json.Unmarshal(data, &p); err != nil {
		return windowPlacement{}, false
	}
	if p.Width <= 0 || p.Height <= 0 {
		return windowPlacement{}, false
	}
	if !monitorContains(p.X, p.Y, p.X+p.Width, p.Y+p.Height) {
		return windowPlacement{}, false
	}
	return p, true
}

// monitorContainsRect is the real monitor check: true when some connected monitor
// contains the rect, per MonitorFromRect with MONITOR_DEFAULTTONULL.
func monitorContainsRect(left, top, right, bottom int) bool {
	var rect windows.Rect
	rect.Left, rect.Top, rect.Right, rect.Bottom = int32(left), int32(top), int32(right), int32(bottom)
	hMon, _, _ := procMonitorFromRect.Call(uintptr(unsafe.Pointer(&rect)), monitorDefaultTonull)
	return hMon != 0
}

// loadWindowPlacement reads the saved placement; the zero placement with ok=false is
// the default (a fresh, centered window).
func loadWindowPlacement() (windowPlacement, bool) {
	data, err := os.ReadFile(windowPlacementFile())
	if err != nil {
		return windowPlacement{}, false
	}
	return placementFromData(data, monitorContainsRect)
}

// centeredPlacement centers an outer window of width x height on the primary screen (its
// full size, not its work area): the fallback default when a monitor's DPI or work area
// cannot be read at all, so the window still opens somewhere sane.
func centeredPlacement(width, height int) windowPlacement {
	sx, _, _ := procGetSystemMetrics.Call(smCxScreen)
	sy, _, _ := procGetSystemMetrics.Call(smCyScreen)
	return windowPlacement{
		X:      int(sx)/2 - width/2,
		Y:      int(sy)/2 - height/2,
		Width:  width,
		Height: height,
	}
}

// scaleForDpi scales a DIP (96-DPI) measurement to physical pixels at dpi, rounded to the
// nearest pixel.
func scaleForDpi(dip int, dpi uint32) int {
	return (dip*int(dpi) + 48) / 96
}

// rescaleDimension scales dim from fromDPI to toDPI; dim unchanged when either DPI is not
// known (<= 0) or they are equal. The pure half of applyWindowPlacement's cross-DPI restore.
func rescaleDimension(dim, fromDPI, toDPI int) int {
	if fromDPI <= 0 || toDPI <= 0 || fromDPI == toDPI {
		return dim
	}
	return dim * toDPI / fromDPI
}

// defaultPlacementFor is defaultWindowPlacement's pure half: the 16:9 client area at
// appWindowWidth x appWindowHeight DIPs scaled to dpi, the outer size adding chromeW x
// chromeH (title bar, borders and the menu bar's height, from AdjustWindowRectExForDpi at
// the same dpi), shrunk keeping 16:9 if that outer size would not fit within work, and
// centered on it.
func defaultPlacementFor(dpi uint32, chromeW, chromeH int, work windows.Rect) windowPlacement {
	clientW := scaleForDpi(appWindowWidth, dpi)
	clientH := scaleForDpi(appWindowHeight, dpi)
	workW := int(work.Right - work.Left)
	workH := int(work.Bottom - work.Top)
	outerW := clientW + chromeW
	outerH := clientH + chromeH
	if (outerW > workW || outerH > workH) && workW > chromeW && workH > chromeH {
		maxClientW := workW - chromeW
		maxClientH := workH - chromeH
		if maxClientW*9 > maxClientH*16 {
			// Height is the binding constraint: width has more room than 16:9 needs.
			clientW = maxClientH * 16 / 9
			clientH = maxClientH
		} else {
			clientW = maxClientW
			clientH = maxClientW * 9 / 16
		}
		outerW = clientW + chromeW
		outerH = clientH + chromeH
	}
	return windowPlacement{
		X:      int(work.Left) + (workW-outerW)/2,
		Y:      int(work.Top) + (workH-outerH)/2,
		Width:  outerW,
		Height: outerH,
		DPI:    int(dpi),
	}
}

// monitorDPI is hMon's effective DPI (shcore's GetDpiForMonitor); ok is false when the
// call fails (an HRESULT other than S_OK).
func monitorDPI(hMon uintptr) (dpi uint32, ok bool) {
	var dpiX, dpiY uint32
	ret, _, _ := procGetDpiForMonitor.Call(hMon, mdtEffectiveDpi, uintptr(unsafe.Pointer(&dpiX)), uintptr(unsafe.Pointer(&dpiY)))
	if ret != 0 { // S_OK is 0; anything else is a failure HRESULT.
		return 0, false
	}
	return dpiX, true
}

// monitorWorkArea is hMon's work area (GetMonitorInfoW's RcWork): the screen area excluding
// the taskbar and other docked bars. ok is false when the call fails or reports an empty
// rect.
func monitorWorkArea(hMon uintptr) (work windows.Rect, ok bool) {
	var mi monitorInfo
	mi.CbSize = uint32(unsafe.Sizeof(mi))
	ret, _, _ := procGetMonitorInfoW.Call(hMon, uintptr(unsafe.Pointer(&mi)))
	if ret == 0 || mi.RcWork.Right-mi.RcWork.Left <= 0 || mi.RcWork.Bottom-mi.RcWork.Top <= 0 {
		return windows.Rect{}, false
	}
	return mi.RcWork, true
}

// outerSizeForClient is the outer window size AdjustWindowRectExForDpi reports for a
// wsOverlappedWindow window with a menu bar, at dpi, around a clientW x clientH client
// area. ok is false when the call fails.
func outerSizeForClient(clientW, clientH int, dpi uint32) (outerW, outerH int, ok bool) {
	r := windows.Rect{Left: 0, Top: 0, Right: int32(clientW), Bottom: int32(clientH)}
	const hasMenu = 1
	ret, _, _ := procAdjustWindowRectExForDpi.Call(
		uintptr(unsafe.Pointer(&r)), wsOverlappedWindow, hasMenu, 0, uintptr(dpi))
	if ret == 0 {
		return 0, 0, false
	}
	return int(r.Right - r.Left), int(r.Bottom - r.Top), true
}

// defaultWindowPlacement is the window's placement with no remembered one (see the file
// doc comment). It reads the primary monitor's DPI and work area, and the WS_OVERLAPPEDWINDOW
// plus menu bar chrome at that DPI, before the window exists (GetDpiForMonitor, not
// GetDpiForWindow, since there is no window yet); any read that fails falls back to
// centeredPlacement at a DPI-96 size, so the window always opens somewhere sane.
func defaultWindowPlacement() windowPlacement {
	hMon, _, _ := procMonitorFromWindow.Call(0, 0, monitorDefaultToPrimary)
	if hMon == 0 {
		return centeredPlacement(appWindowWidth, appWindowHeight)
	}
	dpi, ok := monitorDPI(hMon)
	if !ok {
		dpi = 96
	}
	work, ok := monitorWorkArea(hMon)
	if !ok {
		return centeredPlacement(scaleForDpi(appWindowWidth, dpi), scaleForDpi(appWindowHeight, dpi))
	}
	clientW := scaleForDpi(appWindowWidth, dpi)
	clientH := scaleForDpi(appWindowHeight, dpi)
	outerW, outerH, ok := outerSizeForClient(clientW, clientH, dpi)
	if !ok {
		// No AdjustWindowRectExForDpi to size the chrome: the (unadjusted) client size is
		// still a reasonable outer size, just missing the title bar and menu's height.
		outerW, outerH = clientW, clientH
	}
	return defaultPlacementFor(dpi, outerW-clientW, outerH-clientH, work)
}

// winPoint is a user32 POINT.
type winPoint struct {
	X int32
	Y int32
}

// windowPlacementNative is user32's WINDOWPLACEMENT.
type windowPlacementNative struct {
	Length           uint32
	Flags            uint32
	ShowCmd          uint32
	PtMinPosition    winPoint
	PtMaxPosition    winPoint
	RcNormalPosition windows.Rect
}

// captureWindowPlacement reads the window's placement: the normal (restored) rect, the
// maximized state, and the DPI it is showing at (GetDpiForWindow), so a later restore at a
// different scale can rescale it. It runs on the main OS thread.
func captureWindowPlacement(hwnd windows.Handle) windowPlacement {
	var wp windowPlacementNative
	wp.Length = uint32(unsafe.Sizeof(wp))
	if _, _, _ = procGetWindowPlacement.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&wp))); wp.RcNormalPosition.Right-wp.RcNormalPosition.Left <= 0 {
		return windowPlacement{}
	}
	return windowPlacement{
		X:         int(wp.RcNormalPosition.Left),
		Y:         int(wp.RcNormalPosition.Top),
		Width:     int(wp.RcNormalPosition.Right - wp.RcNormalPosition.Left),
		Height:    int(wp.RcNormalPosition.Bottom - wp.RcNormalPosition.Top),
		Maximized: wp.ShowCmd == swMaximize,
		DPI:       int(windowDPI(hwnd)),
	}
}

// windowDPI is hwnd's current DPI (user32's GetDpiForWindow); 96 (DPI-unaware default) when
// the call fails, so a caller never has to special-case a zero.
func windowDPI(hwnd windows.Handle) uint32 {
	dpi, _, _ := procGetDpiForWindow.Call(uintptr(hwnd))
	if dpi == 0 {
		return 96
	}
	return uint32(dpi)
}

// saveWindowPlacement writes the placement record. It is best effort: a failure to
// write loses at most the remembered placement, so it reports nothing.
func saveWindowPlacement(p windowPlacement) {
	if p.Width <= 0 || p.Height <= 0 {
		return
	}
	data, err := json.Marshal(p)
	if err != nil {
		return
	}
	_ = os.WriteFile(windowPlacementFile(), data, 0o644)
}

// applyWindowPlacement places the freshly created window: maximized when the saved state
// was maximized, else at the saved (or default) rect. When p carries the DPI it was
// captured at and that differs from the DPI of the monitor the rect would land on, the
// size is rescaled first (rescaleDimension), so a placement saved at one display scale
// still looks the same real-world size restored at another. It runs on the main OS
// thread.
//
// The rect is applied twice: when it lands on a monitor of another DPI than the one the
// window was created on, the first move raises WM_DPICHANGED and webview_go applies the
// rect Windows suggests, rescaling the already rescaled size a second time; the second call
// lands on the same monitor and sets the intended size. A maximized placement is moved to
// its rect first, so it maximizes on the monitor it was saved on and keeps its restored
// size.
func applyWindowPlacement(hwnd windows.Handle, p windowPlacement) {
	width, height := p.Width, p.Height
	if p.DPI > 0 {
		rect := windows.Rect{Left: int32(p.X), Top: int32(p.Y), Right: int32(p.X + p.Width), Bottom: int32(p.Y + p.Height)}
		if hMon, _, _ := procMonitorFromRect.Call(uintptr(unsafe.Pointer(&rect)), monitorDefaultTonearest); hMon != 0 {
			if targetDPI, ok := monitorDPI(hMon); ok {
				width = rescaleDimension(width, p.DPI, int(targetDPI))
				height = rescaleDimension(height, p.DPI, int(targetDPI))
			}
		}
	}
	for range 2 {
		_, _, _ = procSetWindowPos.Call(uintptr(hwnd), 0,
			uintptr(p.X), uintptr(p.Y), uintptr(width), uintptr(height),
			swpNoZOrder|swpNoActivate)
	}
	if p.Maximized {
		_, _, _ = procShowWindow.Call(uintptr(hwnd), swMaximize)
	}
}
