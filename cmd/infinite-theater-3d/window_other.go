//go:build !windows

package main

import "errors"

// openWindow has no app window outside Windows (the WebView2 runtime is a Windows one); a
// window-mode launch logs a warning and falls back to the default browser.
var openWindow = func(url string) error {
	return errors.New("the app window needs Windows (the WebView2 runtime)")
}
