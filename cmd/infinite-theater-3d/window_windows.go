package main

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"

	webview2 "github.com/jchv/go-webview2"
)

func init() {
	// The webview's window and its message loop must live on the main OS thread for the
	// whole process lifetime.
	runtime.LockOSThread()
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

// openWindow opens url in the app's own window (titled "Infinite Theater 3D", 1600x900,
// resizable) and blocks until the window closes. It is a variable so tests replace it; no
// test ever opens a real window.
var openWindow = openWindowApp

const (
	appWindowTitle  = "Infinite Theater 3D"
	appWindowWidth  = 1600
	appWindowHeight = 900
)

func openWindowApp(url string) error {
	applyWebViewEnvDefaults()
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		DataPath: webviewUserDataFolder(),
		WindowOptions: webview2.WindowOptions{
			Title:  appWindowTitle,
			Width:  appWindowWidth,
			Height: appWindowHeight,
		},
	})
	if w == nil {
		return errors.New("the WebView2 runtime could not create the app window")
	}
	w.Navigate(url)
	w.Run() // returns when the window closes
	return nil
}
