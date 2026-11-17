// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package sounds holds the built-in replay sound set. The files are hand-produced .ogg files of
// JGtm's LevelUp replay player (see NOTICE.md for the current count), produced from Halo
// Infinite's game audio. They are embedded in every build so the viewer is not silent on
// a fresh install: the sound route serves a file from the user's data directory when it is
// there (an imported file wins), otherwise from this set. A family this repo now extracts from
// the user's own installation (internal/announcer, internal/reloadsounds,
// internal/footstepsounds, internal/uisounds, internal/ambience, internal/eventsounds,
// internal/endmatchvoice) has its shipped files removed from here once confirmed; see each
// package's doc comment.
package sounds

import (
	"embed"
	"io/fs"
)

// set is the embedded sound set, rooted at the halo_infinite folder.
//
//go:embed files/halo_infinite
var set embed.FS

// Open returns the embedded sound set rooted at the top level: a file's name is the
// sound's file name (for example "gunshot_battle_rifle.ogg"). The set is compiled into
// the binary, so this never fails on a clean checkout.
func Open() fs.FS {
	sub, err := fs.Sub(set, "files/halo_infinite")
	if err != nil {
		panic("sounds: embedded tree has no halo_infinite directory: " + err.Error())
	}
	return sub
}
