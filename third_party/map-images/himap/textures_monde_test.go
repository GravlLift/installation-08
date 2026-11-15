package himap

import "testing"

// TestTextureCapsSelection (LOCAL-CHANGE (infinite-theater-3d)) : un build sans choix de cotes
// lit les cotes standard (la sortie d'avant), et un choix explicite est respecte tel quel.
func TestTextureCapsSelection(t *testing.T) {
	if got := textureCapsOf(TextureCaps{}); got != CapsStandard {
		t.Fatalf("zero options = %+v, want CapsStandard %+v", got, CapsStandard)
	}
	// The standard set is exactly the pre-change constants.
	if want := (TextureCaps{Masque: 512, Couche: 512, MasqueMacro: 256, Echantillon: 256}); CapsStandard != want {
		t.Fatalf("CapsStandard = %+v, want %+v (the pre-change output)", CapsStandard, want)
	}
	// The high set doubles each side.
	if want := (TextureCaps{Masque: 1024, Couche: 1024, MasqueMacro: 512, Echantillon: 512}); CapsHigh != want {
		t.Fatalf("CapsHigh = %+v, want %+v", CapsHigh, want)
	}
	// An explicit choice passes through untouched.
	choix := TextureCaps{Masque: 768, Couche: 768, MasqueMacro: 384, Echantillon: 384}
	if got := textureCapsOf(choix); got != choix {
		t.Fatalf("explicit choice = %+v, want unchanged %+v", got, choix)
	}
	// The hard-surface cap is outside the quality choice: it stays at its own size.
	if coteSurface != 256 {
		t.Fatalf("coteSurface = %d, want 256", coteSurface)
	}
}
