package weapons

import "testing"

// TestCoreKey — the weapon core's inventory path names its model key in the hex
// family at the tail of the base name; false when it names no weapon key.
func TestCoreKey(t *testing.T) {
	key, ok := CoreKey("Cores/Weapon/209-200-olympus-aa30213b.json")
	if !ok || key != "aa30213b" {
		t.Fatalf("CoreKey = %q, %v, want aa30213b", key, ok)
	}
	for _, p := range []string{"", "Cores/Weapon/209-200.json", "Cores/Weapon/olympus.json", "spartan.json"} {
		if _, ok := CoreKey(p); ok {
			t.Errorf("CoreKey(%q) = true, want false", p)
		}
	}
}
