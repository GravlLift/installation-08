package mapvar

import "testing"

// TestReadLighting (LOCAL-CHANGE (infinite-theater-3d)): root[1][39] gives the Sunlight intensity,
// its color override index and the override's switch; absent options give nil.
func TestReadLighting(t *testing.T) {
	v := func(fields map[uint16]Value) Value { return Value{Fields: fields} }
	root := v(map[uint16]Value{1: v(map[uint16]Value{39: v(map[uint16]Value{0: {Float: 25}, 1: {Int: 104}, 18: {Int: 1}})})})
	l := readLighting(root)
	if l == nil || l.SunIntensity == nil || *l.SunIntensity != 25 || l.SunColorIndex != 104 || l.SunColorSwitch != SunColorOverrideOn {
		t.Fatalf("lighting %+v", l)
	}
	if readLighting(v(map[uint16]Value{1: v(map[uint16]Value{0: {Int: 3}})})) != nil {
		t.Fatal("lighting read without options")
	}
	if l := readLighting(v(map[uint16]Value{1: v(map[uint16]Value{39: v(map[uint16]Value{5: {Float: 2}})})})); l == nil || l.SunIntensity != nil {
		t.Fatalf("absent intensity read: %+v", l)
	}
}
