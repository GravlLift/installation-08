// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build !windows

package main

// attachConsole: outside Windows the process is a console-subsystem program with its own
// console.
func attachConsole() bool { return true }
