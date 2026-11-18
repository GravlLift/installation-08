// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build windows

package main

// window_menu_dark_windows.go — paints the native menu bar dark to match the dark title bar
// and the app. Win32 has no public switch for a dark menu bar: the bar is drawn here through
// the undocumented UAH messages (WM_UAHDRAWMENU, WM_UAHDRAWMENUITEM) that themed windows send
// to their own procedure, the same approach Notepad++ and other Win32 apps use. The popup menus
// turn dark through uxtheme's SetPreferredAppMode(ForceDark) (ordinal 135) and FlushMenuThemes
// (ordinal 136). Every step fails soft: a missing export or a failed call leaves the stock
// light menu, never a broken one.

import (
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	wmNCPaint         = 0x0085
	wmNCActivate      = 0x0086
	wmUAHDrawMenu     = 0x0091
	wmUAHDrawMenuItem = 0x0092
	objidMenu         = ^uintptr(2) // OBJID_MENU, -3
	miimString        = 0x00000040
	odsSelected       = 0x0001
	odsGrayed         = 0x0002
	odsDisabled       = 0x0004
	odsHotlight       = 0x0040
	odsInactive       = 0x0080
	odsNoAccel        = 0x0100
	dtCenter          = 0x0001
	dtVCenter         = 0x0004
	dtSingleLine      = 0x0020
	dtHidePrefix      = 0x00100000
	bkModeTransparent = 1
	appModeForceDark  = 2
	menuBarColor      = 0x00202020 // COLORREF 0x00BBGGRR: the dark title bar's gray
	menuBarHotColor   = 0x003E3E3E
	menuBarTextColor  = 0x00E6E6E6
	menuBarDimColor   = 0x00808080
)

var (
	procGetMenuBarInfo   = windows.NewLazySystemDLL("user32.dll").NewProc("GetMenuBarInfo")
	procGetMenuItemInfoW = windows.NewLazySystemDLL("user32.dll").NewProc("GetMenuItemInfoW")
	procFillRect         = windows.NewLazySystemDLL("user32.dll").NewProc("FillRect")
	procDrawTextW        = windows.NewLazySystemDLL("user32.dll").NewProc("DrawTextW")
	procGetWindowDC      = windows.NewLazySystemDLL("user32.dll").NewProc("GetWindowDC")
	procReleaseDC        = windows.NewLazySystemDLL("user32.dll").NewProc("ReleaseDC")
	procCreateSolidBrush = windows.NewLazySystemDLL("gdi32.dll").NewProc("CreateSolidBrush")
	procSetTextColor     = windows.NewLazySystemDLL("gdi32.dll").NewProc("SetTextColor")
	procSetBkMode        = windows.NewLazySystemDLL("gdi32.dll").NewProc("SetBkMode")
	darkMenuBrush        uintptr
	darkMenuHotBrush     uintptr
)

// menuBarInfo is user32's MENUBARINFO (its two BOOL bit fields share the last DWORD).
type menuBarInfo struct {
	CbSize   uint32
	RcBar    windows.Rect
	HMenu    windows.Handle
	HwndMenu windows.Handle
	Flags    uint32
}

// menuItemInfo is user32's MENUITEMINFOW.
type menuItemInfo struct {
	CbSize        uint32
	FMask         uint32
	FType         uint32
	FState        uint32
	WID           uint32
	HSubMenu      windows.Handle
	HbmpChecked   windows.Handle
	HbmpUnchecked windows.Handle
	DwItemData    uintptr
	DwTypeData    *uint16
	Cch           uint32
	HbmpItem      windows.Handle
}

// drawItemStruct is user32's DRAWITEMSTRUCT.
type drawItemStruct struct {
	CtlType    uint32
	CtlID      uint32
	ItemID     uint32
	ItemAction uint32
	ItemState  uint32
	HwndItem   windows.Handle
	HDC        windows.Handle
	RcItem     windows.Rect
	ItemData   uintptr
}

// uahMenu is the WM_UAHDRAWMENU lParam (UAHMENU).
type uahMenu struct {
	HMenu windows.Handle
	HDC   windows.Handle
	Flags uint32
}

// uahDrawMenuItem is the WM_UAHDRAWMENUITEM lParam (UAHDRAWMENUITEM); only the item's position
// is read from its UAHMENUITEM tail.
type uahDrawMenuItem struct {
	Dis      drawItemStruct
	Um       uahMenu
	Position int32
}

// enableDarkMenus asks uxtheme for dark popup menus and makes the brushes the bar is painted
// with. It reports whether the bar should be painted dark (both brushes exist).
func enableDarkMenus() bool {
	if ux, err := windows.LoadLibraryEx("uxtheme.dll", 0, windows.LOAD_LIBRARY_SEARCH_SYSTEM32); err == nil {
		if setMode, err := windows.GetProcAddressByOrdinal(ux, 135); err == nil {
			_, _, _ = syscall.SyscallN(setMode, appModeForceDark)
			if flush, err := windows.GetProcAddressByOrdinal(ux, 136); err == nil {
				_, _, _ = syscall.SyscallN(flush)
			}
		}
	}
	darkMenuBrush, _, _ = procCreateSolidBrush.Call(menuBarColor)
	darkMenuHotBrush, _, _ = procCreateSolidBrush.Call(menuBarHotColor)
	return darkMenuBrush != 0 && darkMenuHotBrush != 0
}

// darkMenuMessage handles the messages that draw the menu bar. handled false means the
// message is not one of them (or painting is off) and goes to the original procedure.
func darkMenuMessage(hwnd windows.Handle, msg uint32, wParam, lParam, orig uintptr) (uintptr, bool) {
	if darkMenuBrush == 0 {
		return 0, false
	}
	switch msg {
	case wmUAHDrawMenu:
		um := *(**uahMenu)(unsafe.Pointer(&lParam)) // lParam is a pointer the system owns for this call
		if rc, ok := menuBarRect(hwnd); ok {
			_, _, _ = procFillRect.Call(uintptr(um.HDC), uintptr(unsafe.Pointer(&rc)), darkMenuBrush)
		}
		return 1, true
	case wmUAHDrawMenuItem:
		drawMenuBarItem(*(**uahDrawMenuItem)(unsafe.Pointer(&lParam)))
		return 1, true
	case wmNCPaint, wmNCActivate:
		// The stock frame paint draws a one-pixel light line under the bar; paint over it.
		r, _, _ := procCallWindowProcW.Call(orig, uintptr(hwnd), uintptr(msg), wParam, lParam)
		paintMenuBarUnderline(hwnd)
		return r, true
	}
	return 0, false
}

// menuBarRect is the menu bar's rectangle in window coordinates (the UAH device context and
// GetWindowDC both draw in them).
func menuBarRect(hwnd windows.Handle) (windows.Rect, bool) {
	mbi := menuBarInfo{CbSize: uint32(unsafe.Sizeof(menuBarInfo{}))}
	if ok, _, _ := procGetMenuBarInfo.Call(uintptr(hwnd), objidMenu, 0, uintptr(unsafe.Pointer(&mbi))); ok == 0 {
		return windows.Rect{}, false
	}
	var wr windows.Rect
	_, _, _ = procGetWindowRect.Call(uintptr(hwnd), uintptr(unsafe.Pointer(&wr)))
	rc := mbi.RcBar
	rc.Left -= wr.Left
	rc.Right -= wr.Left
	rc.Top -= wr.Top
	rc.Bottom -= wr.Top
	return rc, true
}

func paintMenuBarUnderline(hwnd windows.Handle) {
	rc, ok := menuBarRect(hwnd)
	if !ok {
		return
	}
	line := windows.Rect{Left: rc.Left, Top: rc.Bottom, Right: rc.Right, Bottom: rc.Bottom + 1}
	hdc, _, _ := procGetWindowDC.Call(uintptr(hwnd))
	if hdc == 0 {
		return
	}
	_, _, _ = procFillRect.Call(hdc, uintptr(unsafe.Pointer(&line)), darkMenuBrush)
	_, _, _ = procReleaseDC.Call(uintptr(hwnd), hdc)
}

// drawMenuBarItem paints one top-level item ("File", "View", "Help"): its background (lighter
// while hovered or open) and its text.
func drawMenuBarItem(item *uahDrawMenuItem) {
	var buf [128]uint16
	mii := menuItemInfo{FMask: miimString, DwTypeData: &buf[0], Cch: uint32(len(buf) - 1)}
	mii.CbSize = uint32(unsafe.Sizeof(mii))
	_, _, _ = procGetMenuItemInfoW.Call(uintptr(item.Um.HMenu), uintptr(item.Position), 1, uintptr(unsafe.Pointer(&mii)))

	state := item.Dis.ItemState
	brush := darkMenuBrush
	if state&(odsHotlight|odsSelected) != 0 {
		brush = darkMenuHotBrush
	}
	text := uintptr(menuBarTextColor)
	if state&(odsInactive|odsGrayed|odsDisabled) != 0 {
		text = menuBarDimColor
	}
	format := uintptr(dtCenter | dtVCenter | dtSingleLine)
	if state&odsNoAccel != 0 {
		format |= dtHidePrefix
	}
	hdc := uintptr(item.Um.HDC)
	rc := item.Dis.RcItem
	_, _, _ = procFillRect.Call(hdc, uintptr(unsafe.Pointer(&rc)), brush)
	_, _, _ = procSetBkMode.Call(hdc, bkModeTransparent)
	_, _, _ = procSetTextColor.Call(hdc, text)
	_, _, _ = procDrawTextW.Call(hdc, uintptr(unsafe.Pointer(&buf[0])), ^uintptr(0), uintptr(unsafe.Pointer(&rc)), format)
}
