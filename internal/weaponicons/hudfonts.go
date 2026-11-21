// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// hudfonts.go — the game's HUD typefaces, written from the install as TrueType files.
//
// Each `font` tag (508 bytes, no glyphs of its own) points, by its entry's resource index
// (+0x10), at one resource of the module's resource table. That resource's `ucsh` data holds
// a complete TrueType file: after the header, 16 filler bytes, a zero word, the font's byte
// length (u32, little endian), then the sfnt itself (version 0x00010000). Established on the
// 104 font tags of `any/globals/globals-rtx-new.module` (2026-11-19, docs/design/hud-parity.md
// "Fonts"). The faces are picked by the full name in their own `name` table, so a tag id
// change between game builds does not matter; the tags that merge a Latin face with a CJK
// fallback ("Normative Pro+Malgun Gothic") carry a different full name and are not picked.
// The files stay in the user's data folder like every other game-derived asset.

package weaponicons

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"unicode/utf16"
)

// hudFonts maps a face's full name (name ID 4) to the file stem the build writes. Normative
// Pro is the HUD's default face (the kill feed and the medals name none); the center
// scoreboard names Industry at weights 600 (Demi) and 400 (Book).
var hudFonts = map[string]string{
	"Normative Pro":               "NormativePro-Regular",
	"Normative Pro Italic":        "NormativePro-Italic",
	"Normative Pro Medium":        "NormativePro-Medium",
	"Normative Pro Medium Italic": "NormativePro-MediumItalic",
	"Normative Pro Bold":          "NormativePro-Bold",
	"Normative Pro Bold Italic":   "NormativePro-BoldItalic",
	"Industry Book":               "Industry-Book",
	"Industry Medium":             "Industry-Medium",
	"Industry Demi":               "Industry-Demi",
	"Industry Bold":               "Industry-Bold",
}

// HudFontNames returns the sorted file names (with .ttf) of the HUD fonts the build writes.
func HudFontNames() []string {
	out := make([]string, 0, len(hudFonts))
	for _, stem := range hudFonts {
		out = append(out, stem+".ttf")
	}
	sort.Strings(out)
	return out
}

// hudFontRequired is the face whose file marks the font part of the set as built.
const hudFontRequired = "NormativePro-Regular.ttf"

// fontFromResource returns the TrueType file inside a font resource blob: the length word
// at HeaderSize+20, the sfnt at HeaderSize+24. It refuses a blob whose length runs past its
// end or whose bytes there are not an sfnt version 1.0 header.
func fontFromResource(blob []byte) ([]byte, error) {
	hdr, ok := parseTagHeader(blob)
	if !ok {
		return nil, fmt.Errorf("no ucsh header")
	}
	at := int(hdr.HeaderSize)
	if at < 0 || at+24 > len(blob) {
		return nil, fmt.Errorf("resource too short (%d bytes) for its header (%d)", len(blob), at)
	}
	n := int(binary.LittleEndian.Uint32(blob[at+20:]))
	start := at + 24
	if n < 12 || start+n > len(blob) {
		return nil, fmt.Errorf("font length %d at offset %d does not fit the %d-byte resource", n, start, len(blob))
	}
	f := blob[start : start+n]
	if !bytes.Equal(f[:4], []byte{0, 1, 0, 0}) {
		return nil, fmt.Errorf("no TrueType header at offset %d (% x)", start, f[:4])
	}
	return f, nil
}

// sfntName returns the Windows-platform (3) string of name ID id from a TrueType file's
// `name` table, or "" when it has none.
func sfntName(f []byte, id uint16) string {
	if len(f) < 12 {
		return ""
	}
	nt := int(binary.BigEndian.Uint16(f[4:]))
	for t := 0; t < nt && 12+16*t+16 <= len(f); t++ {
		r := f[12+16*t:]
		if string(r[:4]) != "name" {
			continue
		}
		base := int(binary.BigEndian.Uint32(r[8:]))
		if base+6 > len(f) {
			return ""
		}
		n := f[base:]
		count := int(binary.BigEndian.Uint16(n[2:]))
		strOff := int(binary.BigEndian.Uint16(n[4:]))
		for i := 0; i < count && 6+12*i+12 <= len(n); i++ {
			rec := n[6+12*i:]
			if binary.BigEndian.Uint16(rec) != 3 || binary.BigEndian.Uint16(rec[6:]) != id {
				continue
			}
			ln, off := int(binary.BigEndian.Uint16(rec[8:])), int(binary.BigEndian.Uint16(rec[10:]))
			if strOff+off+ln > len(n) {
				return ""
			}
			s := n[strOff+off : strOff+off+ln]
			u := make([]uint16, 0, ln/2)
			for k := 0; k+1 < len(s); k += 2 {
				u = append(u, binary.BigEndian.Uint16(s[k:]))
			}
			return string(utf16.Decode(u))
		}
	}
	return ""
}

// buildHudFonts writes the hudFonts faces into out, read from the install's font tags. It
// returns the number of files written and their byte count; it fails when the required face
// is not found (the rest are written when present).
func buildHudFonts(ctx context.Context, ix *tagIndex, out string) (written, total int, err error) {
	seen := map[string]bool{}
	for _, r := range ix.byGroup["font"] {
		if err := ctx.Err(); err != nil {
			return 0, 0, err
		}
		blob, err := firstResourceBlob(ix, r)
		if err == errNoResource {
			continue
		}
		if err != nil {
			continue // a font tag the reader cannot open is not a HUD face
		}
		f, err := fontFromResource(blob)
		if err != nil {
			continue
		}
		stem, ok := hudFonts[sfntName(f, 4)]
		if !ok || seen[stem] {
			continue
		}
		path := filepath.Join(out, stem+".ttf")
		if err := os.WriteFile(path, f, 0o640); err != nil {
			return 0, 0, fmt.Errorf("write %s.ttf: %w", stem, err)
		}
		seen[stem] = true
		written++
		total += len(f)
	}
	if !seen[hudFonts["Normative Pro"]] {
		return 0, 0, fmt.Errorf("HUD font %q not found among the install's %d font tags", "Normative Pro", len(ix.byGroup["font"]))
	}
	return written, total, nil
}
