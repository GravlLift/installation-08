package mapvar

import "testing"

func TestRepresentationPlacement(t *testing.T) {
	for _, tc := range []struct {
		name string
		bag  Value
		want *int32
	}{
		{name: "absente"},
		{name: "liste vide", bag: Value{Fields: map[uint16]Value{24: {}}}},
		{name: "reference absente", bag: Value{Fields: map[uint16]Value{24: {Items: []Value{{}}}}}},
		{name: "negative", bag: Value{Fields: map[uint16]Value{24: {Items: []Value{{Fields: map[uint16]Value{1: {Fields: map[uint16]Value{0: {Int: -420217844}}}}}}}}}, want: func() *int32 { n := int32(-420217844); return &n }()},
		{name: "zero", bag: Value{Fields: map[uint16]Value{24: {Items: []Value{{Fields: map[uint16]Value{1: {Fields: map[uint16]Value{0: {Int: 0}}}}}}}}}, want: new(int32)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			o := parseObject(0, Value{Fields: map[uint16]Value{8: tc.bag}})
			if (o.RepresentationID == nil) != (tc.want == nil) || (tc.want != nil && *o.RepresentationID != *tc.want) {
				t.Fatalf("representation = %v, attendue %v", o.RepresentationID, tc.want)
			}
		})
	}
}
