// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build windows

package main

// window_menu_windows.go — the app window's native Win32 menu bar (File/View/Help),
// the menu command to action table, the subclassed window procedure that routes menu
// commands, and the keydown injection that makes F11 and Ctrl+R work while focus is
// inside the WebView2 child, which swallows keys before the window menu sees them.

import (
	"fmt"
	"log/slog"
	"os/exec"
	"unsafe"

	webview "github.com/webview/webview_go"
	"golang.org/x/sys/windows"
)

// Menu command IDs, the LOWORD of WM_COMMAND for a menu selection.
const (
	menuOpenDataFolder = 1
	menuOpenLog        = 2
	menuExit           = 3
	menuFullScreen     = 100
	menuReload         = 101
	menuGitHub         = 200
	menuAbout          = 201
)

// Accelerator names the injected keydown listener reports to the it3dAccelerator
// binding.
const (
	acceleratorFullScreen = "full-screen"
	acceleratorReload     = "reload"
)

// githubURL is where Help > GitHub page points.
const githubURL = "https://github.com/llampwall/infinite-theater-3d"

// Win32 constants the menu needs.
const (
	wmCommand               = 0x0111
	wmClose                 = 0x0010
	mfString                = 0x0000
	mfPopup                 = 0x0010
	mfSeparator             = 0x0800
	monitorDefaultTonearest = 2
	swpNoZOrder             = 0x0004
	swpNoActivate           = 0x0010
	swpFrameChanged         = 0x0020
	mbOK                    = 0x00000000
)

// gwlWndProc is user32's GWL_WNDPROC (== GWLP_WNDPROC) index, -4, as the unsigned value the
// GetWindowLongPtrW/SetWindowLongPtrW calls take: ^uintptr(3) is two's-complement -4, the
// correctly sign-extended 64-bit form of the 32-bit index winuser.h defines.
//
// LOCAL-CHANGE (fix/window-dpi, 2026-11-17): this was ^uintptr(23) (-24, not a real GWL/GWLP
// index) since the file's first commit. GetWindowLongPtrW/SetWindowLongPtrW on an undefined
// negative index neither crash nor reliably no-op: on this build they silently failed, so the
// subclass below was never actually installed on the real window procedure, under either
// window binding. Nothing read their return value or error, so the menu bar showed (SetMenu is
// a separate, correct call) but every click did nothing: WM_COMMAND and WM_CLOSE never reached
// runMenuCommand/the close guard/the placement save, which instead went straight to the
// window's real procedure (DefWindowProcW's default WM_COMMAND handling, nothing). Covered by
// TestSubclassWndProc (window_menu_windows_test.go), which proves ^uintptr(3) round-trips a
// message through a real subclassed window and ^uintptr(23) does not.
const gwlWndProc = ^uintptr(3)

var (
	procCreateMenu        = windows.NewLazySystemDLL("user32.dll").NewProc("CreateMenu")
	procCreatePopupMenu   = windows.NewLazySystemDLL("user32.dll").NewProc("CreatePopupMenu")
	procAppendMenuW       = windows.NewLazySystemDLL("user32.dll").NewProc("AppendMenuW")
	procSetMenu           = windows.NewLazySystemDLL("user32.dll").NewProc("SetMenu")
	procGetWindowLongPtrW = windows.NewLazySystemDLL("user32.dll").NewProc("GetWindowLongPtrW")
	procSetWindowLongPtrW = windows.NewLazySystemDLL("user32.dll").NewProc("SetWindowLongPtrW")
	procCallWindowProcW   = windows.NewLazySystemDLL("user32.dll").NewProc("CallWindowProcW")
	procPostMessageW      = windows.NewLazySystemDLL("user32.dll").NewProc("PostMessageW")
	procGetWindowRect     = windows.NewLazySystemDLL("user32.dll").NewProc("GetWindowRect")
	procMonitorFromWindow = windows.NewLazySystemDLL("user32.dll").NewProc("MonitorFromWindow")
	procGetMonitorInfoW   = windows.NewLazySystemDLL("user32.dll").NewProc("GetMonitorInfoW")
	procSetWindowPos      = windows.NewLazySystemDLL("user32.dll").NewProc("SetWindowPos")
)

// menuCommand maps an accelerator name to the menu command ID that performs it (0 when
// the name performs none).
func menuCommand(accelerator string) uintptr {
	switch accelerator {
	case acceleratorFullScreen:
		return menuFullScreen
	case acceleratorReload:
		return menuReload
	}
	return 0
}

// menuActions is one window menu's actions. Every field is a function value so a test
// drives the command to action table with injected openers, and so no test ever opens a
// window, an explorer, or a browser.
type menuActions struct {
	openDataFolder func() error
	openLog        func() error
	exit           func()
	fullScreen     func()
	reload         func()
	github         func() error
	about          func()
}

// runMenuCommand runs the action a menu command ID names. An ID that names no action is
// a no-op. It runs on the main OS thread (menu clicks and the dispatched keydown
// accelerators both land there).
func (a menuActions) runMenuCommand(id uintptr) {
	var err error
	switch id {
	case menuOpenDataFolder:
		err = a.openDataFolder()
	case menuOpenLog:
		err = a.openLog()
	case menuExit:
		a.exit()
	case menuFullScreen:
		a.fullScreen()
	case menuReload:
		a.reload()
	case menuGitHub:
		err = a.github()
	case menuAbout:
		a.about()
	default:
		return
	}
	if err != nil {
		// A GUI build has no console to report on; a dialog is the report.
		_, _, _ = procMessageBoxW.Call(0, uintptr(unsafe.Pointer(windows.StringToUTF16Ptr(err.Error()))),
			uintptr(unsafe.Pointer(windows.StringToUTF16Ptr(appDisplayName))), mbOK)
	}
}

var procMessageBoxW = windows.NewLazySystemDLL("user32.dll").NewProc("MessageBoxW")

// openInExplorer opens a folder, or a file (its folder, with the file selected), in
// Windows Explorer. It is a variable so tests replace it; no test ever opens an
// explorer.
var openInExplorer = func(path string) error {
	if err := exec.Command("explorer", path).Start(); err != nil {
		return fmt.Errorf("open explorer: %w", err)
	}
	return nil
}

// appWindowDataDirNow is the data dir the File menu opens: the server's when one is
// running, the default otherwise.
func appWindowDataDirNow() (string, error) {
	if appWindowDataDir != "" {
		return appWindowDataDir, nil
	}
	return dataDirFor("")
}

// monitorInfo is user32's MONITORINFO.
type monitorInfo struct {
	CbSize    uint32
	RcMonitor windows.Rect
	RcWork    windows.Rect
	DwFlags   uint32
}

// fullScreenState tracks the borderless full screen a View menu toggle enters and
// leaves; prevRect is the placement to restore when leaving it.
type fullScreenState struct {
	active   bool
	prevRect windows.Rect
}

// toggle enters a borderless full screen over the work area of the monitor the window
// is on, or leaves it back to the remembered placement. It runs on the main OS thread.
func (s *fullScreenState) toggle(hwnd windows.Handle) {
	if s.active {
		_, _, _ = procSetWindowPos.Call(uintptr(hwnd), 0,
			uintptr(s.prevRect.Left), uintptr(s.prevRect.Top),
			uintptr(s.prevRect.Right-s.prevRect.Left), uintptr(s.prevRect.Bottom-s.prevRect.Top),
			swpNoZOrder|swpNoActivate|swpFrameChanged)
		s.active = false
		return
	}
	var r windows.Rect
	_, _, _ = procGetWindowRect.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&r)))
	s.prevRect = r
	s.active = true
	var hMon uintptr
	_, _, _ = procMonitorFromWindow.Call(uintptr(hwnd), hMon, monitorDefaultTonearest)
	var mi monitorInfo
	mi.CbSize = uint32(unsafe.Sizeof(mi))
	if _, _, _ = procGetMonitorInfoW.Call(hMon, uintptr(unsafe.Pointer(&mi))); mi.RcWork.Right-mi.RcWork.Left <= 0 {
		return
	}
	wa := mi.RcWork
	_, _, _ = procSetWindowPos.Call(uintptr(hwnd), 0,
		uintptr(wa.Left), uintptr(wa.Top),
		uintptr(wa.Right-wa.Left), uintptr(wa.Bottom-wa.Top),
		swpNoZOrder|swpNoActivate|swpFrameChanged)
}

// createAppMenu builds the File/View/Help menu bar with the app window's commands.
func createAppMenu() windows.Handle {
	bar, _, _ := procCreateMenu.Call()

	file, _, _ := procCreatePopupMenu.Call()
	appendMenuItem(file, menuOpenDataFolder, "Open data folder")
	appendMenuItem(file, menuOpenLog, "Open log")
	appendMenuSeparator(file)
	appendMenuItem(file, menuExit, "Exit")
	appendSubmenu(bar, file, "File")

	view, _, _ := procCreatePopupMenu.Call()
	appendMenuItem(view, menuFullScreen, "Full screen\tF11")
	appendMenuItem(view, menuReload, "Reload\tCtrl+R")
	appendSubmenu(bar, view, "View")

	help, _, _ := procCreatePopupMenu.Call()
	appendMenuItem(help, menuGitHub, "GitHub page")
	appendMenuItem(help, menuAbout, "About")
	appendSubmenu(bar, help, "Help")

	return windows.Handle(bar)
}

func appendMenuItem(menu uintptr, id uintptr, text string) {
	t, _ := windows.UTF16PtrFromString(text)
	_, _, _ = procAppendMenuW.Call(menu, mfString, id, uintptr(unsafe.Pointer(t)))
}

func appendMenuSeparator(menu uintptr) {
	_, _, _ = procAppendMenuW.Call(menu, mfSeparator, 0, 0)
}

func appendSubmenu(bar uintptr, sub uintptr, text string) {
	t, _ := windows.UTF16PtrFromString(text)
	_, _, _ = procAppendMenuW.Call(bar, mfPopup, sub, uintptr(unsafe.Pointer(t)))
}

// installAppWindowMenu sets the menu bar on the window, subclasses its window
// procedure so menu selections reach runMenuCommand (every other message goes to the
// original procedure, which the window binding installed: webview_go's win32_edge_engine
// wndproc, registered on the "webview" window class), and binds the it3dAccelerator
// entry point for the injected keydown listener. The callback is never released: the
// window and the process share a lifetime, and releasing it before the window is gone
// would free live window-procedure code.
func installAppWindowMenu(w webview.WebView, a menuActions, guard *closeGuard) {
	hwnd := windows.Handle(w.Window())
	enableDarkMenus()
	if menu := createAppMenu(); menu != 0 {
		_, _, _ = procSetMenu.Call(uintptr(hwnd), uintptr(menu))
	}
	orig, _, err := procGetWindowLongPtrW.Call(uintptr(hwnd), gwlWndProc)
	if orig == 0 {
		// A real original procedure is never a nil pointer; this is GetWindowLongPtrW
		// failing (wrong index, invalid window...). Installing the subclass over a wrong
		// "orig" would either lose every message the switch below does not name or crash
		// on the CallWindowProcW fallback, so stop here: the menu bar still shows (SetMenu
		// already ran), its clicks just do nothing, which is the pre-fix symptom and the
		// one this logs instead of hiding.
		slog.Error("app window: GetWindowLongPtrW(GWL_WNDPROC) failed, menu and close-save disabled", "err", err)
		_ = w.Bind("it3dAccelerator", func(name string) {
			w.Dispatch(func() { a.runMenuCommand(menuCommand(name)) })
		})
		return
	}
	subclass := windows.NewCallback(func(hwnd windows.Handle, msg uint32, wParam, lParam uintptr) uintptr {
		if r, handled := darkMenuMessage(hwnd, msg, wParam, lParam, orig); handled {
			return r
		}
		if msg == wmCommand && wParam>>16 == 0 { // a menu selection
			a.runMenuCommand(wParam)
			return 0
		}
		if msg == wmClose {
			// While an export is running the close asks first; a No answers the
			// message and the window stays open.
			if !guard.closeAllowed(askCloseWhileExportRunning) {
				return 0
			}
			// Remember the placement before the original procedure destroys the window.
			saveWindowPlacement(captureWindowPlacement(hwnd))
		}
		r, _, _ := procCallWindowProcW.Call(orig, uintptr(hwnd), uintptr(msg), wParam, lParam)
		return r
	})
	if ret, _, err := procSetWindowLongPtrW.Call(uintptr(hwnd), gwlWndProc, subclass); ret == 0 {
		slog.Error("app window: SetWindowLongPtrW(GWL_WNDPROC) failed, menu and close-save disabled", "err", err)
	}
	// The binding's body may run on the Chromium message thread; the action itself must
	// run on the main OS thread, so dispatch it.
	_ = w.Bind("it3dAccelerator", func(name string) {
		w.Dispatch(func() { a.runMenuCommand(menuCommand(name)) })
	})
}

// showAboutBox is the Help > About dialog: the display name, the build version, and the
// license line.
func showAboutBox() {
	text := appDisplayName + " version " + Version + "\n" +
		"Licensed under AGPL-3.0; see NOTICE.md."
	_, _, _ = procMessageBoxW.Call(0, uintptr(unsafe.Pointer(windows.StringToUTF16Ptr(text))),
		uintptr(unsafe.Pointer(windows.StringToUTF16Ptr(appDisplayName))), mbOK)
}

// acceleratorJS is injected at every page load: F11 and Ctrl+R are handed to the
// it3dAccelerator binding because the WebView2 child swallows keys before the window
// menu would see them.
const acceleratorJS = `(function () {
  if (window.__it3dKeys) return;
  window.__it3dKeys = true;
  document.addEventListener('keydown', function (ev) {
    var name;
    if (ev.key === 'F11') { name = 'full-screen'; }
    else if (ev.ctrlKey && (ev.key === 'r' || ev.key === 'R')) { name = 'reload'; }
    if (!name) return;
    ev.preventDefault();
    ev.stopPropagation();
    window.it3dAccelerator(name);
  }, true);
})();`
