// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build windows

package texcompress

import "golang.org/x/sys/windows"

var procSetThreadPriority = windows.NewLazySystemDLL("kernel32.dll").NewProc("SetThreadPriority")

// threadPriorityBelowNormal is THREAD_PRIORITY_BELOW_NORMAL.
const threadPriorityBelowNormal = -1

// lowerThreadPriority drops the calling OS thread to below-normal priority, so encoding on
// every core yields to the game, the viewer and the desktop. A failure keeps normal priority.
func lowerThreadPriority() {
	prio := int32(threadPriorityBelowNormal)
	_, _, _ = procSetThreadPriority.Call(uintptr(windows.CurrentThread()), uintptr(prio))
}
