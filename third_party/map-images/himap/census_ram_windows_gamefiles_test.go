// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build gamefiles && windows

// LOCAL-CHANGE (infinite-theater-3d): ported from The Library with the census scope; the Win32
// call goes through the standard library's syscall package.
//
// census_ram_windows_gamefiles_test.go — the free physical memory probe the census scope checks
// before it opens a module (Windows: GlobalMemoryStatusEx).
package himap

import (
	"syscall"
	"unsafe"
)

// memoryStatusEx is the MEMORYSTATUSEX structure of the Win32 API.
type memoryStatusEx struct {
	length               uint32
	memoryLoad           uint32
	totalPhys            uint64
	availPhys            uint64
	totalPageFile        uint64
	availPageFile        uint64
	totalVirtual         uint64
	availVirtual         uint64
	availExtendedVirtual uint64
}

var procGlobalMemoryStatusEx = syscall.NewLazyDLL("kernel32.dll").NewProc("GlobalMemoryStatusEx")

// freePhysicalRAM returns the physical memory available now, in bytes (standby pages included,
// as the system counts it).
func freePhysicalRAM() (uint64, error) {
	ms := memoryStatusEx{}
	ms.length = uint32(unsafe.Sizeof(ms))
	if r, _, err := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&ms))); r == 0 {
		return 0, err
	}
	return ms.availPhys, nil
}
