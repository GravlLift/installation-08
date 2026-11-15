package meshjobs

import "testing"

// TestParseQuality — standard (and the absent value) parse to standard; high to high; any
// other name is refused.
func TestParseQuality(t *testing.T) {
	for _, s := range []string{"", "standard"} {
		q, ok := ParseQuality(s)
		if !ok || q != QualityStandard {
			t.Errorf("ParseQuality(%q) = %v, %v; want standard, true", s, q, ok)
		}
	}
	q, ok := ParseQuality("high")
	if !ok || q != QualityHigh {
		t.Errorf("ParseQuality(\"high\") = %v, %v; want high, true", q, ok)
	}
	for _, s := range []string{"High", "ultra", "2x", " .high"} {
		if q, ok := ParseQuality(s); ok {
			t.Errorf("ParseQuality(%q) accepted as %v, want refused", s, q)
		}
	}
}

// TestJobKeyRoundTrip — JobKey and SplitQuality are inverses: standard is the bare module
// key, high carries the suffix, and a key with no suffix round-trips as standard.
func TestJobKeyRoundTrip(t *testing.T) {
	cases := []struct {
		module     string
		q          Quality
		wantKey    string
		wantModule string
		wantQ      Quality
	}{
		{"sgh_interlock", QualityStandard, "sgh_interlock", "sgh_interlock", QualityStandard},
		{"sgh_interlock", QualityHigh, "sgh_interlock.high", "sgh_interlock", QualityHigh},
		{"variant:abc", QualityStandard, "variant:abc", "variant:abc", QualityStandard},
		{"variant:abc", QualityHigh, "variant:abc.high", "variant:abc", QualityHigh},
	}
	for _, c := range cases {
		key := JobKey(c.module, c.q)
		if key != c.wantKey {
			t.Errorf("JobKey(%q, %s) = %q, want %q", c.module, c.q, key, c.wantKey)
		}
		module, q := SplitQuality(key)
		if module != c.wantModule || q != c.wantQ {
			t.Errorf("SplitQuality(%q) = %q, %s; want %q, %s", key, module, q, c.wantModule, c.wantQ)
		}
	}
}
