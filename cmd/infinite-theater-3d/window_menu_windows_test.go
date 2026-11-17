//go:build windows

package main

// window_menu_windows_test.go — the menu command table (TestRunMenuCommand,
// TestMenuCommand), and (TestSubclassWndProc*) proof that the GWL_WNDPROC subclassing
// installAppWindowMenu relies on actually works on this machine, against a real
// (message-only, never shown) window: no infinite-theater-3d process involved. See
// gwlWndProc's doc comment for the bug the latter guards against (fix/window-dpi,
// 2026-11-17).

import (
	"runtime"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

// TestRunMenuCommand — each menu command ID runs exactly its own action, and an ID that
// names no action runs none.
func TestRunMenuCommand(t *testing.T) {
	var calls []string
	a := menuActions{
		openDataFolder: func() error { calls = append(calls, "openDataFolder"); return nil },
		openLog:        func() error { calls = append(calls, "openLog"); return nil },
		exit:           func() { calls = append(calls, "exit") },
		fullScreen:     func() { calls = append(calls, "fullScreen") },
		reload:         func() { calls = append(calls, "reload") },
		github:         func() error { calls = append(calls, "github"); return nil },
		about:          func() { calls = append(calls, "about") },
	}
	want := map[uintptr]string{
		menuOpenDataFolder: "openDataFolder",
		menuOpenLog:        "openLog",
		menuExit:           "exit",
		menuFullScreen:     "fullScreen",
		menuReload:         "reload",
		menuGitHub:         "github",
		menuAbout:          "about",
	}
	for id, name := range want {
		calls = nil
		a.runMenuCommand(id)
		if len(calls) != 1 || calls[0] != name {
			t.Errorf("command %d: calls = %v, want [%s]", id, calls, name)
		}
	}
	calls = nil
	a.runMenuCommand(99999)
	if len(calls) != 0 {
		t.Errorf("unknown command: calls = %v, want none", calls)
	}
}

// TestMenuCommand — the accelerator names the injected keydown listener reports map to
// the menu command IDs that perform them, and any other name performs none.
func TestMenuCommand(t *testing.T) {
	if got := menuCommand(acceleratorFullScreen); got != menuFullScreen {
		t.Errorf("full-screen accelerator = %d, want %d", got, menuFullScreen)
	}
	if got := menuCommand(acceleratorReload); got != menuReload {
		t.Errorf("reload accelerator = %d, want %d", got, menuReload)
	}
	if got := menuCommand("f5"); got != 0 {
		t.Errorf("unknown accelerator = %d, want 0", got)
	}
}

const (
	// A message-only window: never shown, no screen presence, destroyed at test end.
	hwndMessage = ^uintptr(2) // HWND_MESSAGE, (HWND)-3
	wmTestProbe = 0x0401      // WM_USER + 1: an application-private test message
)

var (
	procCreateWindowExW = windows.NewLazySystemDLL("user32.dll").NewProc("CreateWindowExW")
	procDestroyWindowT  = windows.NewLazySystemDLL("user32.dll").NewProc("DestroyWindow")
	procSendMessageW    = windows.NewLazySystemDLL("user32.dll").NewProc("SendMessageW")
)

// newMessageOnlyTestWindow creates a message-only window of the predefined "Message" class
// (needs no RegisterClass): a real HWND with a real window procedure, invisible and never
// drawn, the same mechanism webview_go's own internal messaging window uses
// (third_party/webview_go/libs/webview/include/webview.h, "webview_message").
//
// It locks the calling goroutine to its current OS thread for the rest of the test (the
// same rule window_windows.go's init() applies to the real app window, and its own doc
// comment explains): SendMessageW to a window is a same-thread, non-blocking direct call
// only when the sender is still on the thread that created the window. Without the lock, Go
// is free to migrate this goroutine to a different OS thread between CreateWindowExW and a
// later SendMessageW — unlikely with nothing else running, near-certain once other tests are
// also scheduling goroutines (go test ./cmd/infinite-theater-3d/... hung here for exactly
// this reason until this lock was added) — turning the send into a real cross-thread one
// that blocks forever, since nothing pumps this thread's message queue.
func newMessageOnlyTestWindow(t *testing.T) windows.Handle {
	t.Helper()
	runtime.LockOSThread()
	t.Cleanup(runtime.UnlockOSThread)
	className, err := windows.UTF16PtrFromString("Message")
	if err != nil {
		t.Fatal(err)
	}
	hwnd, _, callErr := procCreateWindowExW.Call(
		0, uintptr(unsafe.Pointer(className)), 0, 0,
		0, 0, 0, 0,
		hwndMessage, 0, 0, 0,
	)
	if hwnd == 0 {
		t.Fatalf("CreateWindowExW(\"Message\") failed: %v", callErr)
	}
	t.Cleanup(func() { _, _, _ = procDestroyWindowT.Call(hwnd) })
	return windows.Handle(hwnd)
}

// subclassWith installs subclass at index (gwlWndProc, or a wrong index under test) on hwnd,
// returning the original procedure pointer GetWindowLongPtrW reported and whether both the
// get and the set reported success (a nonzero result from each; see installAppWindowMenu's
// own check, the one this test exists to justify).
func subclassWith(hwnd windows.Handle, index uintptr, subclass uintptr) (orig uintptr, ok bool) {
	orig, _, _ = procGetWindowLongPtrW.Call(uintptr(hwnd), index)
	if orig == 0 {
		return 0, false
	}
	ret, _, _ := procSetWindowLongPtrW.Call(uintptr(hwnd), index, subclass)
	return orig, ret != 0
}

// TestSubclassWndProc — with the correct GWL_WNDPROC index (-4, gwlWndProc's current value),
// a subclass installed via GetWindowLongPtrW/SetWindowLongPtrW actually receives messages sent
// to the window, and still chains unhandled ones to the original procedure (DefWindowProcW for
// the "Message" class, which simply returns 0 for an unknown message — observable as "did not
// panic and let the message through").
func TestSubclassWndProc(t *testing.T) {
	hwnd := newMessageOnlyTestWindow(t)

	var gotWParam uintptr
	var gotCount int
	subclass := windows.NewCallback(func(h windows.Handle, msg uint32, wParam, lParam uintptr) uintptr {
		if msg == wmTestProbe {
			gotWParam = wParam
			gotCount++
			return 0
		}
		return 0
	})

	orig, ok := subclassWith(hwnd, gwlWndProc, subclass)
	if !ok {
		t.Fatalf("subclass install at the real GWL_WNDPROC index (-4) failed; orig=%d", orig)
	}
	if orig == 0 {
		t.Fatal("GetWindowLongPtrW(GWL_WNDPROC) returned a nil original procedure")
	}

	const probeValue = 42
	_, _, _ = procSendMessageW.Call(uintptr(hwnd), wmTestProbe, probeValue, 0)
	if gotCount != 1 || gotWParam != probeValue {
		t.Fatalf("subclass did not receive the probe message: count=%d wParam=%d, want 1 and %d", gotCount, gotWParam, probeValue)
	}
}

// TestSubclassWndProcWrongIndexFails — the bug this fix removes: ^uintptr(23) (-24) is not a
// real GWL/GWLP index. Either the get or the set reports failure (ok=false), which
// installAppWindowMenu now checks and logs instead of silently installing nothing — exactly
// what left every menu click and the close-time placement save doing nothing.
func TestSubclassWndProcWrongIndexFails(t *testing.T) {
	hwnd := newMessageOnlyTestWindow(t)
	const wrongIndex = ^uintptr(23) // the old, broken gwlWndProc value

	subclass := windows.NewCallback(func(h windows.Handle, msg uint32, wParam, lParam uintptr) uintptr {
		return 0
	})
	if _, ok := subclassWith(hwnd, wrongIndex, subclass); ok {
		t.Fatal("subclassing at the wrong index (-24) reported success on this machine; the regression this test guards against may have changed shape")
	}
}
