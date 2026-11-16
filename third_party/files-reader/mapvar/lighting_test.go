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
	if l := readLighting(v(map[uint16]Value{1: v(map[uint16]Value{39: v(map[uint16]Value{5: {Float: 2}})})})); l == nil || l.SunIntensity != nil || l.SunDirection != nil {
		t.Fatalf("absent intensity or direction read: %+v", l)
	}
}

// TestReadSunDirection (LOCAL-CHANGE (infinite-theater-3d)): root[1][39][2] is {0: yaw, 1: pitch},
// a left-out sub-field reading 0. The fixtures are the stored values: Fortress {60, 30}; Origin
// stores only its pitch, 330.
func TestReadSunDirection(t *testing.T) {
	v := func(fields map[uint16]Value) Value { return Value{Fields: fields} }
	root := func(dir Value) Value {
		return v(map[uint16]Value{1: v(map[uint16]Value{39: v(map[uint16]Value{0: {Float: 2}, 2: dir})})})
	}
	for _, c := range []struct {
		name string
		dir  Value
		want SunDirection
	}{
		{"Fortress", v(map[uint16]Value{0: {Float: 60}, 1: {Float: 30}}), SunDirection{Yaw: 60, Pitch: 30}},
		{"Origin", v(map[uint16]Value{1: {Float: 330}}), SunDirection{Yaw: 0, Pitch: 330}},
	} {
		l := readLighting(root(c.dir))
		if l == nil || l.SunDirection == nil || *l.SunDirection != c.want {
			t.Fatalf("%s: %+v", c.name, l)
		}
	}
}
