//go:build windows

package main

// window_placement_windows.go — the app window's remembered placement: size, position,
// and maximized state in a small JSON file beside the WebView2 folder, restored at
// launch when it is still on a connected monitor.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	procMonitorFromRect     = windows.NewLazySystemDLL("user32.dll").NewProc("MonitorFromRect")
	procGetWindowPlacement  = windows.NewLazySystemDLL("user32.dll").NewProc("GetWindowPlacement")
	procShowWindow          = windows.NewLazySystemDLL("user32.dll").NewProc("ShowWindow")
	procGetSystemMetrics    = windows.NewLazySystemDLL("user32.dll").NewProc("GetSystemMetrics")
)

// Win32 constants the placement logic needs.
const (
	monitorDefaultTonull = 0
	swMaximize           = 3
	smCxScreen           = 0
	smCyScreen           = 1
)

// windowPlacement is the saved state of the app window.
type windowPlacement struct {
	X         int `json:"x"`
	Y         int `json:"y"`
	Width     int `json:"width"`
	Height    int `json:"height"`
	Maximized bool `json:"maximized"`
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

// centeredPlacement is the default: appWindowWidth x appWindowHeight centered on the
// primary screen.
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

// captureWindowPlacement reads the window's placement: the normal (restored) rect and
// the maximized state. It runs on the main OS thread.
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
	}
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

// applyWindowPlacement places the freshly created window: maximized when the saved
// state was maximized, else at the saved (or default, centered) rect. It runs on the
// main OS thread.
func applyWindowPlacement(hwnd windows.Handle, p windowPlacement) {
	if p.Maximized {
		_, _, _ = procShowWindow.Call(uintptr(hwnd), swMaximize)
		return
	}
	_, _, _ = procSetWindowPos.Call(uintptr(hwnd), 0,
		uintptr(p.X), uintptr(p.Y), uintptr(p.Width), uintptr(p.Height),
		swpNoZOrder|swpNoActivate)
}
