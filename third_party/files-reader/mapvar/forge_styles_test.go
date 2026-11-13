package mapvar

import "testing"

func TestStylesForge(t *testing.T) {
	v := func(fields map[uint16]Value) Value { return Value{Fields: fields} }
	root := v(map[uint16]Value{8: {Items: []Value{v(map[uint16]Value{1: v(map[uint16]Value{0: {Int: 12}}), 3: v(map[uint16]Value{1: v(map[uint16]Value{0: {Int: 34}}), 2: v(map[uint16]Value{0: {Float: .5}, 1: {Float: .25}, 2: {Float: 1}}), 3: {Float: 1}})})}}})
	styles := readStyles(root)
	layer := styles[12][0]
	if layer.Hash != 34 || layer.Tint == nil || layer.Tint.X != .5 || layer.Scalar != 1 {
		t.Fatalf("style: %+v", layer)
	}
	raw := v(map[uint16]Value{8: v(map[uint16]Value{0: {Items: []Value{v(map[uint16]Value{13: v(map[uint16]Value{0: {Int: 12}})})}}})})
	o := parseObject(0, raw)
	if o.StyleID == nil || *o.StyleID != 12 {
		t.Fatalf("référence : %+v", o.StyleID)
	}
}
