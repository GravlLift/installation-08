//go:build windows

package main

// window_icon_windows.go — sets the app window's title-bar and taskbar icon from the exe's
// own icon resource.
//
// webview_go's window class always loads IDI_APPLICATION, the generic system "window" icon,
// never the module's own icon resource (third_party/webview_go/libs/webview/include/
// webview.h, win32_edge_engine's constructor: `LoadImage(hInstance, IDI_APPLICATION, ...)`
// before `RegisterClassExW`). That is upstream, unmodified code, so the app's real icon
// (resources.rc, "1 ICON ...") is set here instead, once the window exists, with
// WM_SETICON: ICON_BIG (title bar, Alt+Tab) and ICON_SMALL (taskbar, window list) at the
// sizes Windows wants for this window's current per-monitor DPI.

import (
	"golang.org/x/sys/windows"
)

var (
	procLoadImageW            = windows.NewLazySystemDLL("user32.dll").NewProc("LoadImageW")
	procSendMessageWIcon      = windows.NewLazySystemDLL("user32.dll").NewProc("SendMessageW")
	procGetSystemMetricsForDP = windows.NewLazySystemDLL("user32.dll").NewProc("GetSystemMetricsForDpi")
	procGetModuleHandleW      = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetModuleHandleW")
)

// Win32 constants setAppWindowIcon needs.
const (
	imageIcon         = 1
	lrDefaultColor    = 0x00000000
	wmSetIcon         = 0x0080
	iconSmall         = 0
	iconBig           = 1
	smCxIcon          = 11
	smCyIcon          = 12
	smCxSmIcon        = 49
	smCySmIcon        = 50
	appIconResourceID = 1 // resources.rc: "1 ICON ...", the exe's first icon resource.
)

// setAppWindowIcon loads the app's own icon at the big (title bar, Alt+Tab) and small
// (taskbar) sizes for hwnd's current DPI, and sets it with WM_SETICON. Best effort: any
// failure leaves webview_go's default IDI_APPLICATION icon in place, never fatal.
func setAppWindowIcon(hwnd windows.Handle) {
	hInstance, _, _ := procGetModuleHandleW.Call(0)
	if hInstance == 0 {
		return
	}
	dpi := windowDPI(hwnd)
	if big := loadAppIcon(hInstance, systemMetricForDPI(smCxIcon, dpi), systemMetricForDPI(smCyIcon, dpi)); big != 0 {
		_, _, _ = procSendMessageWIcon.Call(uintptr(hwnd), wmSetIcon, iconBig, big)
	}
	if small := loadAppIcon(hInstance, systemMetricForDPI(smCxSmIcon, dpi), systemMetricForDPI(smCySmIcon, dpi)); small != 0 {
		_, _, _ = procSendMessageWIcon.Call(uintptr(hwnd), wmSetIcon, iconSmall, small)
	}
}

// systemMetricForDPI is user32's GetSystemMetricsForDpi: the DPI-aware form of
// GetSystemMetrics, needed because this is a per-monitor-v2 DPI aware process (app.manifest)
// and the window may not be on the primary monitor's DPI.
func systemMetricForDPI(index int, dpi uint32) int {
	v, _, _ := procGetSystemMetricsForDP.Call(uintptr(index), uintptr(dpi))
	return int(int32(v))
}

// loadAppIcon loads the exe's own icon resource (appIconResourceID) at cx x cy from
// hInstance; 0 on failure.
func loadAppIcon(hInstance uintptr, cx, cy int) uintptr {
	h, _, _ := procLoadImageW.Call(hInstance, uintptr(appIconResourceID), imageIcon, uintptr(cx), uintptr(cy), lrDefaultColor)
	return h
}
