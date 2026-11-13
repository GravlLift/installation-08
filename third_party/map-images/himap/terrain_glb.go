package himap

import "encoding/binary"

func ajouteNormalesGLB(doc *gltfDoc, bin *tamponGLB, g *GroupeMaillage, attrs map[string]int) {
	if len(g.Normales) != len(g.Sommets) || len(g.Normales) == 0 {
		return
	}
	debut := bin.Len()
	for i := 0; i+2 < len(g.Normales); i += 3 {
		v := [3]float32{g.Normales[i], g.Normales[i+2], -g.Normales[i+1]}
		_ = binary.Write(bin, binary.LittleEndian, v)
	}
	doc.BufferViews = append(doc.BufferViews, gltfBufferView{ByteOffset: debut, ByteLength: bin.Len() - debut, Target: glArrayBuffer})
	attrs["NORMAL"] = len(doc.Accessors)
	doc.Accessors = append(doc.Accessors, gltfAccessor{BufferView: len(doc.BufferViews) - 1, ComponentType: glComponentF32, Count: len(g.Normales) / 3, Type: "VEC3"})
}
