//go:build windows

package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestWebViewUserDataFolder — the app window's one fixed WebView2 user data folder, under
// LOCALAPPDATA (the home directory when LOCALAPPDATA is unset).
func TestWebViewUserDataFolder(t *testing.T) {
	local := t.TempDir()
	t.Setenv("LOCALAPPDATA", local)
	if got := webviewUserDataFolder(); got != filepath.Join(local, "infinite-theater-3d", "webview2") {
		t.Fatalf("user data folder = %q", got)
	}
}

// TestApplyWebViewEnvDefaults — the WebView2 environment variables are set only when
// unset: a value the user already chose is never overwritten.
func TestApplyWebViewEnvDefaults(t *testing.T) {
	t.Run("unset values take the defaults", func(t *testing.T) {
		t.Setenv("WEBVIEW2_USER_DATA_FOLDER", "")
		t.Setenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "")
		applyWebViewEnvDefaults()
		if got := os.Getenv("WEBVIEW2_USER_DATA_FOLDER"); got != webviewUserDataFolder() {
			t.Errorf("WEBVIEW2_USER_DATA_FOLDER = %q, want the app's fixed folder", got)
		}
		if got := os.Getenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"); got != webviewAdditionalBrowserArguments {
			t.Errorf("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = %q, want the defaults", got)
		}
	})

	t.Run("values the user set are kept", func(t *testing.T) {
		t.Setenv("WEBVIEW2_USER_DATA_FOLDER", "C:\\mine")
		t.Setenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--user-set")
		applyWebViewEnvDefaults()
		if got := os.Getenv("WEBVIEW2_USER_DATA_FOLDER"); got != "C:\\mine" {
			t.Errorf("user's WEBVIEW2_USER_DATA_FOLDER was replaced by %q", got)
		}
		if got := os.Getenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"); got != "--user-set" {
			t.Errorf("user's WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS was replaced by %q", got)
		}
	})
}
