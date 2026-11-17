// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// console_windows.go — the packaged build is a Windows GUI-subsystem exe (no console
// window on a double-click). When it is launched from a terminal, the console is the
// terminal's; attachConsole takes it over so the command line still prints there. When
// there is no parent console, it reports false and the caller routes the output to the
// server log file.

import (
	"os"

	"golang.org/x/sys/windows"
)

var (
	procAttachConsole    = windows.NewLazySystemDLL("kernel32.dll").NewProc("AttachConsole")
	procGetConsoleWindow = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetConsoleWindow")
)

// attachParentProcess is kernel32's ATTACH_PARENT_PROCESS.
const attachParentProcess = ^uint32(0)

// attachConsole reports whether the process has a console to print on, and points
// os.Stdout and os.Stderr at it when it took one over.
func attachConsole() bool {
	hwnd, _, _ := procGetConsoleWindow.Call()
	if hwnd != 0 {
		return true // a console-subsystem build already has its console
	}
	if _, _, err := procAttachConsole.Call(uintptr(attachParentProcess)); err != nil {
		return false // no parent console (a double-click)
	}
	for _, which := range []uint32{windows.STD_OUTPUT_HANDLE, windows.STD_ERROR_HANDLE} {
		h, err := stdConsoleHandle(which)
		if err != nil {
			continue
		}
		f := os.NewFile(uintptr(h), "console")
		if which == windows.STD_OUTPUT_HANDLE {
			os.Stdout = f
		} else {
			os.Stderr = f
		}
	}
	return true
}

// stdConsoleHandle opens the attached console's stream and points the process's standard
// handle at it.
func stdConsoleHandle(which uint32) (windows.Handle, error) {
	name, err := windows.UTF16PtrFromString("CONOUT$")
	if err != nil {
		return 0, err
	}
	h, err := windows.CreateFile(name,
		windows.GENERIC_READ|windows.GENERIC_WRITE,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE,
		nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		return 0, err
	}
	if err := windows.SetStdHandle(which, h); err != nil {
		windows.Close(h)
		return 0, err
	}
	return h, nil
}
