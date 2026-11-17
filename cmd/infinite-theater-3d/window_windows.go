// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"

	webview "github.com/webview/webview_go"
	"golang.org/x/sys/windows"
)

func init() {
	// The webview's window and its message loop must live on the main OS thread for the
	// whole process lifetime.
	runtime.LockOSThread()
	// DPI awareness is declared in app.manifest (PerMonitorV2) and, as defense in depth,
	// set at runtime by webview_go's own window creation if the manifest did not already
	// set it. The previous binding (go-webview2) crashed WebView2 controller creation
	// under any DPI-aware state (see third_party/README.md); this one is the official
	// webview library, which is per-monitor DPI aware by design.
}

// webviewUserDataFolder is the ONE fixed user data folder of the app window's WebView2
// runtime. It is never a temporary or per-launch folder: a fresh Chromium profile on this
// machine triggers a Windows blank-password logon check that can lock the owner out.
func webviewUserDataFolder() string {
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		if home, err := os.UserHomeDir(); err == nil {
			local = home
		}
	}
	return filepath.Join(local, "infinite-theater-3d", "webview2")
}

// webviewAdditionalBrowserArguments keeps a render at full speed when the window is not
// focused, so an export does not slow down while the user looks at another window.
const webviewAdditionalBrowserArguments = "--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows"

// applyWebViewEnvDefaults sets the WebView2 environment variables the app window needs
// (the runtime reads them when it starts). A value the user already set is never
// overwritten.
func applyWebViewEnvDefaults() {
	if os.Getenv("WEBVIEW2_USER_DATA_FOLDER") == "" {
		_ = os.Setenv("WEBVIEW2_USER_DATA_FOLDER", webviewUserDataFolder())
	}
	if os.Getenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") == "" {
		_ = os.Setenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", webviewAdditionalBrowserArguments)
	}
}

// openWindow opens url in the app's own window (titled appDisplayName, 1600x900,
// resizable) and blocks until the window closes. It is a variable so tests replace it; no
// test ever opens a real window.
var openWindow = openWindowApp

const (
	appWindowTitle  = appDisplayName
	appWindowWidth  = 1600
	appWindowHeight = 900
)

func openWindowApp(url string) error {
	applyWebViewEnvDefaults()
	appOrigin := originOf(url)
	// The remembered placement always wins; with none, the DPI-aware 16:9 default
	// (defaultWindowPlacement).
	placement, ok := loadWindowPlacement()
	if !ok {
		placement = defaultWindowPlacement()
	}
	// webview_go has no window-options struct: the title and the placement (size and
	// position, or maximized) are set right after creation instead of passed to it. The
	// data path is not a parameter of this library either; it reads
	// WEBVIEW2_USER_DATA_FOLDER itself (applyWebViewEnvDefaults set it above), per the
	// LOCAL-CHANGE in third_party/webview_go/libs/webview/include/webview.h.
	w := webview.New(false)
	if w == nil {
		return errors.New("the WebView2 runtime could not create the app window")
	}
	w.SetTitle(appWindowTitle)
	hwnd := windows.Handle(w.Window())
	// webview_go's window class loads the generic system icon (IDI_APPLICATION), not the
	// exe's own; set the real one explicitly. See window_icon_windows.go.
	setAppWindowIcon(hwnd)
	applyWindowPlacement(hwnd, placement)
	w.Init(externalLinksJS)
	w.Init(acceleratorJS)
	bound := func(u string) error { return openExternalURL(u, appOrigin) }
	if err := w.Bind("it3dOpenExternal", bound); err != nil {
		w.Destroy()
		return err
	}
	fullScreen := &fullScreenState{}
	guard := &closeGuard{}
	// The page reports an export running (or ending) on the it3dExportBusy binding; a
	// WM_CLOSE while it runs then asks before closing.
	if err := w.Bind("it3dExportBusy", guard.setBusy); err != nil {
		w.Destroy()
		return err
	}
	installAppWindowMenu(w, menuActions{
		openDataFolder: func() error {
			dir, err := appWindowDataDirNow()
			if err != nil {
				return err
			}
			return openInExplorer(dir)
		},
		openLog: func() error {
			dir, err := appWindowDataDirNow()
			if err != nil {
				return err
			}
			logDir := filepath.Join(dir, "logs")
			logFile := filepath.Join(logDir, serverLogName)
			if _, statErr := os.Stat(logFile); statErr == nil {
				return openInExplorer(logFile)
			}
			return openInExplorer(logDir)
		},
		exit: func() {
			// WM_CLOSE on the original procedure: the same close a click on the title
			// bar's X would take, so the server shuts down exactly as today.
			_, _, _ = procPostMessageW.Call(uintptr(hwnd), wmClose, 0, 0)
		},
		fullScreen: func() { fullScreen.toggle(hwnd) },
		reload:     func() { w.Eval("location.reload()") },
		github:     func() error { return openBrowser(githubURL) },
		about:      func() { showAboutBox() },
	}, guard)
	w.Navigate(appWindowURL(url, Version))
	w.Run() // returns when the window closes
	return nil
}
