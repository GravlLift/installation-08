// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"testing"
)

// TestParseDecodeFlagsRequired — the required surface of the decode subcommand: the chunks
// folder and the output path are mandatory (the map name and the catalog are optional: the
// map is resolved from the film when absent, and the embedded catalog is the default), and
// a missing one is a clear error.
func TestParseDecodeFlagsRequired(t *testing.T) {
	cases := []struct {
		name string
		args []string
	}{
		{"no chunks", []string{"--out", "o.json", "--map", "Live Fire"}},
		{"no out", []string{"--chunks", "d", "--map", "Live Fire"}},
		{"nothing", []string{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := parseDecodeFlags(tc.args); err == nil {
				t.Fatalf("expected an error for %v, got none", tc.args)
			}
		})
	}
}

// TestParseDecodeFlagsFull — a complete argument set parses, keeps every value, and leaves
// the optional inputs (manifest, stats, match, title, gzip) at their zero form.
func TestParseDecodeFlagsFull(t *testing.T) {
	f, err := parseDecodeFlags([]string{
		"--chunks", "d", "--manifest", "m.json", "--stats", "s.json",
		"--map", "Live Fire", "--catalog", "c.json", "--match", "abc",
		"--title", "halo_infinite", "--gzip", "--out", "o.json",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := decodeFlags{
		chunks: "d", manifest: "m.json", stats: "s.json", mapName: "Live Fire",
		catalog: "c.json", match: "abc", title: "halo_infinite", gzip: true, out: "o.json",
	}
	if f != want {
		t.Fatalf("parsed = %+v, want %+v", f, want)
	}
}

// TestParseDecodeFlagsOptionalAbsent — the manifest, stats and catalog are optional by
// design: a decode without them parses and carries empty values (the document degrades, it
// does not fail; the embedded catalog is the default).
func TestParseDecodeFlagsOptionalAbsent(t *testing.T) {
	f, err := parseDecodeFlags([]string{"--chunks", "d", "--out", "o.json", "--map", "Live Fire"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if f.manifest != "" || f.stats != "" || f.catalog != "" || f.gzip {
		t.Fatalf("optional inputs not zero: %+v", f)
	}
}
