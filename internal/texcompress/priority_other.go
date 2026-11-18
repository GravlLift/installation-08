// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build !windows

package texcompress

// lowerThreadPriority is a no-op off Windows.
func lowerThreadPriority() {}
