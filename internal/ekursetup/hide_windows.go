//go:build windows

package ekursetup

import (
	"os/exec"
	"syscall"
)

// createNoWindow is CREATE_NO_WINDOW: the child gets a hidden console instead of a new
// visible one (the server has no console of its own when it runs in the background).
const createNoWindow = 0x08000000

// hideWindow starts the dumper with a hidden console and a hidden window. The process is
// never detached: a detached console program would get a new visible console.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}
