package himap

// effet_arme_test.go (LOCAL-CHANGE (infinite-theater-3d)) — the multi-spline decode.

import (
	"encoding/binary"
	"math"
	"testing"
)

func octetsCourbe(mots ...any) []byte {
	var b []byte
	for _, m := range mots {
		switch v := m.(type) {
		case int:
			b = binary.LittleEndian.AppendUint32(b, uint32(v))
		case float64:
			b = binary.LittleEndian.AppendUint32(b, math.Float32bits(float32(v)))
		}
	}
	return b
}

func TestCourbesMultiSpline(t *testing.T) {
	// The arcs' alpha: a line piece (its code's high bytes set) then a line, ending at the largest float.
	b := octetsCourbe(2, 0x53000000, 0.8983333, 0.0, 0.0, 4, float64(math.MaxFloat32), 9.836063, -8.836063)
	c, ok := courbesMultiSpline(b, 1)
	if !ok || len(c) != 1 || len(c[0]) != 2 || len(c[0][1].Coefs) != 2 || c[0][1].Coefs[0] != float32(9.836063) {
		t.Fatalf("alpha = %+v %v", c, ok)
	}
	// A ranged size: two cubic curves.
	b = octetsCourbe(1, 7, float64(math.MaxFloat32), -0.0027, -0.3798, 0.9317, 0.4508, 1, 7, float64(math.MaxFloat32), 0.0568, -0.4403, 0.9101, 0.3774)
	if c, ok = courbesMultiSpline(b, 2); !ok || len(c) != 2 || len(c[1][0].Coefs) != 4 {
		t.Fatalf("size = %+v %v", c, ok)
	}
	// Refused: bytes left over, a curve that does not end at the largest float, a truncated piece.
	for name, bad := range map[string][]byte{
		"trailing":  append(octetsCourbe(1, 4, float64(math.MaxFloat32), 1.0, 0.0), 0, 0, 0, 0),
		"open end":  octetsCourbe(1, 4, 0.5, 1.0, 0.0),
		"truncated": octetsCourbe(1, 7, float64(math.MaxFloat32), 1.0, 0.0),
		"no piece":  octetsCourbe(0),
	} {
		if _, ok := courbesMultiSpline(bad, 1); ok {
			t.Errorf("%s: accepted", name)
		}
	}
}
