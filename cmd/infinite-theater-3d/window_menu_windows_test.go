//go:build windows

package main

import "testing"

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
