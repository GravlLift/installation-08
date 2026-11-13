package refdata

import (
	"testing"
)

// TestMapQuantBoundsEmbedded — the embedded catalog parses, is at the current schema
// version, and resolves a known map to its module: a shipped catalog that the decoder
// could not read would be an empty decode for every user, so the embed is guarded here.
func TestMapQuantBoundsEmbedded(t *testing.T) {
	cat, err := MapQuantBounds()
	if err != nil {
		t.Fatalf("embedded catalog does not parse: %v", err)
	}
	if cat.SchemaVersion != 1 {
		t.Fatalf("schema version = %d, want 1", cat.SchemaVersion)
	}
	if len(cat.Maps) == 0 {
		t.Fatal("embedded catalog has no maps")
	}
	// "Live Fire" is the acceptance film's map; it must resolve to its module.
	entry, err := cat.Lookup("Live Fire")
	if err != nil {
		t.Fatalf("Live Fire not in the embedded catalog: %v", err)
	}
	if entry.Module != "sgh_interlock" {
		t.Fatalf("Live Fire module = %q, want sgh_interlock", entry.Module)
	}
	// A lookup is case-insensitive through the catalog's own normalization.
	if _, err := cat.Lookup("live fire - ranked"); err != nil {
		t.Fatalf("normalized lookup failed: %v", err)
	}
}
