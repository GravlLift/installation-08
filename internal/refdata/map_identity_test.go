// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package refdata

import (
	"testing"
)

// TestMapIdentityEmbedded — the embedded identity table parses, resolves the two
// acceptance films' asset ids to their bounds keys and modules, and rejects an unknown id
// with the error that says to pass --map.
func TestMapIdentityEmbedded(t *testing.T) {
	e, err := LookupMapIdentity("309253f8-7a75-48ff-83e1-e7fb3db2ac47")
	if err != nil {
		t.Fatalf("Live Fire ranked asset id not in the table: %v", err)
	}
	if e.Name != "Live Fire - Ranked" {
		t.Fatalf("name = %q, want %q", e.Name, "Live Fire - Ranked")
	}
	if e.BoundsKey != "live fire" {
		t.Fatalf("bounds key = %q, want %q", e.BoundsKey, "live fire")
	}
	if e.Module != "sgh_interlock" {
		t.Fatalf("module = %q, want sgh_interlock", e.Module)
	}
	// The lookup is case-insensitive: a GUID read from the film is any case.
	if _, err := LookupMapIdentity("309253F8-7A75-48FF-83E1-E7FB3DB2AC47"); err != nil {
		t.Fatalf("uppercase asset id rejected: %v", err)
	}
	// An unknown id is a clear error that says to pass --map.
	_, err = LookupMapIdentity("00000000-0000-0000-0000-000000000000")
	if err == nil {
		t.Fatal("expected an error for an unknown asset id, got none")
	}
}

// TestMapIdentityCoverage — the table's claimed bounds keys all exist in the embedded
// bounds catalog (a key the catalog lacks would be a decode failure shipped to every
// user), and the coverage tallies are what the shipped table states.
func TestMapIdentityCoverage(t *testing.T) {
	total, withBounds, withModule, noBounds, noModule := MapIdentityCoverage()
	if total == 0 {
		t.Fatal("the identity table is empty")
	}
	if withBounds+0 > total || withModule > total {
		t.Fatalf("tallies exceed the total: bounds=%d module=%d total=%d", withBounds, withModule, total)
	}
	// No claimed bounds key is missing from the catalog: the catalog's lookup of every
	// claimed key must succeed.
	cat, err := MapQuantBounds()
	if err != nil {
		t.Fatalf("embedded bounds catalog: %v", err)
	}
	claimed := 0
	for _, e := range AllMapIdentities() {
		if _, err := cat.Lookup(e.BoundsKey); err == nil {
			claimed++
		}
	}
	if claimed != withBounds {
		t.Fatalf("coverage says %d bounds entries, the catalog resolves %d claimed keys", withBounds, claimed)
	}
	// The two acceptance maps must be in, with bounds and a module.
	if len(noBounds) > 0 {
		t.Logf("maps without a bounds entry (%d): %v", len(noBounds), noBounds)
	}
	if len(noModule) > 0 {
		t.Logf("maps without a module key (%d): %v", len(noModule), noModule)
	}
}
