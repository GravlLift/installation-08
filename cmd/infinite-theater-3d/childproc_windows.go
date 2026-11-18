// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

// hideChildConsole starts a child of the app without a console window. The packaged app has
// no console, and a console program it starts would otherwise get a new, visible one.
func hideChildConsole(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
}
