// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weaponicons

// decoder_stamp.go — which bitmap decoder an icon set on disk was built with. The weapon icon
// set, the HUD set and the rank badges each write DecoderStampFile last; their ready checks
// require it at DecoderRevision, so a set built by an older decoder is rebuilt once after an
// app upgrade (the score meter was misread before revision 2, and the web view reads the
// corrected channels).

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// DecoderRevision is the current bitmap decoding of the icon sets. 2: every pixel path goes
// through the shared decoder (bitmapdecode), the format from each bitmap's own header, with
// the _hd1 entries read; before it the package's own partial BC7 decoder.
const DecoderRevision = 2

// DecoderStampFile is the stamp's file name inside a set's folder.
const DecoderStampFile = "decoder-revision.txt"

// WriteDecoderStamp records DecoderRevision in dir. Builds call it after every other file of
// the set is written, so a build interrupted midway leaves no current stamp.
func WriteDecoderStamp(dir string) error {
	return os.WriteFile(filepath.Join(dir, DecoderStampFile), []byte(strconv.Itoa(DecoderRevision)+"\n"), 0o600)
}

// DecoderStampCurrent says whether dir's stamp records DecoderRevision (false when absent).
func DecoderStampCurrent(dir string) bool {
	raw, err := os.ReadFile(filepath.Join(dir, DecoderStampFile))
	if err != nil {
		return false
	}
	n, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	return err == nil && n == DecoderRevision
}
