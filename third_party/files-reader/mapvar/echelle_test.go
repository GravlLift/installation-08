package mapvar

import "testing"

// TestEchelleObjet : l'echelle par axe se lit au chemin `#8/23[0]/0` ; un objet sans elle
// rend nil (echelle unitaire de son type).
func TestEchelleObjet(t *testing.T) {
	vec := Value{Fields: map[uint16]Value{0: {Float: 1.37}, 1: {Float: 1.43}, 2: {Float: 0.89}}}
	sac := Value{Fields: map[uint16]Value{23: {Items: []Value{{Fields: map[uint16]Value{0: vec}}}}}}
	o := parseObject(0, Value{Fields: map[uint16]Value{8: sac}})
	if o.Scale == nil || *o.Scale != (Vec3{X: 1.37, Y: 1.43, Z: 0.89}) {
		t.Fatalf("echelle %+v", o.Scale)
	}
	if o := parseObject(0, Value{Fields: map[uint16]Value{8: {Fields: map[uint16]Value{}}}}); o.Scale != nil {
		t.Fatalf("objet sans echelle : %+v", o.Scale)
	}
}
