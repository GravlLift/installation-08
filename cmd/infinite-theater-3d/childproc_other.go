// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build !windows

package main

import "os/exec"

// hideChildConsole: outside Windows a child process opens no window.
func hideChildConsole(*exec.Cmd) {}
