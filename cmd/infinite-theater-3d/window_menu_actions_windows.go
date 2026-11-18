// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build windows

package main

// window_menu_actions_windows.go — the bodies of the Help menu's update actions:
// the Check for updates dialog (a live check, not the startup cache) and the
// Report an issue opener. They live apart from window_menu_windows.go, which a
// concurrent change edits, and share only its procMessageBoxW and menu constants.

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// messageBoxText shows text in an OK dialog titled appDisplayName. The mbYesNo and
// idYes constants come from window_closeguard_windows.go.
func messageBoxText(text string) {
	_, _, _ = procMessageBoxW.Call(0, uintptr(unsafe.Pointer(windows.StringToUTF16Ptr(text))),
		uintptr(unsafe.Pointer(windows.StringToUTF16Ptr(appDisplayName))), mbOK)
}

// yesNoBox asks text in a Yes/No dialog titled appDisplayName; true on Yes.
func yesNoBox(text string) bool {
	r, _, _ := procMessageBoxW.Call(0, uintptr(unsafe.Pointer(windows.StringToUTF16Ptr(text))),
		uintptr(unsafe.Pointer(windows.StringToUTF16Ptr(appDisplayName))), mbYesNo)
	return r == idYes
}

// showCheckUpdates is the Help > Check for updates action: it runs the check now
// (not the startup cache) and reports the result; a newer release offers to open
// its download page.
func showCheckUpdates() {
	if strings.HasSuffix(Version, "-dev") {
		messageBoxText("This is a development build; updates are not checked.")
		return
	}
	info := checkForUpdate(context.Background(), http.DefaultClient, releasesAPI, Version)
	switch {
	case info.Err != "":
		messageBoxText("Could not check for updates: " + info.Err)
	case info.Newer:
		if yesNoBox("Installation 08 " + info.Latest + " is available. You have " + info.Current + ".\n\nOpen the download page?") {
			if err := openBrowser(info.URL); err != nil {
				messageBoxText(err.Error())
			}
		}
	default:
		messageBoxText("You have the latest version (" + info.Current + ").")
	}
}

// openReportIssue is the Help > Report an issue action: it opens the
// repository's new-issue form prefilled with the app and Windows versions. The
// body carries nothing identifying: no username, no paths, no gamertag.
func openReportIssue() error {
	body := "**App version:** " + Version + "\n" +
		"**Windows:** " + windowsVersionString() + "\n\n" +
		"**What happened:**\n\n\n**Steps to reproduce:**\n\n\n**Match ID (if it is about one match):**\n"
	return openBrowser(githubURL + "/issues/new?body=" + url.QueryEscape(body))
}

// windowsVersionString is the Windows version a reported issue carries:
// major.minor.build from RtlGetVersion (the accurate call, unlike GetVersion).
func windowsVersionString() string {
	v := windows.RtlGetVersion()
	return fmt.Sprintf("%d.%d.%d", v.MajorVersion, v.MinorVersion, v.BuildNumber)
}
